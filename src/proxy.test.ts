import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "@/proxy";

describe("security proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("overrides untrusted policy headers with one nonce-bound policy", () => {
    const request = new NextRequest("https://chat.example/conversation", {
      headers: {
        "content-security-policy": "default-src *",
        "x-nonce": "attacker-controlled",
        "x-request-marker": "preserved",
      },
    });

    const response = proxy(request);
    const nonce = response.headers.get("x-middleware-request-x-nonce");
    const responsePolicy = response.headers.get("content-security-policy");
    const requestPolicy = response.headers.get(
      "x-middleware-request-content-security-policy",
    );

    expect(nonce).toMatch(/^[a-f0-9]{32}$/u);
    expect(responsePolicy).toBe(requestPolicy);
    expect(responsePolicy).toContain(
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    );
    expect(responsePolicy).toContain("object-src 'none'");
    expect(responsePolicy).toContain("frame-ancestors 'none'");
    expect(responsePolicy).not.toContain("attacker-controlled");
    expect(response.headers.get("x-middleware-request-x-request-marker")).toBe(
      "preserved",
    );
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });

  it("adds development-only script and connection sources explicitly", () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = proxy(
      new NextRequest("http://127.0.0.1:3000/conversation"),
    );
    const policy = response.headers.get("content-security-policy");

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' https: http: ws: wss:");
  });

  it("keeps API, framework assets, icons, and prefetches outside the matcher", () => {
    expect(config.matcher).toEqual([
      {
        source:
          "/((?!api|_next/static|_next/image|icon(?:-\\d+)?\\.(?:png|svg)|favicon.ico).*)",
        missing: [
          { type: "header", key: "next-router-prefetch" },
          { type: "header", key: "purpose", value: "prefetch" },
        ],
      },
    ]);
  });
});
