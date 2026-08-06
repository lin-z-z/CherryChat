import { describe, expect, it, vi } from "vitest";

import { createOpenAIResponsesAgentProviderOptions } from "@/runtime/agent/ai-sdk/openai-responses-provider-fetch";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";

const validBody = {
  model: "gpt-5.5",
  input: [{ role: "user", content: "Hello" }],
  stream: true,
  store: false,
  include: ["reasoning.encrypted_content"],
};

describe("OpenAI Responses agent provider fetch", () => {
  it("keeps a normalized Responses endpoint browser-direct", async () => {
    const upstream = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response("ok");
      },
    );
    const provider = createOpenAIResponsesAgentProviderOptions(
      {
        mode: "byok",
        baseUrl: "https://api.example.test/gateway/v1/",
        apiKey: "sk-personal",
        modelId: "gpt-5.5",
        apiType: "openai-responses",
      },
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      upstream,
    );

    await provider.fetch(`${provider.baseURL}/responses`, {
      method: "POST",
      headers: { Authorization: "Bearer sk-personal" },
      body: JSON.stringify(validBody),
    });

    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe("https://api.example.test/gateway/v1/responses");
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get("Accept")).toBe("text/event-stream");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer sk-personal",
    );
  });

  it.each([
    ["wrong path", "https://api.example.test/v1/models", validBody],
    [
      "stored response",
      "https://api.example.test/v1/responses",
      { ...validBody, store: true },
    ],
    [
      "server response chain",
      "https://api.example.test/v1/responses",
      { ...validBody, previous_response_id: "response-1" },
    ],
    [
      "built-in tool",
      "https://api.example.test/v1/responses",
      { ...validBody, tools: [{ type: "web_search" }] },
    ],
  ])("rejects %s before the upstream request", async (_name, url, body) => {
    const upstream = vi.fn(async () => new Response("ok"));
    const provider = createOpenAIResponsesAgentProviderOptions(
      {
        mode: "byok",
        baseUrl: "https://api.example.test",
        apiKey: "secret",
        modelId: "gpt-5.5",
        apiType: "openai-responses",
      },
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      upstream,
    );

    await expect(
      provider.fetch(url, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects Hosted mode and empty personal credentials", () => {
    expect(() =>
      createOpenAIResponsesAgentProviderOptions(
        {
          mode: "hosted",
          baseUrl: "https://ignored.invalid",
          apiKey: "secret",
          modelId: "gpt-5.5",
          apiType: "openai-responses",
        },
        DEFAULT_REQUEST_TIMEOUT_POLICY,
      ),
    ).toThrow(/direct Custom API URL/u);
    expect(() =>
      createOpenAIResponsesAgentProviderOptions(
        {
          mode: "byok",
          baseUrl: "https://api.example.test",
          apiKey: " ",
          modelId: "gpt-5.5",
          apiType: "openai-responses",
        },
        DEFAULT_REQUEST_TIMEOUT_POLICY,
      ),
    ).toThrow(/API key/u);
  });
});
