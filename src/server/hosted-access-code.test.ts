import { beforeEach, describe, expect, it } from "vitest";

import { ACCESS_CODE_HEADER_NAME } from "@/server/auth";
import type { HostedServerConfig } from "@/server/config";
import {
  evaluateHostedAccessCode,
  hasValidHostedAccessCode,
  requireHostedAccessCode,
} from "@/server/hosted-access-code";
import { HostedRequestGuard } from "@/server/hosted-request-guard";
import { RequestSecurityError } from "@/server/security";

const hosted: HostedServerConfig = {
  apiKey: "sk-hosted-key",
  accessCodes: ["first-code", "ABC-123"],
  authSecret: "s".repeat(32),
  webSearch: null,
};

let guard: HostedRequestGuard;

function request(accessCode?: string, address = "203.0.113.7"): Request {
  return new Request("https://app.example/api/chat", {
    method: "POST",
    headers: {
      "x-forwarded-for": address,
      ...(accessCode === undefined
        ? {}
        : { [ACCESS_CODE_HEADER_NAME]: accessCode }),
    },
  });
}

beforeEach(() => {
  guard = new HostedRequestGuard();
});

describe("hosted access code boundary", () => {
  it("authenticates a valid code from the request header", () => {
    expect(
      evaluateHostedAccessCode(request("first-code"), hosted, guard),
    ).toEqual({ status: "authenticated" });
    expect(requireHostedAccessCode(request("first-code"), hosted, guard)).toBe(
      hosted,
    );
  });

  it("normalizes a percent-encoded, non-ASCII code before comparing", () => {
    expect(
      evaluateHostedAccessCode(
        request(encodeURIComponent("  ＡＢＣ-123  ")),
        hosted,
        guard,
      ).status,
    ).toBe("authenticated");
  });

  it("treats a malformed percent-encoding as an invalid code", () => {
    expect(
      evaluateHostedAccessCode(request("%E4%B8"), hosted, guard).status,
    ).toBe("invalid");
  });

  it("separates a missing header from a rejected code", () => {
    expect(evaluateHostedAccessCode(request(), hosted, guard).status).toBe(
      "missing",
    );
    expect(evaluateHostedAccessCode(request("   "), hosted, guard).status).toBe(
      "missing",
    );
    expect(
      evaluateHostedAccessCode(request("revoked-code"), hosted, guard).status,
    ).toBe("invalid");
  });

  it("reports distinct error codes without echoing the access code", () => {
    const missing = captureError(() =>
      requireHostedAccessCode(request(), hosted, guard),
    );
    const invalid = captureError(() =>
      requireHostedAccessCode(request("revoked-code"), hosted, guard),
    );

    expect(missing.status).toBe(401);
    expect(missing.code).toBe("HOSTED_AUTH_REQUIRED");
    expect(invalid.status).toBe(401);
    expect(invalid.code).toBe("ACCESS_CODE_INVALID");
    expect(invalid.message).not.toContain("revoked-code");
  });

  it("returns 404 when hosted mode is not configured", () => {
    const error = captureError(() =>
      requireHostedAccessCode(request("first-code"), null, guard),
    );

    expect(error.status).toBe(404);
    expect(error.code).toBe("UPSTREAM_NOT_FOUND");
  });

  it("throttles repeated invalid codes and reports Retry-After", () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(
        evaluateHostedAccessCode(request("revoked-code"), hosted, guard).status,
      ).toBe("invalid");
    }
    const blocked = evaluateHostedAccessCode(
      request("revoked-code"),
      hosted,
      guard,
    );

    expect(blocked.status).toBe("rate-limited");
    const error = captureError(() =>
      requireHostedAccessCode(request("revoked-code"), hosted, guard),
    );
    expect(error.status).toBe(429);
    expect(error.code).toBe("AUTH_RATE_LIMITED");
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("never counts a valid code as a failure", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(
        evaluateHostedAccessCode(request("first-code"), hosted, guard).status,
      ).toBe("authenticated");
    }

    expect(
      evaluateHostedAccessCode(request("revoked-code"), hosted, guard).status,
    ).toBe("invalid");
  });

  it("does not let one client's failures block another", () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      evaluateHostedAccessCode(
        request("revoked-code", "198.51.100.4"),
        hosted,
        guard,
      );
    }

    expect(
      evaluateHostedAccessCode(
        request("first-code", "203.0.113.9"),
        hosted,
        guard,
      ).status,
    ).toBe("authenticated");
  });

  it("reads public authentication state without ever failing", () => {
    expect(hasValidHostedAccessCode(request("first-code"), hosted, guard)).toBe(
      true,
    );
    expect(hasValidHostedAccessCode(request(), hosted, guard)).toBe(false);
    expect(hasValidHostedAccessCode(request("nope"), hosted, guard)).toBe(
      false,
    );
    expect(hasValidHostedAccessCode(request("first-code"), null, guard)).toBe(
      false,
    );
  });

  it("treats a throttled client as unauthenticated for public config", () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      evaluateHostedAccessCode(request("revoked-code"), hosted, guard);
    }

    expect(hasValidHostedAccessCode(request("first-code"), hosted, guard)).toBe(
      false,
    );
  });

  it("ignores a legacy session cookie", () => {
    const legacy = new Request("https://app.example/api/chat", {
      method: "POST",
      headers: { Cookie: "cherrychat_session=any-previous-token" },
    });

    expect(evaluateHostedAccessCode(legacy, hosted, guard).status).toBe(
      "missing",
    );
  });
});

function captureError(run: () => unknown): RequestSecurityError {
  try {
    run();
  } catch (error) {
    if (error instanceof RequestSecurityError) return error;
    throw error;
  }
  throw new Error("Expected a RequestSecurityError");
}
