import { describe, expect, it, vi } from "vitest";

import {
  createOpenAICompatibleAgentProviderOptions,
  type ChatCompletionSseLimits,
  validateChatCompletionStream,
} from "@/runtime/agent/ai-sdk/openai-compatible-provider-fetch";
import { TRUNCATED_CHAT_COMPLETION_FINISH_REASON } from "@/runtime/agent/ai-sdk/openai-compatible-stream-contract";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";

describe("OpenAI-compatible agent provider fetch", () => {
  it("keeps an absolute BYOK endpoint browser-direct", async () => {
    const upstream = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response("data: [DONE]\n\n");
      },
    );
    const provider = createOpenAICompatibleAgentProviderOptions(
      {
        mode: "byok",
        baseUrl: "https://api.example.test/gateway/v1",
        apiKey: "sk-personal",
        modelId: "grok-4.5",
        apiType: "openai-compatible",
      },
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      upstream,
    );

    const response = await provider.fetch(
      `${provider.baseURL}/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: "Bearer sk-personal" },
        body: JSON.stringify({ stream: true }),
      },
    );
    await response.text();

    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe("https://api.example.test/gateway/v1/chat/completions");
    expect(init?.credentials).toBeUndefined();
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer sk-personal",
    );
    expect(new Headers(init?.headers).get("Accept")).toBe("text/event-stream");
  });

  it("rewrites hosted requests only to the fixed same-origin route", async () => {
    const upstream = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response("ok");
      },
    );
    const provider = createOpenAICompatibleAgentProviderOptions(
      {
        mode: "hosted",
        baseUrl: "https://attacker.invalid",
        apiKey: "must-not-leak",
        modelId: "grok-4.5",
        apiType: "openai",
      },
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      upstream,
    );

    const response = await provider.fetch(
      `${provider.baseURL}/chat/completions`,
      {
        method: "POST",
        headers: provider.headers,
        body: "{}",
      },
    );
    await response.text();

    const [url, init] = upstream.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe("/api/chat");
    expect(init?.credentials).toBe("same-origin");
    expect(headers.get("X-CherryChat-Mode")).toBe("hosted");
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Accept")).toBe("application/json");
    expect(JSON.stringify([url, init])).not.toContain("must-not-leak");
  });

  it("rejects provider attempts outside Chat Completions", async () => {
    const upstream = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response("ok");
      },
    );
    const provider = createOpenAICompatibleAgentProviderOptions(
      {
        mode: "hosted",
        baseUrl: "",
        apiKey: "",
        modelId: "grok-4.5",
        apiType: "openai",
      },
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      upstream,
    );

    await expect(
      provider.fetch("https://cherrychat.invalid/v1/models"),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("marks a truncated stream after preserving its received bytes", async () => {
    const provider = createOpenAICompatibleAgentProviderOptions(
      {
        mode: "byok",
        baseUrl: "https://api.example.test",
        apiKey: "secret",
        modelId: "model-a",
        apiType: "openai-compatible",
      },
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      async () =>
        new Response(
          'data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
        ),
    );

    const response = await provider.fetch(
      `${provider.baseURL}/chat/completions`,
      {
        method: "POST",
        body: JSON.stringify({ stream: true }),
      },
    );

    const text = await response.text();
    expect(text).toContain('"content":"partial"');
    expect(text).toContain("cherrychat_stream_protocol_error");
  });

  it("accepts an explicit finish reason without a DONE sentinel", async () => {
    const provider = createOpenAICompatibleAgentProviderOptions(
      {
        mode: "byok",
        baseUrl: "https://api.example.test",
        apiKey: "secret",
        modelId: "model-a",
        apiType: "openai-compatible",
      },
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      async () =>
        new Response(
          'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        ),
    );

    const response = await provider.fetch(
      `${provider.baseURL}/chat/completions`,
      {
        method: "POST",
        body: JSON.stringify({ stream: true }),
      },
    );

    await expect(response.text()).resolves.toContain('"stop"');
  });

  it("does not treat a secondary choice as the primary terminal event", async () => {
    const provider = createOpenAICompatibleAgentProviderOptions(
      {
        mode: "byok",
        baseUrl: "https://api.example.test",
        apiKey: "secret",
        modelId: "model-a",
        apiType: "openai-compatible",
      },
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      async () =>
        new Response(
          'data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null},{"index":1,"delta":{},"finish_reason":"stop"}]}\n\n',
        ),
    );

    const response = await provider.fetch(
      `${provider.baseURL}/chat/completions`,
      {
        method: "POST",
        body: JSON.stringify({ stream: true }),
      },
    );

    await expect(response.text()).resolves.toContain(
      TRUNCATED_CHAT_COMPLETION_FINISH_REASON,
    );
  });

  it.each([
    ["total bytes", "12345", { maximumTotalBytes: 4 }],
    ["line bytes", "data: 12345", { maximumLineBytes: 8 }],
    ["event bytes", "data: 1\ndata: 2\n", { maximumEventBytes: 12 }],
    ["data lines", "data: 1\ndata: 2\n", { maximumDataLinesPerEvent: 1 }],
    ["events", "data: {}\n\ndata: {}\n\n", { maximumEvents: 1 }],
  ] as const)(
    "cancels a stream that exceeds its %s limit",
    async (_name, text, override) => {
      let cancelled = false;
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
        },
        cancel() {
          cancelled = true;
        },
      });
      const limits = {
        maximumTotalBytes: 128,
        maximumLineBytes: 64,
        maximumEventBytes: 64,
        maximumDataLinesPerEvent: 8,
        maximumEvents: 8,
        ...override,
      } satisfies ChatCompletionSseLimits;
      const response = validateChatCompletionStream(
        new Response(source),
        limits,
      );

      await expect(response.text()).rejects.toMatchObject({
        code: "STREAM_PROTOCOL_ERROR",
      });
      expect(cancelled).toBe(true);
    },
  );

  it("counts highly fragmented line bytes without re-encoding the accumulated line", async () => {
    const chunks = Array.from({ length: 2_048 }, () => new Uint8Array([0x61]));
    chunks.push(new Uint8Array([0x0a, 0x0a]));
    let index = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index];
        index += 1;
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      const response = validateChatCompletionStream(new Response(source), {
        maximumTotalBytes: 4_096,
        maximumLineBytes: 2_048,
        maximumEventBytes: 4_096,
        maximumDataLinesPerEvent: 8,
        maximumEvents: 8,
      });

      await expect(response.text()).resolves.toContain(
        TRUNCATED_CHAT_COMPLETION_FINISH_REASON,
      );
      expect(encode.mock.calls.length).toBeLessThan(10);
    } finally {
      encode.mockRestore();
    }
  });
});
