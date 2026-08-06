import {
  readCookie,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/server/auth";
import type { HostedServerConfig } from "@/server/config";
import { RequestSecurityError } from "@/server/security";

export function hasValidHostedSession(
  request: Request,
  hosted: HostedServerConfig | null,
): boolean {
  if (!hosted) return false;
  try {
    const token = readCookie(
      request.headers.get("cookie"),
      SESSION_COOKIE_NAME,
    );
    return verifySessionToken(token, hosted);
  } catch {
    return false;
  }
}

export function requireHostedSession(
  request: Request,
  hosted: HostedServerConfig | null,
): HostedServerConfig {
  if (!hosted) {
    throw new RequestSecurityError(
      404,
      "UPSTREAM_NOT_FOUND",
      "Hosted access is unavailable",
    );
  }
  if (!hasValidHostedSession(request, hosted)) {
    throw new RequestSecurityError(
      401,
      "UNAUTHORIZED",
      "Hosted session is invalid or expired",
    );
  }
  return hosted;
}
