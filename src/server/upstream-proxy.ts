import { z } from "zod";

import { redactSensitiveText } from "@/runtime/transport/chat-errors";
import {
  chatTimeouts,
  fetchWithRequestTimeouts,
  modelListTimeouts,
  RequestTimeoutError,
  type OperationTimeouts,
} from "@/runtime/transport/request-timeout-policy";
import { buildUpstreamUrl, type ServerConfig } from "@/server/config";
import { hostedChatRequestSchema } from "@/server/hosted-chat-request";
import {
  hostedRateLimitResponse,
  hostedRequestGuard,
  type HostedRequestGuard,
  type HostedRequestLease,
} from "@/server/hosted-request-guard";
import { requireHostedAccessCode } from "@/server/hosted-access-code";
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

const CHAT_BODY_LIMIT = 4 * 1024 * 1024;

const byokChatRequestSchema = z
  .object({
    model: z.string().trim().min(1),
    messages: z.array(z.unknown()).min(1),
    stream: z.boolean(),
  })
  .passthrough();

type ProxyMode = "byok" | "hosted";
type FetchLike = typeof fetch;

interface ProxyCredentials {
  mode: ProxyMode;
  authorization: string;
  secretValues: string[];
}

export async function handleModelsProxy(
  request: Request,
  config: ServerConfig,
  fetchImplementation: FetchLike = fetch,
  requestGuard: HostedRequestGuard = hostedRequestGuard,
): Promise<Response> {
  try {
    const credentials = resolveCredentials(request, config, requestGuard);
    if (credentials.mode === "hosted") {
      return jsonResponse({
        object: "list",
        data: config.models.map((id) => ({
          id,
          object: "model",
          owned_by: "hosted",
        })),
      });
    }

    return await forwardUpstream(
      request,
      buildUpstreamUrl(config, "models"),
      { method: "GET", headers: upstreamHeaders(credentials.authorization) },
      credentials.secretValues,
      fetchImplementation,
      modelListTimeouts(config.requestTimeouts),
    );
  } catch (error) {
    return (
      securityErrorResponse(error) ??
      errorResponse(500, "UPSTREAM_ERROR", "Unable to load models")
    );
  }
}

export async function handleChatProxy(
  request: Request,
  config: ServerConfig,
  fetchImplementation: FetchLike = fetch,
  requestGuard: HostedRequestGuard = hostedRequestGuard,
): Promise<Response> {
  let hostedLease: HostedRequestLease | null = null;
  try {
    assertSameOrigin(request);
    const credentials = resolveCredentials(request, config, requestGuard);
    if (credentials.mode === "hosted") {
      hostedLease = requestGuard.tryAcquire("chat");
      if (!hostedLease) {
        return hostedRateLimitResponse(
          "HOSTED_CONCURRENCY_LIMIT",
          "Hosted chat capacity is temporarily unavailable",
        );
      }
    }
    const bodyText = await readRequestText(request, CHAT_BODY_LIMIT);
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
    const parsed =
      credentials.mode === "hosted"
        ? hostedChatRequestSchema.safeParse(value)
        : byokChatRequestSchema.safeParse(value);
    if (!parsed.success) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "Request body is not a valid Chat Completions request",
      );
    }
    if (
      credentials.mode === "hosted" &&
      !config.models.includes(parsed.data.model)
    ) {
      return errorResponse(403, "MODEL_NOT_ALLOWED", "Model is not allowed");
    }

    const normalizedBody = JSON.stringify(parsed.data);
    const forwardedLease = hostedLease;
    hostedLease = null;
    return await forwardUpstream(
      request,
      buildUpstreamUrl(config, "chat/completions"),
      {
        method: "POST",
        headers: upstreamHeaders(credentials.authorization),
        body: normalizedBody,
      },
      credentials.secretValues,
      fetchImplementation,
      chatTimeouts(config.requestTimeouts),
      forwardedLease,
    );
  } catch (error) {
    return (
      securityErrorResponse(error) ??
      errorResponse(500, "UPSTREAM_ERROR", "Unable to contact upstream service")
    );
  } finally {
    hostedLease?.release();
  }
}

function resolveCredentials(
  request: Request,
  config: ServerConfig,
  requestGuard: HostedRequestGuard,
): ProxyCredentials {
  const mode = request.headers.get("x-cherrychat-mode");
  if (mode !== "byok" && mode !== "hosted") {
    throwProxyError(400, "INVALID_REQUEST", "Connection mode is required");
  }

  if (mode === "hosted") {
    const hosted = requireHostedAccessCode(
      request,
      config.hosted,
      requestGuard,
    );
    return {
      mode,
      authorization: `Bearer ${hosted.apiKey}`,
      secretValues: [hosted.apiKey],
    };
  }

  if (config.disableByok) {
    throwProxyError(403, "FORBIDDEN", "BYOK mode is disabled");
  }
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+$/u.test(authorization)) {
    throwProxyError(401, "UNAUTHORIZED", "A BYOK API key is required");
  }
  return {
    mode,
    authorization,
    secretValues: [authorization.replace(/^Bearer\s+/u, "")],
  };
}

async function forwardUpstream(
  request: Request,
  target: string,
  init: RequestInit,
  secrets: readonly string[],
  fetchImplementation: FetchLike,
  timeouts: OperationTimeouts,
  lease: HostedRequestLease | null = null,
): Promise<Response> {
  let releaseWhenReturning = true;
  try {
    let upstream: Response;
    try {
      upstream = await fetchWithRequestTimeouts(
        target,
        {
          ...init,
          signal: request.signal,
          redirect: "error",
          cache: "no-store",
        },
        timeouts,
        fetchImplementation,
      );
    } catch (error) {
      return upstreamFailureResponse(error, request.signal);
    }

    if (!upstream.ok) {
      let detail: string | undefined;
      try {
        detail = sanitizeUpstreamDetail(
          await readLimitedResponseText(upstream, 64 * 1024),
          secrets,
        );
      } catch (error) {
        return upstreamFailureResponse(error, request.signal);
      }
      return errorResponse(
        mapUpstreamStatus(upstream.status),
        mapUpstreamCode(upstream.status),
        "Upstream request failed",
        detail,
      );
    }

    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const requestId = upstream.headers.get("x-request-id");
    if (requestId && /^[A-Za-z0-9._-]{1,200}$/u.test(requestId)) {
      headers.set("X-Upstream-Request-Id", requestId);
    }

    if (!upstream.body) {
      return new Response(null, { status: upstream.status, headers });
    }
    const { readable, writable } = new TransformStream<
      Uint8Array,
      Uint8Array
    >();
    releaseWhenReturning = false;
    void upstream.body
      .pipeTo(writable)
      .catch(() => undefined)
      .finally(() => lease?.release());
    return new Response(readable, { status: upstream.status, headers });
  } finally {
    if (releaseWhenReturning) lease?.release();
  }
}

function upstreamFailureResponse(
  error: unknown,
  callerSignal: AbortSignal,
): Response {
  if (error instanceof RequestTimeoutError) {
    return errorResponse(504, "REQUEST_TIMEOUT", "Upstream request timed out");
  }
  if (callerSignal.aborted) {
    return errorResponse(499, "ABORTED", "Request was cancelled");
  }
  return errorResponse(
    502,
    "CORS_OR_NETWORK",
    "Unable to reach upstream service",
  );
}

function upstreamHeaders(authorization: string): Headers {
  return new Headers({
    Accept: "text/event-stream, application/json",
    Authorization: authorization,
    "Content-Type": "application/json",
  });
}

function sanitizeUpstreamDetail(
  value: string,
  secrets: readonly string[],
): string | undefined {
  let sanitized = value;
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  }
  sanitized = redactSensitiveText(sanitized).trim();
  return sanitized || undefined;
}

async function readLimitedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (totalBytes < maximumBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maximumBytes - totalBytes;
      const chunk = value.subarray(0, remaining);
      totalBytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength) break;
    }
    text += decoder.decode();
    return text;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function mapUpstreamStatus(status: number): number {
  if (status === 401 || status === 403 || status === 404 || status === 429) {
    return status;
  }
  if (status >= 400 && status < 500) return 400;
  return 502;
}

function mapUpstreamCode(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "UPSTREAM_NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 400 && status < 500) return "INVALID_REQUEST";
  return "UPSTREAM_ERROR";
}

function throwProxyError(status: number, code: string, message: string): never {
  throw new RequestSecurityError(status, code, message);
}
