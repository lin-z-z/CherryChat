import type { MessageError } from "@/runtime/chat/types";

export const CHAT_ERROR_CODES = [
  "CORS_OR_NETWORK",
  "MIXED_CONTENT",
  "UNAUTHORIZED",
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
