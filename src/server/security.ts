export class RequestSecurityError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestSecurityError";
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new RequestSecurityError(
      403,
      "FORBIDDEN",
      "Origin header is required",
    );
  }
  let suppliedOrigin: string;
  try {
    suppliedOrigin = new URL(origin).origin;
  } catch {
    throw new RequestSecurityError(
      403,
      "FORBIDDEN",
      "Origin header is invalid",
    );
  }
  const requestUrl = new URL(request.url);
  const allowedOrigins = new Set([requestUrl.origin]);
  const requestHost = request.headers.get("host")?.trim();
  if (requestHost) {
    try {
      const hostUrl = new URL(`${requestUrl.protocol}//${requestHost}`);
      if (hostUrl.host.toLowerCase() === requestHost.toLowerCase()) {
        allowedOrigins.add(hostUrl.origin);
      }
    } catch {
      // A malformed Host never becomes an allowed origin.
    }
  }
  if (!allowedOrigins.has(suppliedOrigin)) {
    throw new RequestSecurityError(
      403,
      "FORBIDDEN",
      "Cross-origin request rejected",
    );
  }
}

export async function readRequestText(
  request: Request,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestSecurityError(
      413,
      "INVALID_REQUEST",
      "Request body is too large",
    );
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new RequestSecurityError(
          413,
          "INVALID_REQUEST",
          "Request body is too large",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof RequestSecurityError) throw error;
    throw new RequestSecurityError(
      400,
      "INVALID_REQUEST",
      "Request body must be valid UTF-8",
    );
  } finally {
    reader.releaseLock();
  }
}
