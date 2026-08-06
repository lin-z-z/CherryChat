import { describe, expect, it, vi } from "vitest";

import { createAnthropicAgentProviderOptions } from "@/runtime/agent/ai-sdk/anthropic-provider-fetch";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";

describe("controlled Anthropic provider fetch", () => {
  it("locks direct Anthropic URL, model, headers and disabled thinking", async () => {
    const calls: Array<{ target: RequestInfo | URL; init?: RequestInit }> = [];
    const upstream: typeof fetch = vi.fn(async (target, init) => {
      calls.push({ target, ...(init ? { init } : {}) });
      return Response.json({ content: [] });
    });
    const options = createAnthropicAgentProviderOptions(
      directConnection(),
      "claude-sonnet-4-6",
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      true,
      upstream,
    );

    expect(options).toMatchObject({
      name: "anthropic",
      baseURL: "https://api.anthropic.test/v1",
      apiKey: "anthropic-key",
    });
    expect(options.headers).toBeUndefined();
    await options.fetch("https://api.anthropic.test/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": "anthropic-key",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        stream: true,
        max_tokens: 8_192,
        tools: [
          {
            name: "web_search",
            description: "Search",
            input_schema: { type: "object" },
          },
        ],
      }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.target).toBe("https://api.anthropic.test/v1/messages");
    expect(new Headers(calls[0]?.init?.headers).get("accept")).toBe(
      "text/event-stream",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      model: "claude-sonnet-4-6",
      thinking: { type: "disabled" },
      tools: [{ name: "web_search" }],
    });
  });

  it("adds Bearer authentication only for New API Anthropic", () => {
    const options = createAnthropicAgentProviderOptions(
      {
        ...directConnection(),
        apiType: "new-api",
        endpointType: "anthropic",
      },
      "claude-sonnet-4-6",
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      false,
    );

    expect(options.headers).toEqual({
      Authorization: "Bearer anthropic-key",
    });
    expect(options.apiKey).toBe("anthropic-key");
  });

  it.each([
    ["path", "https://api.anthropic.test/v1/other", "POST", baseBody()],
    [
      "query",
      "https://api.anthropic.test/v1/messages?beta=1",
      "POST",
      baseBody(),
    ],
    ["method", "https://api.anthropic.test/v1/messages", "GET", baseBody()],
    [
      "model",
      "https://api.anthropic.test/v1/messages",
      "POST",
      { ...baseBody(), model: "another-model" },
    ],
    [
      "server tool",
      "https://api.anthropic.test/v1/messages",
      "POST",
      {
        ...baseBody(),
        tools: [{ type: "web_search_20260209", name: "web_search" }],
      },
    ],
  ])(
    "rejects an out-of-contract %s before fetch",
    async (_case, url, method, body) => {
      const upstream = vi.fn();
      const options = createAnthropicAgentProviderOptions(
        directConnection(),
        "claude-sonnet-4-6",
        DEFAULT_REQUEST_TIMEOUT_POLICY,
        false,
        upstream,
      );

      await expect(
        options.fetch(url, {
          method,
          body: JSON.stringify(body),
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it("rejects Hosted, wrong endpoint and empty keys", () => {
    expect(() =>
      createAnthropicAgentProviderOptions(
        { ...directConnection(), mode: "hosted" },
        "claude-sonnet-4-6",
        DEFAULT_REQUEST_TIMEOUT_POLICY,
        false,
      ),
    ).toThrow(/direct Custom API URL/u);
    expect(() =>
      createAnthropicAgentProviderOptions(
        { ...directConnection(), apiType: "gemini" },
        "claude-sonnet-4-6",
        DEFAULT_REQUEST_TIMEOUT_POLICY,
        false,
      ),
    ).toThrow(/not Anthropic/u);
    expect(() =>
      createAnthropicAgentProviderOptions(
        { ...directConnection(), apiKey: "" },
        "claude-sonnet-4-6",
        DEFAULT_REQUEST_TIMEOUT_POLICY,
        false,
      ),
    ).toThrow(/API key/u);
  });
});

function directConnection() {
  return {
    mode: "byok" as const,
    baseUrl: "https://api.anthropic.test/v1/",
    apiKey: "anthropic-key",
    modelId: "claude-sonnet-4-6",
    apiType: "anthropic" as const,
  };
}

function baseBody() {
  return {
    model: "claude-sonnet-4-6",
    max_tokens: 8_192,
    messages: [{ role: "user", content: "Hello" }],
  };
}
