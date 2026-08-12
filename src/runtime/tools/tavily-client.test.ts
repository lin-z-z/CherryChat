import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTavilyToolExecutor,
  HOSTED_TAVILY_SEARCH_URL,
} from "@/runtime/tools/tavily-client";

describe("Tavily tool", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts at most 50 configured results", () => {
    expect(() =>
      createTavilyToolExecutor({
        apiKey: "tvly-test-secret",
        baseUrl: "https://api.tavily.com",
        maxResults: 50,
      }),
    ).not.toThrow();
    expect(() =>
      createTavilyToolExecutor({
        apiKey: "tvly-test-secret",
        baseUrl: "https://api.tavily.com",
        maxResults: 51,
      }),
    ).toThrow();
  });

  it("uses a strict, bounded model-facing search schema", () => {
    const executor = createTavilyToolExecutor({
      apiKey: "tvly-test-secret",
      baseUrl: "https://api.tavily.com",
      maxResults: 5,
    });

    expect(executor.definition).toMatchObject({
      type: "function",
      function: {
        name: "web_search",
        strict: true,
        parameters: {
          properties: { query: { type: "string", maxLength: 200 } },
          required: ["query"],
          additionalProperties: false,
        },
      },
    });
    expect(executor.dedupeKey?.({ query: "  current release  " })).toBe(
      "current release",
    );
    expect(executor.dedupeKey?.({ query: "" })).toBeNull();
  });

  it("uses the fixed endpoint and returns bounded search results", async () => {
    let target = "";
    let request: RequestInit | undefined;
    const executor = createTavilyToolExecutor({
      apiKey: "tvly-test-secret",
      baseUrl: "https://search.example/tavily/search",
      maxResults: 2,
      fetchImplementation: async (input, init) => {
        target = String(input);
        request = init;
        return Response.json({
          query: "CherryChat",
          results: [
            {
              title: " First ",
              url: "https://example.com/one",
              content: " Result one ",
            },
            {
              title: "Second",
              url: "https://example.com/two",
              content: "Result two",
            },
            {
              title: "Ignored",
              url: "https://example.com/three",
              content: "Result three",
            },
          ],
        });
      },
    });

    const output = await executor.execute(
      { query: "CherryChat" },
      new AbortController().signal,
    );

    expect(target).toBe("https://search.example/tavily/search");
    expect(new Headers(request?.headers).get("authorization")).toBe(
      "Bearer tvly-test-secret",
    );
    expect(JSON.parse(String(request?.body))).toEqual({
      query: "CherryChat",
      max_results: 2,
    });
    expect(output).toEqual({
      query: "CherryChat",
      results: [
        {
          title: "First",
          url: "https://example.com/one",
          content: "Result one",
        },
        {
          title: "Second",
          url: "https://example.com/two",
          content: "Result two",
        },
      ],
    });
    expect(JSON.stringify(output)).not.toContain("tvly-test-secret");
  });

  it("uses the same-origin hosted route without sending a browser credential", async () => {
    let target = "";
    let request: RequestInit | undefined;
    const executor = createTavilyToolExecutor({
      mode: "hosted",
      maxResults: 3,
      fetchImplementation: async (input, init) => {
        target = String(input);
        request = init;
        return Response.json({
          query: "hosted",
          results: [
            {
              title: "Hosted source",
              url: "https://example.com/hosted",
              content: "Hosted result",
            },
          ],
        });
      },
    });

    await expect(
      executor.execute({ query: "hosted" }, new AbortController().signal),
    ).resolves.toMatchObject({
      results: [{ url: "https://example.com/hosted" }],
    });
    expect(target).toBe(HOSTED_TAVILY_SEARCH_URL);
    expect(new Headers(request?.headers).has("authorization")).toBe(false);
    expect(request?.credentials).toBe("same-origin");
    expect(JSON.parse(String(request?.body))).toEqual({
      query: "hosted",
      maxResults: 3,
      provider: "tavily",
    });
  });

  it("preserves hosted error codes and reports an expired site session", async () => {
    const onUnauthorized = vi.fn();
    const unauthorized = createTavilyToolExecutor({
      mode: "hosted",
      maxResults: 5,
      onUnauthorized,
      fetchImplementation: async () =>
        Response.json(
          { error: { code: "UNAUTHORIZED", message: "expired" } },
          { status: 401 },
        ),
    });
    await expect(
      unauthorized.execute({ query: "session" }, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "TOOL_AUTH_FAILED",
      status: 401,
      retryable: false,
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();

    const timeout = createTavilyToolExecutor({
      mode: "hosted",
      maxResults: 5,
      fetchImplementation: async () =>
        Response.json(
          { error: { code: "TOOL_REQUEST_TIMEOUT" } },
          { status: 504 },
        ),
    });
    await expect(
      timeout.execute({ query: "timeout" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "TOOL_REQUEST_TIMEOUT", retryable: true });

    const invalidDeploymentKey = createTavilyToolExecutor({
      mode: "hosted",
      maxResults: 5,
      fetchImplementation: async () =>
        Response.json({ error: { code: "TOOL_AUTH_FAILED" } }, { status: 502 }),
    });
    await expect(
      invalidDeploymentKey.execute(
        { query: "deployment key" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "TOOL_AUTH_FAILED", retryable: false });
  });

  it("maps HTTP and timeout failures to stable tool errors", async () => {
    const httpExecutor = createTavilyToolExecutor({
      apiKey: "tvly-test-secret",
      baseUrl: "https://api.tavily.com",
      maxResults: 5,
      fetchImplementation: async () => new Response(null, { status: 429 }),
    });
    await expect(
      httpExecutor.execute(
        { query: "rate limit" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "TOOL_RATE_LIMITED",
      status: 429,
      retryable: true,
    });

    vi.useFakeTimers();
    const timeoutExecutor = createTavilyToolExecutor({
      apiKey: "tvly-test-secret",
      baseUrl: "https://api.tavily.com",
      maxResults: 5,
      timeoutMs: 50,
      fetchImplementation: ((_target, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        })) as typeof fetch,
    });
    const pending = timeoutExecutor.execute(
      { query: "timeout" },
      new AbortController().signal,
    );
    const rejection = expect(pending).rejects.toEqual(
      expect.objectContaining({
        code: "TOOL_REQUEST_TIMEOUT",
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });

  it("keeps timeout and cancellation active while reading the response body", async () => {
    vi.useFakeTimers();
    const timeoutExecutor = createTavilyToolExecutor({
      apiKey: "tvly-test-secret",
      baseUrl: "https://api.tavily.com",
      maxResults: 5,
      timeoutMs: 50,
      fetchImplementation: async () => hangingJsonResponse(),
    });
    const timedOut = timeoutExecutor.execute(
      { query: "slow body" },
      new AbortController().signal,
    );
    const timeoutRejection = expect(timedOut).rejects.toMatchObject({
      code: "TOOL_REQUEST_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(50);
    await timeoutRejection;

    vi.useRealTimers();
    const controller = new AbortController();
    const abortExecutor = createTavilyToolExecutor({
      apiKey: "tvly-test-secret",
      baseUrl: "https://api.tavily.com",
      maxResults: 5,
      fetchImplementation: async () => hangingJsonResponse(),
    });
    const aborted = abortExecutor.execute(
      { query: "cancel" },
      controller.signal,
    );
    controller.abort(new DOMException("Stopped", "AbortError"));
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a request that was cancelled before execution begins", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Stopped", "AbortError"));
    const executor = createTavilyToolExecutor({
      apiKey: "tvly-test-secret",
      baseUrl: "https://api.tavily.com",
      maxResults: 5,
      fetchImplementation: async (_target, init) => {
        if (init?.signal?.aborted) throw init.signal.reason;
        return Response.json({ results: [] });
      },
    });

    await expect(
      executor.execute({ query: "cancelled" }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("drops missing and non-http sources without hiding valid results", async () => {
    const executor = createTavilyToolExecutor({
      apiKey: "tvly-test-secret",
      baseUrl: "https://api.tavily.com",
      maxResults: 5,
      fetchImplementation: async () =>
        Response.json({
          results: [
            { title: "Unsafe", url: "data:text/plain,secret" },
            { title: "Missing" },
            { title: "Valid", url: "https://example.com/safe" },
          ],
        }),
    });

    await expect(
      executor.execute({ query: "sources" }, new AbortController().signal),
    ).resolves.toEqual({
      query: "sources",
      results: [
        {
          title: "Valid",
          url: "https://example.com/safe",
          content: "",
        },
      ],
    });
  });

  it("rejects a Tavily response larger than the one MiB boundary", async () => {
    const executor = createTavilyToolExecutor({
      apiKey: "tvly-test-secret",
      baseUrl: "https://api.tavily.com",
      maxResults: 5,
      fetchImplementation: async () =>
        Response.json({
          results: [
            {
              title: "Large",
              url: "https://example.com/large",
              content: "x".repeat(1024 * 1024),
            },
          ],
        }),
    });

    await expect(
      executor.execute({ query: "large" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "TOOL_REQUEST_FAILED" });
  });
});

function hangingJsonResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start() {
        // The body stays open until the request signal cancels the reader.
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
