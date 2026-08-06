import { z } from "zod";

import type { JsonValue } from "@/runtime/chat/types";
import type { FetchLike } from "@/runtime/transport/transport-http";
import { readLimitedResponseJson } from "@/runtime/transport/response-reader";
import {
  ToolExecutionError,
  type ToolErrorCode,
  type ToolExecutor,
} from "@/runtime/tools/tool-registry";
import {
  buildTavilySearchUrl,
  normalizeTavilyBaseUrl,
} from "@/runtime/tools/tavily-url";
import { WEB_SEARCH_RESULT_COUNT } from "@/runtime/tools/web-search-settings";

export const HOSTED_TAVILY_SEARCH_URL = "/api/web-search";
export const WEB_SEARCH_TOOL_NAME = "web_search";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

const inputSchema = z
  .object({ query: z.string().trim().min(1).max(200) })
  .strict();
const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  });
const responseSchema = z
  .object({
    query: z.string().optional(),
    results: z
      .array(
        z
          .object({
            title: z.string().optional(),
            url: z.string().optional(),
            content: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();
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

interface SharedTavilyClientOptions {
  maxResults: number;
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
}

export type TavilyClientOptions = SharedTavilyClientOptions &
  (
    | { mode?: "direct"; apiKey: string; baseUrl: string }
    | {
        mode: "hosted";
        apiKey?: never;
        onUnauthorized?: () => void;
      }
  );

export function createTavilyToolExecutor(
  options: TavilyClientOptions,
): ToolExecutor {
  const maxResults = z
    .number()
    .int()
    .min(WEB_SEARCH_RESULT_COUNT.min)
    .max(WEB_SEARCH_RESULT_COUNT.max)
    .parse(options.maxResults);
  const access =
    options.mode === "hosted"
      ? ({
          kind: "hosted",
          ...(options.onUnauthorized
            ? { onUnauthorized: options.onUnauthorized }
            : {}),
        } as const)
      : ({
          kind: "direct",
          apiKey: z.string().trim().min(8).max(2_048).parse(options.apiKey),
          baseUrl: normalizeTavilyBaseUrl(options.baseUrl),
        } as const);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
      const { payload: responseBody, status } = await requestTavily(
        fetchImplementation,
        access,
        parsedInput.data.query,
        maxResults,
        signal,
        timeoutMs,
      );
      const payload = responseSchema.safeParse(responseBody);
      if (!payload.success) {
        throw new ToolExecutionError("TOOL_REQUEST_FAILED", status);
      }
      return {
        query: parsedInput.data.query,
        results: payload.data.results
          .flatMap((result) => {
            const url = httpUrlSchema.safeParse(result.url);
            return url.success
              ? [
                  {
                    title: result.title?.trim().slice(0, 300) ?? "",
                    url: url.data,
                    content: result.content?.trim().slice(0, 4_000) ?? "",
                  },
                ]
              : [];
          })
          .slice(0, maxResults),
      };
    },
  };
}

async function requestTavily(
  fetchImplementation: FetchLike,
  access:
    | { kind: "direct"; apiKey: string; baseUrl: string }
    | { kind: "hosted"; onUnauthorized?: () => void },
  query: string,
  maxResults: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ payload: unknown; status: number }> {
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
      access.kind === "direct"
        ? buildTavilySearchUrl(access.baseUrl)
        : HOSTED_TAVILY_SEARCH_URL,
      {
        method: "POST",
        headers: {
          ...(access.kind === "direct"
            ? { Authorization: `Bearer ${access.apiKey}` }
            : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          access.kind === "direct"
            ? {
                query,
                max_results: maxResults,
              }
            : { query, maxResults },
        ),
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
        MAX_RESPONSE_BYTES,
        controller.signal,
      ),
      status: response.status,
    };
  } catch (cause) {
    if (signal.aborted) throw signal.reason;
    if (timedOut) throw new ToolExecutionError("TOOL_REQUEST_TIMEOUT");
    if (cause instanceof ToolExecutionError) throw cause;
    throw new ToolExecutionError("TOOL_REQUEST_FAILED");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function hostedToolError(
  response: Response,
  signal: AbortSignal,
  onUnauthorized: (() => void) | undefined,
): Promise<ToolExecutionError> {
  let value: unknown;
  try {
    value = await readLimitedResponseJson(response, MAX_RESPONSE_BYTES, signal);
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
