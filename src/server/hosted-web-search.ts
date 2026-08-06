import { z } from "zod";

import type { FetchLike } from "@/runtime/transport/transport-http";
import { createTavilyToolExecutor } from "@/runtime/tools/tavily-client";
import { ToolExecutionError } from "@/runtime/tools/tool-registry";
import { WEB_SEARCH_RESULT_COUNT } from "@/runtime/tools/web-search-settings";
import type { ServerConfig } from "@/server/config";
import {
  hostedRateLimitResponse,
  hostedRequestGuard,
  type HostedRequestGuard,
  type HostedRequestLease,
} from "@/server/hosted-request-guard";
import { requireHostedSession } from "@/server/hosted-session";
import {
  errorResponse,
  jsonResponse,
  securityErrorResponse,
} from "@/server/http";
import {
  assertSameOrigin,
  readRequestText,
  RequestSecurityError,
} from "@/server/security";

const WEB_SEARCH_BODY_LIMIT = 8 * 1024;
const requestSchema = z
  .object({
    query: z.string().trim().min(1).max(1_000),
    maxResults: z
      .number()
      .int()
      .min(WEB_SEARCH_RESULT_COUNT.min)
      .max(WEB_SEARCH_RESULT_COUNT.max),
  })
  .strict();

export async function handleHostedWebSearch(
  request: Request,
  config: ServerConfig,
  fetchImplementation: FetchLike = fetch,
  timeoutMs?: number,
  requestGuard: HostedRequestGuard = hostedRequestGuard,
): Promise<Response> {
  let lease: HostedRequestLease | null = null;
  try {
    assertSameOrigin(request);
    const hosted = requireHostedSession(request, config.hosted);
    if (!hosted.tavilyApiKey || !hosted.tavilyBaseUrl) {
      throw new RequestSecurityError(
        404,
        "TOOL_NOT_AVAILABLE",
        "Hosted web search is unavailable",
      );
    }
    lease = requestGuard.tryAcquire("web-search");
    if (!lease) {
      return hostedRateLimitResponse(
        "HOSTED_CONCURRENCY_LIMIT",
        "Hosted web search capacity is temporarily unavailable",
      );
    }

    const bodyText = await readRequestText(request, WEB_SEARCH_BODY_LIMIT);
    let value: unknown;
    try {
      value = JSON.parse(bodyText);
    } catch {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "Request body must be valid JSON",
      );
    }
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "Request body is not a valid web search request",
      );
    }

    const executor = createTavilyToolExecutor({
      apiKey: hosted.tavilyApiKey,
      baseUrl: hosted.tavilyBaseUrl,
      maxResults: parsed.data.maxResults,
      fetchImplementation,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    const output = await executor.execute(
      { query: parsed.data.query },
      request.signal,
    );
    return jsonResponse(output);
  } catch (error) {
    return (
      securityErrorResponse(error) ??
      toolErrorResponse(error, request.signal) ??
      errorResponse(502, "TOOL_REQUEST_FAILED", "Web search failed")
    );
  } finally {
    lease?.release();
  }
}

function toolErrorResponse(
  error: unknown,
  signal: AbortSignal,
): Response | null {
  if (signal.aborted) {
    return errorResponse(
      499,
      "TOOL_REQUEST_ABORTED",
      "Web search was cancelled",
    );
  }
  if (!(error instanceof ToolExecutionError)) return null;
  switch (error.code) {
    case "INVALID_TOOL_INPUT":
      return errorResponse(400, error.code, "Web search request is invalid");
    case "TOOL_NOT_AVAILABLE":
      return errorResponse(404, error.code, "Hosted web search is unavailable");
    case "TOOL_AUTH_FAILED":
      return errorResponse(502, error.code, "Hosted web search is unavailable");
    case "TOOL_RATE_LIMITED":
      return errorResponse(429, error.code, "Web search rate limit reached");
    case "TOOL_REQUEST_TIMEOUT":
      return errorResponse(504, error.code, "Web search timed out");
    case "TOOL_SERVICE_UNAVAILABLE":
      return errorResponse(
        503,
        error.code,
        "Web search service is unavailable",
      );
    case "TOOL_REQUEST_ABORTED":
      return errorResponse(499, error.code, "Web search was cancelled");
    case "TOOL_REQUEST_FAILED":
      return errorResponse(502, error.code, "Web search failed");
  }
}
