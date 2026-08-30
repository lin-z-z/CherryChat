import type { MessageError } from "@/runtime/chat/types";

export const CHAT_ERROR_CODES = [
  "CORS_OR_NETWORK",
  "MIXED_CONTENT",
  "UNAUTHORIZED",
  "HOSTED_AUTH_REQUIRED",
  "ACCESS_CODE_INVALID",
  "FORBIDDEN",
  "MODEL_NOT_ALLOWED",
  "RATE_LIMITED",
  "UPSTREAM_NOT_FOUND",
  "UPSTREAM_ERROR",
  "INVALID_REQUEST",
  "WEB_SEARCH_UNAVAILABLE",
  "CONTEXT_TOO_LARGE",
  "STORAGE_UNAVAILABLE",
  "STREAM_PROTOCOL_ERROR",
  "REQUEST_TIMEOUT",
  "ABORTED",
] as const;

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

export class ChatTransportError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    message: string,
    readonly status: number | null,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ChatTransportError";
  }
}

const HOSTED_AUTH_ERROR_CODES = [
  "HOSTED_AUTH_REQUIRED",
  "ACCESS_CODE_INVALID",
] as const;

export type HostedAuthErrorCode = (typeof HOSTED_AUTH_ERROR_CODES)[number];

export function isHostedAuthErrorCode(
  code: string | null | undefined,
): code is HostedAuthErrorCode {
  return (HOSTED_AUTH_ERROR_CODES as readonly string[]).includes(code ?? "");
}

/**
 * Reads a CherryChat Hosted authentication failure out of an error response
 * body. Upstream 401s carry their own shapes and stay mapped by status, so a
 * failed access code never looks like a rejected upstream API key.
 */
export function hostedAuthErrorCodeFromBody(
  body: string | null | undefined,
): HostedAuthErrorCode | null {
  if (!body) return null;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return isHostedAuthErrorCode(typeof code === "string" ? code : null)
    ? (code as HostedAuthErrorCode)
    : null;
}

export function errorCodeForStatus(status: number): ChatErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "UPSTREAM_NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status === 504) return "REQUEST_TIMEOUT";
  if (status >= 400 && status < 500) return "INVALID_REQUEST";
  return "UPSTREAM_ERROR";
}

export function toMessageError(error: ChatTransportError): MessageError {
  return {
    code: error.code,
    status: error.status,
    retryable: isRetryableChatError(error.code),
  };
}

function isRetryableChatError(code: ChatErrorCode): boolean {
  // Hosted auth failures need a new access code, so retrying cannot help.
  return (
    code === "CORS_OR_NETWORK" ||
    code === "REQUEST_TIMEOUT" ||
    code === "RATE_LIMITED" ||
    code === "UPSTREAM_ERROR" ||
    code === "STORAGE_UNAVAILABLE" ||
    code === "STREAM_PROTOCOL_ERROR"
  );
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
    .slice(0, 4096);
}
