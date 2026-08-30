import { authenticateAccessCode, SESSION_COOKIE_NAME } from "@/server/auth";
import { getServerConfig } from "@/server/config";
import {
  hostedRateLimitResponse,
  hostedRequestGuard,
} from "@/server/hosted-request-guard";
import {
  errorResponse,
  jsonResponse,
  securityErrorResponse,
} from "@/server/http";
import { assertSameOrigin, readRequestText } from "@/server/security";

/**
 * Explicitly verifies an access code so the settings page can confirm it before
 * saving. Hosted authentication itself is stateless: every request carries the
 * access code header, so no session is issued here.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const config = getServerConfig();
    if (!config.hosted) {
      return errorResponse(
        404,
        "UPSTREAM_NOT_FOUND",
        "Hosted mode is unavailable",
      );
    }
    const retryAfterSeconds = hostedRequestGuard.loginRetryAfterSeconds(
      request,
      config.hosted.authSecret,
    );
    if (retryAfterSeconds !== null) {
      return hostedRateLimitResponse(
        "AUTH_RATE_LIMITED",
        "Too many failed sign-in attempts",
        retryAfterSeconds,
      );
    }
    const text = await readRequestText(request, 4096);
    let candidate: unknown;
    try {
      candidate = (JSON.parse(text) as { accessCode?: unknown }).accessCode;
    } catch {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "Request body must be valid JSON",
      );
    }
    const codeId =
      typeof candidate === "string"
        ? authenticateAccessCode(candidate, config.hosted)
        : null;
    if (!codeId) {
      const failureRetryAfter = hostedRequestGuard.recordLoginFailure(
        request,
        config.hosted.authSecret,
      );
      if (failureRetryAfter !== null) {
        return hostedRateLimitResponse(
          "AUTH_RATE_LIMITED",
          "Too many failed sign-in attempts",
          failureRetryAfter,
        );
      }
      return errorResponse(
        401,
        "ACCESS_CODE_INVALID",
        "Access code is invalid",
      );
    }
    hostedRequestGuard.recordLoginSuccess(request, config.hosted.authSecret);
    return jsonResponse({ authenticated: true });
  } catch (error) {
    return (
      securityErrorResponse(error) ??
      errorResponse(500, "CONFIGURATION_ERROR", "Hosted sign-in is unavailable")
    );
  }
}

/**
 * Clears the legacy session cookie issued by releases before stateless Hosted
 * authentication. The browser-held access code is cleared by the client.
 */
export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const response = jsonResponse({ authenticated: false });
    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureSuffix(request)}`,
    );
    return response;
  } catch (error) {
    return (
      securityErrorResponse(error) ??
      errorResponse(500, "UPSTREAM_ERROR", "Sign-out failed")
    );
  }
}

function secureSuffix(request: Request): string {
  return new URL(request.url).protocol === "https:" ||
    process.env.NODE_ENV === "production"
    ? "; Secure"
    : "";
}
