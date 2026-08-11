import { z } from "zod";

import type { JsonValue, WebSearchToolOutput } from "@/runtime/chat/types";
import { readLimitedResponseJson } from "@/runtime/transport/response-reader";
import type { FetchLike } from "@/runtime/transport/transport-http";
import {
  ToolExecutionError,
  type ToolErrorCode,
  type ToolExecutor,
} from "@/runtime/tools/tool-registry";

export const HOSTED_WEB_SEARCH_URL = "/api/web-search";
export const WEB_SEARCH_TOOL_NAME = "web_search";
export const WEB_SEARCH_MAX_RESPONSE_BYTES = 1024 * 1024;
export const WEB_SEARCH_DEFAULT_TIMEOUT_MS = 30_000;

const inputSchema = z
  .object({ query: z.string().trim().min(1).max(200) })
  .strict();
const hostedErrorSchema = z
  .object({
    error: z.object({
      code: z.enum([
        "UNAUTHORIZED",
        "FORBIDDEN",
        "INVALID_REQUEST",
        "TOOL_NOT_AVAILABLE",
        "TOOL_AUTH_FAILED",
        "TOOL_RATE_LIMITED",
        "TOOL_REQUEST_FAILED",
        "TOOL_REQUEST_TIMEOUT",
        "TOOL_SERVICE_UNAVAILABLE",
        "TOOL_REQUEST_ABORTED",
      ]),
    }),
  })
  .passthrough();

export interface WebSearchRequestOptions {
  access:
    | { kind: "direct"; apiKey: string; url: string }
    | { kind: "hosted"; onUnauthorized?: () => void };
  body: JsonValue;
  fetchImplementation: FetchLike;
  signal: AbortSignal;
  timeoutMs: number;
}

export function createWebSearchToolExecutor(
  search: (query: string, signal: AbortSignal) => Promise<WebSearchToolOutput>,
): ToolExecutor {
  return {
    definition: {
      type: "function",
      function: {
        name: WEB_SEARCH_TOOL_NAME,
        description:
          "Search the web for current, time-sensitive, or externally verifiable information.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              maxLength: 200,
              description: "A focused web search query.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
    dedupeKey(input) {
      const parsedInput = inputSchema.safeParse(input);
      return parsedInput.success ? parsedInput.data.query : null;
    },
    async execute(input, signal): Promise<JsonValue> {
      const parsedInput = inputSchema.safeParse(input);
      if (!parsedInput.success) {
        throw new ToolExecutionError("INVALID_TOOL_INPUT");
      }
      const output = await search(parsedInput.data.query, signal);
      return {
        query: output.query,
        ...(output.answer ? { answer: output.answer } : {}),
        results: output.results.map((result) => ({ ...result })),
      };
    },
  };
}

export function createHostedWebSearchToolExecutor(options: {
  maxResults: number;
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
  onUnauthorized?: () => void;
}): ToolExecutor {
  return createWebSearchToolExecutor(async (query, signal) => {
    const { payload, status } = await requestWebSearchJson({
      access: {
        kind: "hosted",
        ...(options.onUnauthorized
          ? { onUnauthorized: options.onUnauthorized }
          : {}),
      },
      body: { query, maxResults: options.maxResults },
      fetchImplementation: options.fetchImplementation ?? fetch,
      signal,
      timeoutMs: options.timeoutMs ?? WEB_SEARCH_DEFAULT_TIMEOUT_MS,
    });
    const parsed = webSearchOutputSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ToolExecutionError("TOOL_REQUEST_FAILED", status);
    }
    return {
      query: parsed.data.query,
      ...(parsed.data.answer === undefined
        ? {}
        : { answer: parsed.data.answer }),
      results: parsed.data.results,
    };
  });
}

export async function requestWebSearchJson({
  access,
  body,
  fetchImplementation,
  signal,
  timeoutMs,
}: WebSearchRequestOptions): Promise<{ payload: unknown; status: number }> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal.reason);
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImplementation(
      access.kind === "direct" ? access.url : HOSTED_WEB_SEARCH_URL,
      {
        method: "POST",
        headers: {
          ...(access.kind === "direct"
            ? { Authorization: `Bearer ${access.apiKey}` }
            : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        ...(access.kind === "hosted"
          ? { credentials: "same-origin" as const }
          : {}),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      if (access.kind === "hosted") {
        throw await hostedToolError(
          response,
          controller.signal,
          access.onUnauthorized,
        );
      }
      throw toolHttpError(response.status);
    }
    return {
      payload: await readLimitedResponseJson(
        response,
        WEB_SEARCH_MAX_RESPONSE_BYTES,
        controller.signal,
      ),
      status: response.status,
    };
  } catch (cause) {
    if (signal.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (timedOut) throw new ToolExecutionError("TOOL_REQUEST_TIMEOUT");
    if (cause instanceof ToolExecutionError) throw cause;
    throw new ToolExecutionError("TOOL_REQUEST_FAILED");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  });

const webSearchResultSchema = z
  .object({
    title: z.string(),
    url: httpUrlSchema,
    content: z.string(),
  })
  .strict();

const webSearchOutputSchema = z
  .object({
    query: z.string(),
    answer: z.string().optional(),
    results: z.array(webSearchResultSchema),
  })
  .strict();

export function parseHttpUrl(value: unknown): string | null {
  const parsed = httpUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function hostedToolError(
  response: Response,
  signal: AbortSignal,
  onUnauthorized: (() => void) | undefined,
): Promise<ToolExecutionError> {
  let value: unknown;
  try {
    value = await readLimitedResponseJson(
      response,
      WEB_SEARCH_MAX_RESPONSE_BYTES,
      signal,
    );
  } catch {
    return toolHttpError(response.status);
  }
  const parsed = hostedErrorSchema.safeParse(value);
  if (!parsed.success) return toolHttpError(response.status);
  const code = parsed.data.error.code;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
    onUnauthorized?.();
    return new ToolExecutionError("TOOL_AUTH_FAILED", response.status, false);
  }
  if (code === "INVALID_REQUEST") {
    return new ToolExecutionError(
      "TOOL_REQUEST_FAILED",
      response.status,
      false,
    );
  }
  return new ToolExecutionError(
    code,
    response.status,
    isRetryableHostedError(code),
  );
}

function isRetryableHostedError(code: ToolErrorCode): boolean {
  return (
    code === "TOOL_RATE_LIMITED" ||
    code === "TOOL_REQUEST_TIMEOUT" ||
    code === "TOOL_SERVICE_UNAVAILABLE" ||
    code === "TOOL_REQUEST_ABORTED"
  );
}

function toolHttpError(status: number): ToolExecutionError {
  if (status === 401 || status === 403) {
    return new ToolExecutionError("TOOL_AUTH_FAILED", status, false);
  }
  if (status === 429) {
    return new ToolExecutionError("TOOL_RATE_LIMITED", status, true);
  }
  if (status >= 500) {
    return new ToolExecutionError("TOOL_SERVICE_UNAVAILABLE", status, true);
  }
  return new ToolExecutionError("TOOL_REQUEST_FAILED", status, false);
}
