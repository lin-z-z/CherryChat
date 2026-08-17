import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as deleteSession,
  POST as createSession,
} from "@/app/api/auth/route";
import { GET as getPublicConfig } from "@/app/api/config/route";
import {
  HOSTED_LOGIN_FAILURE_LIMIT,
  hostedRequestGuard,
} from "@/server/hosted-request-guard";

describe("public config and hosted session routes", () => {
  beforeEach(() => {
    hostedRequestGuard.reset();
    vi.stubEnv("OPENAI_API_KEY", "deployment-route-secret");
    vi.stubEnv("BASE_URL", "https://fixed.example/v1");
    vi.stubEnv("MODELS", "model-a,model-b");
    vi.stubEnv("DEFAULT_MODEL", "model-b");
    vi.stubEnv("ACCESS_CODE", "first-code,second-code");
    vi.stubEnv("AUTH_SECRET", "s".repeat(32));
    vi.stubEnv("TAVILY_API_KEY", "tvly-route-secret");
    vi.stubEnv("DISABLE_BYOK", "false");
  });

  afterEach(() => {
    hostedRequestGuard.reset();
    vi.unstubAllEnvs();
  });

  it("returns only public deployment fields", async () => {
    const response = await getPublicConfig(
      new Request("http://localhost/api/config"),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      byokEnabled: true,
      hostedEnabled: true,
      hostedWebSearchEnabled: true,
      hostedWebSearchProvider: "tavily",
      hostedWebSearchProviders: ["tavily"],
      hostedImageGenerationEnabled: false,
      hostedImageGenerationModel: null,
      hostedImageGenerationProfiles: [],
      hostedImageGenerationDefaultProfileId: null,
      imageGenerationTimeoutMs: 300_000,
      imageGenerationMaximumRequestBytes: 8 * 1024 * 1024,
      models: ["model-a", "model-b"],
      defaultModel: "model-b",
      titleModel: "model-b",
      requestTimeouts: {
        modelListMs: 30_000,
        chatFirstByteMs: 300_000,
        chatIdleMs: 300_000,
        chatTotalMs: 1_800_000,
      },
      authenticated: false,
    });
    expect(text).not.toContain("deployment-route-secret");
    expect(text).not.toContain("tvly-route-secret");
    expect(text).not.toContain("first-code");
    expect(text).not.toContain("second-code");
    expect(text).not.toContain("ssss");
    expect(text).not.toContain("fixed.example");
  });

  it("accepts any configured code, exposes only the signed cookie, and signs out", async () => {
    const wrong = await createSession(authRequest("wrong-code"));
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain("wrong-code");

    const accepted = await createSession(authRequest("  second-code  "));
    expect(accepted.status).toBe(200);
    const setCookie = accepted.headers.get("set-cookie");
    expect(setCookie).toContain("cherrychat_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain("second-code");
    if (!setCookie) throw new Error("Expected a hosted session cookie");

    const authenticated = await getPublicConfig(
      new Request("http://localhost/api/config", {
        headers: { Cookie: setCookie.split(";")[0] ?? "" },
      }),
    );
    expect(await authenticated.json()).toMatchObject({ authenticated: true });

    const signedOut = await deleteSession(
      new Request("http://localhost/api/auth", {
        method: "DELETE",
        headers: { Origin: "http://localhost" },
      }),
    );
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("accepts a browser Host origin when Next.js normalizes the request URL", async () => {
    const response = await createSession(
      new Request("http://localhost:3202/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: "127.0.0.1:3202",
          Origin: "http://127.0.0.1:3202",
        },
        body: JSON.stringify({ accessCode: "first-code" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("cherrychat_session=");
  });

  it("rate limits repeated access-code failures without echoing the code", async () => {
    const address = "203.0.113.90";
    for (let attempt = 1; attempt < HOSTED_LOGIN_FAILURE_LIMIT; attempt += 1) {
      const response = await createSession(
        authRequest("wrong-rate-code", {
          address,
          userAgent: "route-test-browser-one",
        }),
      );
      expect(response.status).toBe(401);
    }

    const limited = await createSession(
      authRequest("wrong-rate-code", {
        address,
        userAgent: "route-test-browser-two",
      }),
    );
    const text = await limited.text();

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(text).toContain("AUTH_RATE_LIMITED");
    expect(text).not.toContain("wrong-rate-code");
  });

  it("treats a malformed session cookie as unauthenticated", async () => {
    const response = await getPublicConfig(
      new Request("http://localhost/api/config", {
        headers: { Cookie: "cherrychat_session=%" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authenticated: false,
    });
  });
});

function authRequest(
  accessCode: string,
  client: { address?: string; userAgent?: string } = {},
): Request {
  return new Request("http://localhost/api/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      "User-Agent": client.userAgent ?? "route-test-browser",
      "X-Forwarded-For": client.address ?? "203.0.113.80",
    },
    body: JSON.stringify({ accessCode }),
  });
}
