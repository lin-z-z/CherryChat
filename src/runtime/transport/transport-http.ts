import {
  ChatTransportError,
  errorCodeForStatus,
  redactSensitiveText,
} from "@/runtime/transport/chat-errors";
import {
  fetchWithRequestTimeouts,
  type OperationTimeouts,
  type RequestTimeoutPhase,
} from "@/runtime/transport/request-timeout-policy";
import {
  ERROR_RESPONSE_MAX_BYTES,
  readLimitedResponseText,
  ResponseLimitError,
} from "@/runtime/transport/response-reader";

export type FetchLike = typeof fetch;

export async function fetchUpstream(
  url: string,
  init: RequestInit,
  fetchImplementation: FetchLike,
  isMixedContent: () => boolean,
  timeouts: OperationTimeouts,
): Promise<Response> {
  try {
    return await fetchWithRequestTimeouts(
      url,
      init,
      timeouts,
      fetchImplementation,
      timeoutTransportError,
    );
  } catch (error) {
    if (error instanceof ChatTransportError) throw error;
    if (init.signal?.aborted) {
      throw new ChatTransportError("ABORTED", "Request was cancelled", null);
    }
    if (isMixedContent()) {
      throw new ChatTransportError(
        "MIXED_CONTENT",
        "An HTTPS page cannot connect to an HTTP upstream",
        null,
      );
    }
    throw new ChatTransportError(
      "CORS_OR_NETWORK",
      "The browser could not reach the upstream service; check CORS and the URL",
      null,
      error instanceof Error ? redactSensitiveText(error.message) : undefined,
    );
  }
}

function timeoutTransportError(phase: RequestTimeoutPhase): ChatTransportError {
  return new ChatTransportError(
    "REQUEST_TIMEOUT",
    `Request timed out during ${phase}`,
    null,
  );
}

export async function assertSuccessful(response: Response): Promise<void> {
  if (response.ok) return;
  let detail: string | undefined;
  try {
    detail =
      redactSensitiveText(
        await readLimitedResponseText(response, ERROR_RESPONSE_MAX_BYTES),
      ).trim() || undefined;
  } catch (error) {
    if (error instanceof ChatTransportError) throw error;
    if (error instanceof ResponseLimitError) {
      detail = "Upstream error response exceeded the size limit";
    }
  }
  throw new ChatTransportError(
    errorCodeForStatus(response.status),
    "Upstream request failed",
    response.status,
    detail,
  );
}

export function normalizeHttpBaseUrl(
  value: string,
  removablePathSuffixes: readonly string[] = [],
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Base URL must be an absolute URL",
      null,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Base URL must use HTTP or HTTPS",
      null,
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Base URL cannot contain credentials, query parameters or fragments",
      null,
    );
  }

  let pathname = url.pathname.replace(/\/+$/u, "");
  for (const suffix of removablePathSuffixes) {
    if (pathname.endsWith(suffix)) {
      pathname = pathname.slice(0, -suffix.length);
      break;
    }
  }
  url.pathname = pathname;
  return url.toString().replace(/\/$/u, "");
}

export function isMixedContentUrl(url: string): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    url.startsWith("http:")
  );
}
