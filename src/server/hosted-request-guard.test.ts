import { describe, expect, it } from "vitest";

import {
  deriveHostedLoginClientKey,
  HostedRequestGuard,
} from "@/server/hosted-request-guard";

describe("hosted single-instance request guard", () => {
  it("bounds concurrent work and releases leases idempotently", () => {
    const guard = createGuard({ chatConcurrencyLimit: 1 });
    const lease = guard.tryAcquire("chat");

    expect(lease).not.toBeNull();
    expect(guard.tryAcquire("chat")).toBeNull();
    expect(guard.activeCount("chat")).toBe(1);

    lease?.release();
    lease?.release();
    expect(guard.activeCount("chat")).toBe(0);
    expect(guard.tryAcquire("chat")).not.toBeNull();
  });

  it("blocks repeated client failures and clears client state after success", () => {
    let now = 1_000;
    const guard = createGuard({
      loginFailureLimit: 3,
      loginWindowMs: 1_000,
      loginBlockMs: 2_000,
      now: () => now,
    });
    const request = loginRequest("203.0.113.10", "test-browser");

    expect(guard.recordLoginFailure(request, "secret")).toBeNull();
    expect(guard.recordLoginFailure(request, "secret")).toBeNull();
    expect(guard.recordLoginFailure(request, "secret")).toBe(2);
    expect(guard.loginRetryAfterSeconds(request, "secret")).toBe(2);

    now += 2_000;
    expect(guard.loginRetryAfterSeconds(request, "secret")).toBeNull();
    guard.recordLoginFailure(request, "secret");
    expect(guard.loginClientCount()).toBe(1);
    guard.recordLoginSuccess(request, "secret");
    expect(guard.loginClientCount()).toBe(0);
  });

  it("uses a separate global failure window across client fingerprints", () => {
    const guard = createGuard({
      loginFailureLimit: 10,
      loginGlobalFailureLimit: 2,
    });

    expect(
      guard.recordLoginFailure(loginRequest("203.0.113.1", "one"), "secret"),
    ).toBeNull();
    expect(
      guard.recordLoginFailure(loginRequest("203.0.113.2", "two"), "secret"),
    ).toBe(60);
    expect(
      guard.loginRetryAfterSeconds(
        loginRequest("203.0.113.3", "three"),
        "secret",
      ),
    ).toBe(60);
  });

  it("shares one client failure budget across User-Agent changes", () => {
    const guard = createGuard({ loginFailureLimit: 3 });

    expect(
      guard.recordLoginFailure(
        loginRequest("203.0.113.20", "browser-one"),
        "secret",
      ),
    ).toBeNull();
    expect(
      guard.recordLoginFailure(
        loginRequest("203.0.113.20", "browser-two"),
        "secret",
      ),
    ).toBeNull();
    expect(
      guard.recordLoginFailure(
        loginRequest("203.0.113.20", "browser-three"),
        "secret",
      ),
    ).toBe(60);
    expect(
      guard.loginRetryAfterSeconds(
        loginRequest("203.0.113.20", "browser-four"),
        "secret",
      ),
    ).toBe(60);
  });

  it("evicts old client buckets at the configured capacity", () => {
    const guard = createGuard({ loginClientCapacity: 2 });

    guard.recordLoginFailure(loginRequest("203.0.113.1", "one"), "secret");
    guard.recordLoginFailure(loginRequest("203.0.113.2", "two"), "secret");
    guard.recordLoginFailure(loginRequest("203.0.113.3", "three"), "secret");

    expect(guard.loginClientCount()).toBe(2);
  });

  it("derives fixed-length keys without retaining raw client metadata", () => {
    const request = loginRequest("203.0.113.55", "Sensitive Browser Agent");
    const first = deriveHostedLoginClientKey(request, "secret-one");
    const repeated = deriveHostedLoginClientKey(request, "secret-one");
    const changedAgent = deriveHostedLoginClientKey(
      loginRequest("203.0.113.55", "Different Browser Agent"),
      "secret-one",
    );
    const normalizedAddress = deriveHostedLoginClientKey(
      loginRequest("203.0.113.55, 10.0.0.1", "Another Browser Agent"),
      "secret-one",
    );
    const differentAddress = deriveHostedLoginClientKey(
      loginRequest("203.0.113.56", "Sensitive Browser Agent"),
      "secret-one",
    );
    const rotated = deriveHostedLoginClientKey(request, "secret-two");

    expect(first).toBe(repeated);
    expect(first).toBe(changedAgent);
    expect(first).toBe(normalizedAddress);
    expect(first).not.toBe(differentAddress);
    expect(first).not.toBe(rotated);
    expect(first).toHaveLength(43);
    expect(first).not.toContain("203.0.113.55");
    expect(first).not.toContain("Sensitive");
  });
});

function createGuard(
  options: Partial<ConstructorParameters<typeof HostedRequestGuard>[0]> = {},
): HostedRequestGuard {
  return new HostedRequestGuard({
    chatConcurrencyLimit: 2,
    webSearchConcurrencyLimit: 2,
    loginFailureLimit: 5,
    loginGlobalFailureLimit: 100,
    loginWindowMs: 60_000,
    loginBlockMs: 60_000,
    loginClientCapacity: 1024,
    now: () => 0,
    ...options,
  });
}

function loginRequest(address: string, userAgent: string): Request {
  return new Request("https://cherry.example/api/auth", {
    headers: {
      "X-Forwarded-For": address,
      "User-Agent": userAgent,
    },
  });
}
