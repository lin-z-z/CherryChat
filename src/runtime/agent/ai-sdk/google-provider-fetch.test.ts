import { describe, expect, it, vi } from "vitest";

import { createGoogleAgentProviderOptions } from "@/runtime/agent/ai-sdk/google-provider-fetch";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";

const validBody = {
  contents: [{ role: "user", parts: [{ text: "Hello" }] }],
  tools: [
    {
      functionDeclarations: [
        {
          name: "web_search",
          parameters: { type: "OBJECT" },
        },
      ],
    },
  ],
};

describe("Google agent provider fetch", () => {
  it("keeps direct Gemini generation browser-direct", async () => {
    const upstream = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({ candidates: [] });
      },
    );
    const provider = createGoogleAgentProviderOptions(
      connection("gemini"),
      "gemini-3.1-pro",
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      upstream,
    );

    await provider.fetch?.(
      `${provider.baseURL}/models/gemini-3.1-pro:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "x-goog-api-key": "gemini-key" },
        body: JSON.stringify(validBody),
      },
    );

    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:streamGenerateContent?alt=sse",
    );
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get("Accept")).toBe("text/event-stream");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("gemini-key");
    expect(provider.headers).toBeUndefined();
  });

  it("adds Bearer authentication for New API Gemini", async () => {
    const upstream = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({ candidates: [] });
      },
    );
    const provider = createGoogleAgentProviderOptions(
      {
        ...connection("new-api"),
        baseUrl: "https://new-api.example.test/v1",
        endpointType: "gemini",
      },
      "gemini-3.1-pro",
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      upstream,
    );

    expect(provider.baseURL).toBe("https://new-api.example.test/v1beta");
    expect(provider.headers).toEqual({
      Authorization: "Bearer gemini-key",
    });
    await provider.fetch?.(
      `${provider.baseURL}/models/gemini-3.1-pro:generateContent`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer gemini-key",
          "x-goog-api-key": "gemini-key",
        },
        body: JSON.stringify({ contents: [] }),
      },
    );

    const [, init] = upstream.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer gemini-key",
    );
  });

  it.each([
    [
      "wrong origin",
      "https://other.example.test/v1beta/models/gemini:generateContent",
      validBody,
      "POST",
    ],
    [
      "wrong model",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
      validBody,
      "POST",
    ],
    [
      "wrong path",
      "https://generativelanguage.googleapis.com/v1beta/models",
      validBody,
      "POST",
    ],
    [
      "wrong method",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent",
      validBody,
      "GET",
    ],
    [
      "unexpected query",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent?key=secret",
      validBody,
      "POST",
    ],
    [
      "built-in tool",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent",
      { ...validBody, tools: [{ googleSearch: {} }] },
      "POST",
    ],
  ])("rejects %s before fetch", async (_name, url, body, method) => {
    const upstream = vi.fn(async () => Response.json({ candidates: [] }));
    const provider = createGoogleAgentProviderOptions(
      connection("gemini"),
      "gemini-3.1-pro",
      DEFAULT_REQUEST_TIMEOUT_POLICY,
      upstream,
    );

    await expect(
      provider.fetch?.(url, {
        method,
        body: JSON.stringify(body),
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects Hosted, non-Gemini endpoints, and empty keys", () => {
    expect(() =>
      createGoogleAgentProviderOptions(
        { ...connection("gemini"), mode: "hosted" },
        "gemini-3.1-pro",
        DEFAULT_REQUEST_TIMEOUT_POLICY,
      ),
    ).toThrow(/direct Custom API URL/u);
    expect(() =>
      createGoogleAgentProviderOptions(
        { ...connection("new-api"), endpointType: "openai-chat" },
        "gemini-3.1-pro",
        DEFAULT_REQUEST_TIMEOUT_POLICY,
      ),
    ).toThrow(/not Gemini/u);
    expect(() =>
      createGoogleAgentProviderOptions(
        { ...connection("gemini"), apiKey: " " },
        "gemini-3.1-pro",
        DEFAULT_REQUEST_TIMEOUT_POLICY,
      ),
    ).toThrow(/API key/u);
  });
});

function connection(apiType: "gemini" | "new-api") {
  return {
    mode: "byok" as const,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
    apiKey: "gemini-key",
    modelId: "gemini-3.1-pro",
    apiType,
  };
}
