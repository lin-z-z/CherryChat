import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import type { ChatApiType, ConnectionMode } from "@/runtime/chat/types";
import {
  createChatTransport,
  type ChatTransportConnection,
} from "@/runtime/transport/chat-transport-factory";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";

const request = {
  model: "reasoning-model",
  messages: [{ role: "user", content: "Hello" }],
  reasoning: { mode: "effort", effort: "high" },
  stream: false,
} satisfies ChatCompletionsRequest;

describe("chat transport factory", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects Gemini, Anthropic, and Responses adapters by API type", async () => {
    const calls: string[] = [];
    const fetchMock: typeof fetch = async (target) => {
      calls.push(String(target));
      if (String(target).includes("generativelanguage")) {
        return Response.json({ models: [] });
      }
      if (String(target).endsWith("/v1/responses")) {
        return Response.json({ output: [] });
      }
      return Response.json({ data: [] });
    };

    const gemini = createChatTransport(
      connection("gemini", "https://generativelanguage.googleapis.com"),
      fetchMock,
    );
    const anthropic = createChatTransport(
      connection("anthropic", "https://api.anthropic.com"),
      fetchMock,
    );
    const responses = createChatTransport(
      connection("openai-responses", "https://api.openai.com"),
      fetchMock,
    );

    await gemini.listModels();
    await anthropic.listModels();
    await responses.createChatCompletion(request);

    expect(calls).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      "https://api.anthropic.com/v1/models",
      "https://api.openai.com/v1/responses",
    ]);
  });

  it.each(["openai", "new-api", "openai-compatible"] as const)(
    "routes %s through standard Chat Completions",
    async (apiType) => {
      let targetUrl = "";
      let capturedBody: Record<string, unknown> | null = null;
      const transport = createChatTransport(
        connection(apiType, "https://provider.example/v1"),
        async (target, init) => {
          targetUrl = String(target);
          capturedBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return Response.json({ choices: [] });
        },
      );

      await transport.createChatCompletion(request);

      expect(targetUrl).toBe("https://provider.example/v1/chat/completions");
      expect(capturedBody).toMatchObject({ reasoning_effort: "high" });
    },
  );

  it.each([
    ["openai-responses", "/v1/responses"],
    ["anthropic", "/v1/messages"],
    ["gemini", "/v1beta/models/reasoning-model:generateContent"],
  ] as const)(
    "uses New API %s metadata for chat while retaining generic discovery",
    async (endpointType, expectedChatPath) => {
      const calls: Array<{
        url: string;
        headers: Headers;
      }> = [];
      const transport = createChatTransport(
        {
          ...connection("new-api", "https://new-api.example"),
          endpointType,
        },
        async (target, init) => {
          calls.push({
            url: String(target),
            headers: new Headers(init?.headers),
          });
          if (String(target).endsWith("/v1/models")) {
            return Response.json({ data: [] });
          }
          if (endpointType === "gemini") {
            return Response.json({ candidates: [] });
          }
          if (endpointType === "openai-responses") {
            return Response.json({ output: [] });
          }
          return Response.json({ content: [] });
        },
      );

      await transport.listModels();
      const { reasoning, ...plainRequest } = request;
      expect(reasoning).toBeDefined();
      await transport.createChatCompletion(plainRequest);

      expect(calls[0]?.url).toBe("https://new-api.example/v1/models");
      expect(calls[1]?.url).toBe(`https://new-api.example${expectedChatPath}`);
      expect(calls[1]?.headers.get("authorization")).toBe("Bearer test-key");
    },
  );

  it("keeps hosted mode on the same-origin adapter regardless of API type", async () => {
    let targetUrl: RequestInfo | URL | null = null;
    const fetchMock: typeof fetch = async (target) => {
      targetUrl = target;
      return Response.json({ data: [] });
    };
    const transport = createChatTransport(
      {
        ...connection("gemini", "https://generativelanguage.googleapis.com"),
        mode: "hosted",
      },
      fetchMock,
    );

    await transport.listModels();

    expect(targetUrl).toBe("/api/models");
  });

  it.each([
    ["openai", "https://api.openai.com"],
    ["openai-responses", "https://api.openai.com"],
    ["anthropic", "https://api.anthropic.com"],
    ["gemini", "https://generativelanguage.googleapis.com"],
    ["new-api", "https://new-api.example"],
    ["openai-compatible", "https://compatible.example"],
  ] as const)(
    "applies the shared model-list timeout to %s",
    async (apiType, baseUrl) => {
      vi.useFakeTimers();
      const transport = createChatTransport(
        connection(apiType, baseUrl),
        ((_target, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          })) as typeof fetch,
        {
          ...DEFAULT_REQUEST_TIMEOUT_POLICY,
          modelListMs: 50,
        },
      );
      const pending = transport.listModels();
      const rejection = expect(pending).rejects.toMatchObject({
        code: "REQUEST_TIMEOUT",
      });

      await vi.advanceTimersByTimeAsync(50);
      await rejection;
    },
  );
});

function connection(
  apiType: ChatApiType,
  baseUrl: string,
  mode: ConnectionMode = "byok",
): ChatTransportConnection {
  return {
    mode,
    baseUrl,
    apiKey: "test-key",
    modelId: "reasoning-model",
    apiType,
  };
}
