import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authenticateAccessCode,
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "@/server/auth";
import type { ServerConfig } from "@/server/config";
import { HostedRequestGuard } from "@/server/hosted-request-guard";
import { handleChatProxy, handleModelsProxy } from "@/server/upstream-proxy";

const hostedConfig: ServerConfig = {
  baseUrl: "https://fixed.example/api",
  models: ["allowed-model"],
  defaultModel: "allowed-model",
  titleModel: "allowed-model",
  disableByok: false,
  requestTimeouts: {
    modelListMs: 30_000,
    chatFirstByteMs: 300_000,
    chatIdleMs: 300_000,
    chatTotalMs: 1_800_000,
  },
  hosted: {
    apiKey: "deployment-super-secret",
    accessCodes: ["access-code"],
    authSecret: "h".repeat(32),
    webSearch: null,
  },
};

function chatRequest(
  mode: "byok" | "hosted",
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request(
    "https://cherry.example/api/chat?target=https://evil.example",
    {
      method: "POST",
      headers: {
        Origin: "https://cherry.example",
        "Content-Type": "application/json",
        "X-CherryChat-Mode": mode,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    },
  );
}

describe("fixed upstream proxy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores client target hints and injects only the hosted key", async () => {
    const token = hostedSessionToken();
    const fetchCalls: Array<{ target: RequestInfo | URL; init?: RequestInit }> =
      [];
    const fetchMock: typeof fetch = async (target, init) => {
      fetchCalls.push({ target, ...(init ? { init } : {}) });
      return new Response("data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const request = chatRequest(
      "hosted",
      {
        model: " allowed-model ",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      },
      {
        Cookie: `${SESSION_COOKIE_NAME}=${token}`,
        Authorization: "Bearer attacker-key",
        "X-Base-Url": "https://evil.example",
      },
    );

    const response = await handleChatProxy(request, hostedConfig, fetchMock);
    await response.text();

    expect(response.status).toBe(200);
    expect(fetchCalls).toHaveLength(1);
    const { target, init } = fetchCalls[0] ?? {};
    expect(target).toBe("https://fixed.example/api/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer deployment-super-secret",
    );
    expect(new Headers(init?.headers).has("x-base-url")).toBe(false);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "allowed-model",
    });
  });

  it("normalizes an omitted Hosted stream flag before forwarding", async () => {
    const calls: RequestInit[] = [];
    const fetchMock: typeof fetch = async (_target, init) => {
      if (init) calls.push(init);
      return Response.json({ choices: [] });
    };
    const response = await handleChatProxy(
      chatRequest(
        "hosted",
        {
          model: "deepseek-v4-flash",
          messages: [{ role: "user", content: "Hello" }],
          thinking: { type: "enabled" },
          reasoning_effort: "high",
        },
        authenticatedHostedHeaders(),
      ),
      {
        ...hostedConfig,
        models: ["deepseek-v4-flash"],
        defaultModel: "deepseek-v4-flash",
        titleModel: "deepseek-v4-flash",
      },
      fetchMock,
    );
    await response.text();

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.body))).toMatchObject({ stream: false });
  });

  it("forwards a BYOK key only to the deployment-fixed target", async () => {
    const calls: Array<{ target: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (target, init) => {
      calls.push({ target, ...(init ? { init } : {}) });
      return new Response("data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    };
    const response = await handleChatProxy(
      chatRequest(
        "byok",
        {
          model: "custom-model",
          messages: [{}],
          stream: true,
          provider_extension: { compatible: true },
        },
        {
          Authorization: "Bearer visitor-key",
          "X-Base-Url": "https://evil.example",
        },
      ),
      hostedConfig,
      fetchMock,
    );
    await response.text();

    const { target, init } = calls[0] ?? {};
    expect(target).toBe("https://fixed.example/api/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer visitor-key",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      provider_extension: { compatible: true },
    });
  });

  it("rejects unknown Hosted fields before contacting upstream", async () => {
    const fetchMock = vi.fn();
    const response = await handleChatProxy(
      chatRequest(
        "hosted",
        { ...validHostedBody(), n: 2 },
        authenticatedHostedHeaders(),
      ),
      hostedConfig,
      fetchMock as unknown as typeof fetch,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid DeepSeek thinking combinations before contacting upstream", async () => {
    const fetchMock = vi.fn();
    const response = await handleChatProxy(
      chatRequest(
        "hosted",
        {
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
          thinking: { type: "enabled" },
          reasoning_effort: "low",
        },
        authenticatedHostedHeaders(),
      ),
      {
        ...hostedConfig,
        models: ["deepseek-v4-pro"],
        defaultModel: "deepseek-v4-pro",
        titleModel: "deepseek-v4-pro",
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a valid retained GLM request to the fixed upstream", async () => {
    let forwardedBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_target, init?: RequestInit) => {
      forwardedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ choices: [] });
    });
    const glmConfig = {
      ...hostedConfig,
      models: ["glm-5.2"],
      defaultModel: "glm-5.2",
      titleModel: "glm-5.2",
    };
    const response = await handleChatProxy(
      chatRequest(
        "hosted",
        {
          model: "glm-5.2",
          messages: [
            { role: "user", content: "Search" },
            {
              role: "assistant",
              content: null,
              reasoning_content: "GLM private plan",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "web_search", arguments: "{}" },
                },
              ],
            },
            { role: "tool", content: "[]", tool_call_id: "call-1" },
          ],
          stream: false,
          thinking: { type: "enabled", clear_thinking: false },
          reasoning_effort: "high",
          temperature: 0.7,
          top_p: 0.8,
        },
        authenticatedHostedHeaders(),
      ),
      glmConfig,
      fetchMock,
    );
    await response.text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(forwardedBody).toMatchObject({
      model: "glm-5.2",
      thinking: { type: "enabled", clear_thinking: false },
      reasoning_effort: "high",
      temperature: 0.7,
      top_p: 0.8,
    });
  });

  it("rejects invalid GLM replay before fetch without reflecting private content", async () => {
    const fetchMock = vi.fn();
    const response = await handleChatProxy(
      chatRequest(
        "hosted",
        {
          model: "glm-5.2",
          messages: [
            {
              role: "assistant",
              content: null,
              reasoning_content: "must-not-be-reflected",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "web_search", arguments: "{}" },
                },
              ],
            },
          ],
          stream: true,
        },
        authenticatedHostedHeaders(),
      ),
      {
        ...hostedConfig,
        models: ["glm-5.2"],
        defaultModel: "glm-5.2",
        titleModel: "glm-5.2",
      },
      fetchMock as unknown as typeof fetch,
    );
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain("must-not-be-reflected");
    expect(text).not.toContain("fixed.example");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "qwen3.8-max",
      { reasoning_effort: "xhigh", temperature: 0.7, top_p: 0.8 },
      "Qwen retained plan",
    ],
    ["kimi-k3", { reasoning_effort: "max" }, "Kimi retained plan"],
  ] as const)(
    "forwards a valid retained %s request to the fixed upstream",
    async (model, fields, reasoningContent) => {
      let forwardedBody: Record<string, unknown> = {};
      const fetchMock = vi.fn(async (_target, init?: RequestInit) => {
        forwardedBody = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        return Response.json({ choices: [] });
      });
      const response = await handleChatProxy(
        chatRequest(
          "hosted",
          {
            model,
            messages: [
              { role: "user", content: "Previous" },
              {
                role: "assistant",
                content: "Previous answer",
                reasoning_content: reasoningContent,
              },
              { role: "user", content: "Continue" },
            ],
            stream: false,
            ...fields,
          },
          authenticatedHostedHeaders(),
        ),
        {
          ...hostedConfig,
          models: [model],
          defaultModel: model,
          titleModel: model,
        },
        fetchMock,
      );
      await response.text();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(forwardedBody).toMatchObject({ model, ...fields });
      expect(JSON.stringify(forwardedBody)).toContain(reasoningContent);
    },
  );

  it.each([
    ["qwen3.8-max", { enable_thinking: false }, "Qwen must-not-be-reflected"],
    ["kimi-k3", { temperature: 1 }, "Kimi must-not-be-reflected"],
  ] as const)(
    "rejects invalid %s replay before fetch",
    async (model, fields, reasoningContent) => {
      const fetchMock = vi.fn();
      const response = await handleChatProxy(
        chatRequest(
          "hosted",
          {
            model,
            messages: [
              {
                role: "assistant",
                content: "Answer",
                reasoning_content: reasoningContent,
              },
            ],
            stream: true,
            ...fields,
          },
          authenticatedHostedHeaders(),
        ),
        {
          ...hostedConfig,
          models: [model],
          defaultModel: model,
          titleModel: model,
        },
        fetchMock as unknown as typeof fetch,
      );
      const text = await response.text();

      expect(response.status).toBe(400);
      expect(text).not.toContain(reasoningContent);
      expect(text).not.toContain("fixed.example");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects cross-origin POST and disallowed hosted models before fetch", async () => {
    const fetchMock = vi.fn();
    const token = hostedSessionToken();
    const crossOrigin = chatRequest("hosted", validHostedBody(), {
      Origin: "https://evil.example",
      Cookie: `${SESSION_COOKIE_NAME}=${token}`,
    });
    expect(
      (
        await handleChatProxy(
          crossOrigin,
          hostedConfig,
          fetchMock as typeof fetch,
        )
      ).status,
    ).toBe(403);

    const disallowed = chatRequest(
      "hosted",
      { ...validHostedBody(), model: "other-model" },
      { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    );
    const response = await handleChatProxy(
      disallowed,
      hostedConfig,
      fetchMock as typeof fetch,
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("MODEL_NOT_ALLOWED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept BYOK when the deployment disables it", async () => {
    const response = await handleChatProxy(
      chatRequest(
        "byok",
        { model: "any", messages: [{}], stream: true },
        { Authorization: "Bearer user-key" },
      ),
      { ...hostedConfig, disableByok: true },
      vi.fn() as unknown as typeof fetch,
    );

    expect(response.status).toBe(403);
  });

  it("redacts arbitrary hosted keys from upstream errors", async () => {
    const token = hostedSessionToken();
    const response = await handleChatProxy(
      chatRequest("hosted", validHostedBody(), {
        Cookie: `${SESSION_COOKIE_NAME}=${token}`,
      }),
      hostedConfig,
      vi.fn(
        async () =>
          new Response("bad deployment-super-secret Bearer another-token", {
            status: 500,
          }),
      ) as unknown as typeof fetch,
    );
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain("deployment-super-secret");
    expect(text).not.toContain("another-token");
    expect(text).toContain("[REDACTED]");
  });

  it("serves the hosted model allowlist without contacting upstream", async () => {
    const token = hostedSessionToken();
    const fetchMock = vi.fn();
    const request = new Request("https://cherry.example/api/models", {
      headers: {
        "X-CherryChat-Mode": "hosted",
        Cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    const response = await handleModelsProxy(
      request,
      hostedConfig,
      fetchMock as typeof fetch,
    );

    expect(await response.json()).toMatchObject({
      data: [{ id: "allowed-model" }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("holds a concurrency lease until the client stream ends or is cancelled", async () => {
    const token = hostedSessionToken();
    const guard = new HostedRequestGuard({ chatConcurrencyLimit: 1 });
    let upstreamCancelled = false;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: partial\n\n"));
      },
      cancel() {
        upstreamCancelled = true;
      },
    });
    const response = await handleChatProxy(
      chatRequest("hosted", validHostedBody(), {
        Cookie: `${SESSION_COOKIE_NAME}=${token}`,
      }),
      hostedConfig,
      (async () =>
        new Response(upstreamBody, {
          headers: { "Content-Type": "text/event-stream" },
        })) as typeof fetch,
      guard,
    );

    expect(guard.activeCount("chat")).toBe(1);
    const limited = await handleChatProxy(
      chatRequest("hosted", validHostedBody(), {
        Cookie: `${SESSION_COOKIE_NAME}=${token}`,
      }),
      hostedConfig,
      vi.fn() as unknown as typeof fetch,
      guard,
    );
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: "HOSTED_CONCURRENCY_LIMIT" },
    });

    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(upstreamCancelled).toBe(true);
    expect(guard.activeCount("chat")).toBe(0);

    const resumed = await handleChatProxy(
      chatRequest("hosted", validHostedBody(), {
        Cookie: `${SESSION_COOKIE_NAME}=${token}`,
      }),
      hostedConfig,
      (async () => new Response("data: [DONE]\n\n")) as typeof fetch,
      guard,
    );
    await resumed.text();
    expect(resumed.status).toBe(200);
    await vi.waitFor(() => {
      expect(guard.activeCount("chat")).toBe(0);
    });
  });

  it("maps a chat first-byte timeout to a stable 504 response", async () => {
    vi.useFakeTimers();
    const guard = new HostedRequestGuard({ chatConcurrencyLimit: 1 });
    const fetchMock = vi.fn(
      (_target: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const pending = handleChatProxy(
      chatRequest("hosted", validHostedBody(), authenticatedHostedHeaders()),
      {
        ...hostedConfig,
        requestTimeouts: {
          ...hostedConfig.requestTimeouts,
          chatFirstByteMs: 100,
        },
      },
      fetchMock as unknown as typeof fetch,
      guard,
    );

    await vi.advanceTimersByTimeAsync(100);
    const response = await pending;

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_TIMEOUT" },
    });
    expect(guard.activeCount("chat")).toBe(0);
  });

  it("keeps caller cancellation distinct from a timeout", async () => {
    const caller = new AbortController();
    const request = chatRequest(
      "byok",
      { model: "model-a", messages: [{}], stream: true },
      { Authorization: "Bearer visitor-key" },
    );
    Object.defineProperty(request, "signal", { value: caller.signal });
    const pending = handleChatProxy(
      request,
      hostedConfig,
      ((_target, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        })) as typeof fetch,
    );

    caller.abort();
    const response = await pending;

    expect(response.status).toBe(499);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ABORTED" },
    });
  });
});

function validHostedBody() {
  return {
    model: "allowed-model",
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
  };
}

function authenticatedHostedHeaders(): Record<string, string> {
  const token = hostedSessionToken();
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

function hostedSessionToken(): string {
  const hosted = hostedConfig.hosted;
  if (!hosted) throw new Error("Hosted test configuration is missing");
  const codeId = authenticateAccessCode("access-code", hosted);
  if (!codeId) throw new Error("Hosted test access code is invalid");
  return createSessionToken(hosted.authSecret, codeId);
}
