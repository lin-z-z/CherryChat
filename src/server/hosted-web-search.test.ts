import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authenticateAccessCode,
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "@/server/auth";
import type { ServerConfig } from "@/server/config";
import { handleHostedWebSearch } from "@/server/hosted-web-search";
import { HostedRequestGuard } from "@/server/hosted-request-guard";

const config: ServerConfig = {
  baseUrl: "https://fixed.example",
  models: ["model-a"],
  defaultModel: "model-a",
  titleModel: "model-a",
  disableByok: false,
  requestTimeouts: {
    modelListMs: 30_000,
    chatFirstByteMs: 300_000,
    chatIdleMs: 300_000,
    chatTotalMs: 1_800_000,
  },
  hosted: {
    apiKey: "deployment-model-secret",
    accessCodes: ["access-code"],
    authSecret: "h".repeat(32),
    tavilyApiKey: "tvly-deployment-secret",
    tavilyBaseUrl: "https://search.example/tavily",
  },
};

describe("hosted web search", () => {
  afterEach(() => vi.useRealTimers());

  it("requires a hosted session and sends only the deployment key to the fixed target", async () => {
    const calls: Array<{ target: RequestInfo | URL; init?: RequestInit }> = [];
    const response = await handleHostedWebSearch(
      webSearchRequest(
        { query: "CherryChat", maxResults: 50 },
        authenticatedHeaders({
          Authorization: "Bearer attacker-key",
          "X-Base-Url": "https://evil.example",
        }),
      ),
      config,
      (async (target, init) => {
        calls.push({ target, ...(init ? { init } : {}) });
        return Response.json({
          results: [
            {
              title: "CherryChat",
              url: "https://example.com/cherrychat",
              content: "Current information",
            },
          ],
        });
      }) as typeof fetch,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [{ url: "https://example.com/cherrychat" }],
    });
    expect(calls).toHaveLength(1);
    const { target, init } = calls[0] ?? {};
    expect(target).toBe("https://search.example/tavily/search");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer tvly-deployment-secret",
    );
    expect(new Headers(init?.headers).has("x-base-url")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "CherryChat",
      max_results: 50,
    });
  });

  it("rejects missing sessions, cross-origin requests and unavailable hosted search before fetch", async () => {
    const fetchMock = vi.fn();
    const unauthenticated = await handleHostedWebSearch(
      webSearchRequest({ query: "test", maxResults: 5 }),
      config,
      fetchMock as unknown as typeof fetch,
    );
    expect(unauthenticated.status).toBe(401);

    const crossOrigin = await handleHostedWebSearch(
      webSearchRequest(
        { query: "test", maxResults: 5 },
        authenticatedHeaders({ Origin: "https://evil.example" }),
      ),
      config,
      fetchMock as unknown as typeof fetch,
    );
    expect(crossOrigin.status).toBe(403);

    const unavailable = await handleHostedWebSearch(
      webSearchRequest(
        { query: "test", maxResults: 5 },
        authenticatedHeaders(),
      ),
      {
        ...config,
        hosted: config.hosted ? { ...config.hosted, tavilyApiKey: null } : null,
      },
      fetchMock as unknown as typeof fetch,
    );
    expect(unavailable.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a malformed session cookie as unauthorized", async () => {
    const response = await handleHostedWebSearch(
      webSearchRequest(
        { query: "test", maxResults: 5 },
        { Cookie: `${SESSION_COOKIE_NAME}=%` },
      ),
      config,
      vi.fn() as unknown as typeof fetch,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  it.each([
    [{ query: "", maxResults: 5 }],
    [{ query: "test", maxResults: 0 }],
    [{ query: "test", maxResults: 51 }],
    [{ query: "test", maxResults: 5, target: "https://evil.example" }],
  ])("rejects an invalid or extended request body", async (body) => {
    const fetchMock = vi.fn();
    const response = await handleHostedWebSearch(
      webSearchRequest(body, authenticatedHeaders()),
      config,
      fetchMock as unknown as typeof fetch,
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 502, "TOOL_AUTH_FAILED"],
    [403, 502, "TOOL_AUTH_FAILED"],
    [429, 429, "TOOL_RATE_LIMITED"],
    [500, 503, "TOOL_SERVICE_UNAVAILABLE"],
  ])(
    "maps Tavily HTTP %i to a safe hosted error",
    async (upstream, status, code) => {
      const response = await handleHostedWebSearch(
        webSearchRequest(
          { query: "errors", maxResults: 5 },
          authenticatedHeaders(),
        ),
        config,
        (async () =>
          new Response("secret upstream detail", {
            status: upstream,
          })) as typeof fetch,
      );
      const text = await response.text();

      expect(response.status).toBe(status);
      expect(JSON.parse(text)).toMatchObject({ error: { code } });
      expect(text).not.toContain("secret upstream detail");
      expect(text).not.toContain("tvly-deployment-secret");
    },
  );

  it("maps the hosted Tavily timeout", async () => {
    const guard = new HostedRequestGuard({ webSearchConcurrencyLimit: 1 });
    const timeout = handleHostedWebSearch(
      webSearchRequest(
        { query: "timeout", maxResults: 5 },
        authenticatedHeaders(),
      ),
      config,
      hangingFetch(),
      10,
      guard,
    );
    const response = await timeout;
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "TOOL_REQUEST_TIMEOUT" },
    });
    expect(guard.activeCount("web-search")).toBe(0);
  });

  it("holds one search lease and releases it after cancellation", async () => {
    const guard = new HostedRequestGuard({ webSearchConcurrencyLimit: 1 });
    const controller = new AbortController();
    const firstRequest = webSearchRequest(
      { query: "first", maxResults: 5 },
      authenticatedHeaders(),
    );
    Object.defineProperty(firstRequest, "signal", {
      value: controller.signal,
    });
    const first = handleHostedWebSearch(
      firstRequest,
      config,
      hangingFetch(),
      undefined,
      guard,
    );
    await vi.waitFor(() => {
      expect(guard.activeCount("web-search")).toBe(1);
    });

    const limited = await handleHostedWebSearch(
      webSearchRequest(
        { query: "second", maxResults: 5 },
        authenticatedHeaders(),
      ),
      config,
      vi.fn() as unknown as typeof fetch,
      undefined,
      guard,
    );
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: "HOSTED_CONCURRENCY_LIMIT" },
    });

    controller.abort();
    expect((await first).status).toBe(499);
    expect(guard.activeCount("web-search")).toBe(0);

    const resumed = await handleHostedWebSearch(
      webSearchRequest(
        { query: "third", maxResults: 5 },
        authenticatedHeaders(),
      ),
      config,
      (async () => Response.json({ results: [] })) as typeof fetch,
      undefined,
      guard,
    );
    expect(resumed.status).toBe(200);
    expect(guard.activeCount("web-search")).toBe(0);
  });

  it("releases the search lease after an upstream error", async () => {
    const guard = new HostedRequestGuard({ webSearchConcurrencyLimit: 1 });
    const response = await handleHostedWebSearch(
      webSearchRequest(
        { query: "failure", maxResults: 5 },
        authenticatedHeaders(),
      ),
      config,
      (async () =>
        new Response("failure detail", { status: 500 })) as typeof fetch,
      undefined,
      guard,
    );

    expect(response.status).toBe(503);
    expect(guard.activeCount("web-search")).toBe(0);
  });

  it("keeps caller cancellation distinct from a timeout", async () => {
    const controller = new AbortController();
    const cancelledRequest = webSearchRequest(
      { query: "cancel", maxResults: 5 },
      authenticatedHeaders(),
    );
    Object.defineProperty(cancelledRequest, "signal", {
      value: controller.signal,
    });
    const cancelled = handleHostedWebSearch(
      cancelledRequest,
      config,
      hangingFetch(),
    );
    controller.abort();
    const cancelledResponse = await cancelled;
    expect(cancelledResponse.status).toBe(499);
    await expect(cancelledResponse.json()).resolves.toMatchObject({
      error: { code: "TOOL_REQUEST_ABORTED" },
    });
  });
});

function authenticatedHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const hosted = config.hosted;
  if (!hosted) throw new Error("Hosted test configuration is missing");
  const codeId = authenticateAccessCode("access-code", hosted);
  if (!codeId) throw new Error("Hosted test access code is invalid");
  const token = createSessionToken(hosted.authSecret, codeId);
  return {
    Cookie: `${SESSION_COOKIE_NAME}=${token}`,
    ...extra,
  };
}

function webSearchRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://cherry.example/api/web-search?target=ignored", {
    method: "POST",
    headers: {
      Origin: "https://cherry.example",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function hangingFetch(): typeof fetch {
  return ((_target, init) =>
    new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason),
      );
    })) as typeof fetch;
}
