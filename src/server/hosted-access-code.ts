import {
  authenticateAccessCode,
  decodeAccessCodeHeader,
  readAccessCodeHeader,
} from "@/server/auth";
import type { HostedServerConfig } from "@/server/config";
import {
  hostedRequestGuard,
  type HostedRequestGuard,
} from "@/server/hosted-request-guard";
import { RequestSecurityError } from "@/server/security";

export type HostedAccessCodeOutcome =
  | { status: "authenticated" }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "rate-limited"; retryAfterSeconds: number };

/**
 * Validates the Hosted access code header against the current allowlist. Every
 * Hosted request carries its own credential, so a failed check is throttled
 * through the same client/global window that protects explicit sign-in.
 */
export function evaluateHostedAccessCode(
  request: Request,
  hosted: HostedServerConfig,
  requestGuard: HostedRequestGuard = hostedRequestGuard,
): HostedAccessCodeOutcome {
  const supplied = readAccessCodeHeader(request);
  if (supplied === null || supplied.trim().length === 0) {
    return { status: "missing" };
  }
  const blockedFor = requestGuard.loginRetryAfterSeconds(
    request,
    hosted.authSecret,
  );
  if (blockedFor !== null) {
    return { status: "rate-limited", retryAfterSeconds: blockedFor };
  }
  const decoded = decodeAccessCodeHeader(supplied);
  if (decoded === null || !authenticateAccessCode(decoded, hosted)) {
    const retryAfterSeconds = requestGuard.recordLoginFailure(
      request,
      hosted.authSecret,
    );
    return retryAfterSeconds === null
      ? { status: "invalid" }
      : { status: "rate-limited", retryAfterSeconds };
  }
  requestGuard.recordLoginSuccess(request, hosted.authSecret);
  return { status: "authenticated" };
}

/**
 * Reports Hosted authentication for public config without ever failing the
 * request; a blocked or invalid code simply reads as unauthenticated.
 */
export function hasValidHostedAccessCode(
  request: Request,
  hosted: HostedServerConfig | null,
  requestGuard: HostedRequestGuard = hostedRequestGuard,
): boolean {
  if (!hosted) return false;
  try {
    return (
      evaluateHostedAccessCode(request, hosted, requestGuard).status ===
      "authenticated"
    );
  } catch {
    return false;
  }
}

export function requireHostedAccessCode(
  request: Request,
  hosted: HostedServerConfig | null,
  requestGuard: HostedRequestGuard = hostedRequestGuard,
): HostedServerConfig {
  if (!hosted) {
    throw new RequestSecurityError(
      404,
      "UPSTREAM_NOT_FOUND",
      "Hosted access is unavailable",
    );
  }
  const outcome = evaluateHostedAccessCode(request, hosted, requestGuard);
  if (outcome.status === "authenticated") return hosted;
  if (outcome.status === "rate-limited") {
    throw new RequestSecurityError(
      429,
      "AUTH_RATE_LIMITED",
      "Too many failed access code attempts",
      outcome.retryAfterSeconds,
    );
  }
  throw outcome.status === "missing"
    ? new RequestSecurityError(
        401,
        "HOSTED_AUTH_REQUIRED",
        "A Hosted access code is required",
      )
    : new RequestSecurityError(
        401,
        "ACCESS_CODE_INVALID",
        "The Hosted access code is no longer valid",
      );
}
