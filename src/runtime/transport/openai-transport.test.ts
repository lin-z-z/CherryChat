import { describe, expect, it, vi } from "vitest";

import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import { buildTitleRequest } from "@/runtime/chat/title-generation";
import {
  ChatTransportError,
  errorCodeForStatus,
  toMessageError,
} from "@/runtime/transport/chat-errors";
import type { NonStreamingChatCompletionsRequest } from "@/runtime/transport/chat-transport";
import {
  createByokDirectTransport,
  createSameOriginTransport,
  normalizeDirectBaseUrl,
} from "@/runtime/transport/openai-transport";
import {
  ERROR_RESPONSE_MAX_BYTES,
  MAX_MODEL_LIST_ITEMS,
  MODEL_LIST_RESPONSE_MAX_BYTES,
} from "@/runtime/transport/response-reader";

const request = {
  model: "model-a",
  messages: [{ role: "user", content: "Hello" }],
  stream: false,
} satisfies ChatCompletionsRequest;

describe("OpenAI-compatible transports", () => {
  it("normalizes /v1 and sends direct BYOK requests without CherryChat routes", async () => {
    const fetchCalls: Array<{ target: RequestInfo | URL; init?: RequestInit }> =
      [];
    const fetchMock: typeof fetch = async (target, init) => {
      fetchCalls.push({ target, ...(init ? { init } : {}) });
      return Response.json({ data: [] });
    };
    const transport = createByokDirectTransport(
      "https://provider.example/custom/v1/",
      "user-secret",
      fetchMock,
    );
    await transport.listModels();

    const { target: url, init } = fetchCalls[0] ?? {};
    expect(url).toBe("https://provider.example/custom/v1/models");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer user-secret",
    );
  });

  it("uses only same-origin fixed routes for hosted mode", async () => {
    const fetchCalls: Array<{ target: RequestInfo | URL; init?: RequestInit }> =
      [];
    const fetchMock: typeof fetch = async (target, init) => {
      fetchCalls.push({ target, ...(init ? { init } : {}) });
      return Response.json({ choices: [] });
    };
    const transport = createSameOriginTransport("hosted", null, fetchMock);
    await transport.createChatCompletion(request);

    const { target: url, init } = fetchCalls[0] ?? {};
    expect(url).toBe("/api/chat");
    expect(new Headers(init?.headers).get("x-cherrychat-mode")).toBe("hosted");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
  });

  it("passes canonical tool definitions and results to Chat Completions", async () => {
    let body: Record<string, unknown> = {};
    const transport = createByokDirectTransport(
      "https://provider.example",
      "secret",
      async (_target, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ choices: [] });
      },
    );

    await transport.createChatCompletion({
      model: "model-a",
      messages: [
        { role: "user", content: "Search" },
        {
          role: "assistant",
          content: null,
          providerContext: [
            {
              type: "provider_context",
              provider: "openai-responses",
              contextType: "reasoning",
              step: 0,
              itemId: "reasoning-item",
              encryptedContent: "encrypted-context",
              reasoningTokens: 10,
            },
            {
              type: "provider_context",
              provider: "gemini",
              contextType: "thought_signature",
              step: 0,
              toolCallId: "call-1",
              thoughtSignature: "gemini-openai-wire-signature",
            },
            {
              type: "provider_context",
              provider: "anthropic",
              contextType: "thinking",
              step: 0,
              blockIndex: 0,
              text: "anthropic private plan",
              signature: "anthropic-openai-wire-signature",
            },
          ],
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "web_search", arguments: '{"query":"x"}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          name: "web_search",
          content: '{"results":[]}',
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search",
            parameters: { type: "object" },
            strict: true,
          },
        },
      ],
      tool_choice: "auto",
      stream: false,
    });

    expect(body).toMatchObject({
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search",
            parameters: { type: "object" },
            strict: true,
          },
        },
      ],
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "tool", tool_call_id: "call-1" }),
      ]),
    });
    expect(body.messages).toContainEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: '{"results":[]}',
    });
    expect(JSON.stringify(body)).not.toContain("providerContext");
    expect(JSON.stringify(body)).not.toContain("encrypted-context");
    expect(JSON.stringify(body)).not.toContain("gemini-openai-wire-signature");
    expect(JSON.stringify(body)).not.toContain(
      "anthropic-openai-wire-signature",
    );
  });

  it.each([
    [{ mode: "default" }, undefined],
    [{ mode: "off" }, "none"],
    [{ mode: "effort", effort: "high" }, "high"],
  ] as const)(
    "serializes normalized reasoning choice %j without leaking the internal field",
    async (reasoning, expectedEffort) => {
      let capturedBody: Record<string, unknown> = {};
      const transport = createByokDirectTransport(
        "https://provider.example",
        "secret",
        async (_target, init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return Response.json({ choices: [] });
        },
      );

      await transport.createChatCompletion({
        ...request,
        reasoning,
      } satisfies NonStreamingChatCompletionsRequest);

      expect(capturedBody).not.toHaveProperty("reasoning");
      if (expectedEffort === undefined) {
        expect(capturedBody).not.toHaveProperty("reasoning_effort");
      } else {
        expect(capturedBody).toHaveProperty("reasoning_effort", expectedEffort);
      }
    },
  );

  it.each([
    ["qwen3.8-max", { mode: "off" }, false, undefined, true],
    ["qwen3.5-plus", { mode: "on" }, true, undefined, true],
    ["kimi-k3", { mode: "effort", effort: "high" }, undefined, "high", false],
  ] as const)(
    "serializes reviewed %s Chat fields without caller injection",
    async (model, reasoning, enableThinking, effort, keepsSampling) => {
      let body: Record<string, unknown> = {};
      const transport = createByokDirectTransport(
        "https://provider.example",
        "secret",
        async (_target, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ choices: [] });
        },
      );

      await transport.createChatCompletion({
        ...request,
        model,
        reasoning,
        temperature: 0.7,
        top_p: 0.8,
        enable_thinking: "caller-value",
        thinking: { type: "caller-value" },
        reasoning_effort: "caller-value",
      } satisfies NonStreamingChatCompletionsRequest);

      expect(body).not.toHaveProperty("reasoning");
      expect(body).not.toHaveProperty("thinking");
      if (enableThinking === undefined) {
        expect(body).not.toHaveProperty("enable_thinking");
      } else {
        expect(body).toHaveProperty("enable_thinking", enableThinking);
      }
      if (effort === undefined) {
        expect(body).not.toHaveProperty("reasoning_effort");
      } else {
        expect(body).toHaveProperty("reasoning_effort", effort);
      }
      if (keepsSampling) {
        expect(body).toMatchObject({ temperature: 0.7, top_p: 0.8 });
      } else {
        expect(body).not.toHaveProperty("temperature");
        expect(body).not.toHaveProperty("top_p");
      }
    },
  );

  it.each([
    ["default", { mode: "default" }, undefined, undefined],
    ["off", { mode: "off" }, { type: "disabled" }, undefined],
    [
      "high",
      { mode: "effort", effort: "high" },
      { type: "enabled", clear_thinking: false },
      "high",
    ],
    [
      "max",
      { mode: "effort", effort: "max" },
      { type: "enabled", clear_thinking: false },
      "max",
    ],
  ] as const)(
    "serializes GLM-5.2 %s with exact native fields and sampling",
    async (_name, reasoning, expectedThinking, expectedEffort) => {
      let body: Record<string, unknown> = {};
      const transport = createByokDirectTransport(
        "https://provider.example",
        "secret",
        async (_target, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ choices: [] });
        },
      );

      await transport.createChatCompletion({
        ...request,
        model: "glm-5.2",
        reasoning,
        temperature: 0.7,
        top_p: 0.8,
        thinking: { type: "legacy-custom-value" },
        reasoning_effort: "legacy-custom-value",
      } satisfies NonStreamingChatCompletionsRequest);

      expect(body).not.toHaveProperty("reasoning");
      expect(body).toMatchObject({ temperature: 0.7, top_p: 0.8 });
      if (expectedThinking) {
        expect(body).toHaveProperty("thinking", expectedThinking);
      } else {
        expect(body).not.toHaveProperty("thinking");
      }
      if (expectedEffort) {
        expect(body).toHaveProperty("reasoning_effort", expectedEffort);
      } else {
        expect(body).not.toHaveProperty("reasoning_effort");
      }
    },
  );

  it.each([
    ["default", { mode: "default" }, undefined],
    ["off", { mode: "off" }, { type: "disabled" }],
    ["on", { mode: "on" }, { type: "enabled", clear_thinking: false }],
  ] as const)(
    "serializes switch-style GLM %s without fabricating an effort",
    async (_name, reasoning, expectedThinking) => {
      let body: Record<string, unknown> = {};
      const transport = createByokDirectTransport(
        "https://provider.example",
        "secret",
        async (_target, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ choices: [] });
        },
      );

      await transport.createChatCompletion({
        ...request,
        model: "glm-4.7",
        reasoning,
        temperature: 0.6,
        top_p: 0.9,
      } satisfies NonStreamingChatCompletionsRequest);

      expect(body).toMatchObject({ temperature: 0.6, top_p: 0.9 });
      expect(body).not.toHaveProperty("reasoning");
      expect(body).not.toHaveProperty("reasoning_effort");
      if (expectedThinking) {
        expect(body).toHaveProperty("thinking", expectedThinking);
      } else {
        expect(body).not.toHaveProperty("thinking");
      }
    },
  );

  it.each([
    ["default", { mode: "default" }, undefined, undefined, false],
    ["off", { mode: "off" }, { type: "disabled" }, undefined, true],
    [
      "low",
      { mode: "effort", effort: "low" },
      { type: "enabled" },
      "low",
      false,
    ],
    [
      "high",
      { mode: "effort", effort: "high" },
      { type: "enabled" },
      "high",
      false,
    ],
    [
      "max",
      { mode: "effort", effort: "max" },
      { type: "enabled" },
      "max",
      false,
    ],
  ] as const)(
    "serializes DeepSeek V4 Flash %s with exact native fields",
    async (_name, reasoning, expectedThinking, expectedEffort, sampling) => {
      let body: Record<string, unknown> = {};
      const transport = createByokDirectTransport(
        "https://provider.example",
        "secret",
        async (_target, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ choices: [] });
        },
      );

      await transport.createChatCompletion({
        ...request,
        model: "deepseek-v4-flash",
        reasoning,
        temperature: 0.7,
        top_p: 0.8,
        thinking: { type: "legacy-custom-value" },
        reasoning_effort: "legacy-custom-value",
      } satisfies NonStreamingChatCompletionsRequest);

      expect(body).not.toHaveProperty("reasoning");
      if (expectedThinking) {
        expect(body).toHaveProperty("thinking", expectedThinking);
      } else {
        expect(body).not.toHaveProperty("thinking");
      }
      if (expectedEffort) {
        expect(body).toHaveProperty("reasoning_effort", expectedEffort);
      } else {
        expect(body).not.toHaveProperty("reasoning_effort");
      }
      if (sampling) {
        expect(body).toMatchObject({ temperature: 0.7, top_p: 0.8 });
      } else {
        expect(body).not.toHaveProperty("temperature");
        expect(body).not.toHaveProperty("top_p");
      }
    },
  );

  it("replays reasoning_content only for the owning retained model family", async () => {
    const capture = async (
      model: string,
      reasoning?: NonStreamingChatCompletionsRequest["reasoning"],
    ) => {
      let body: Record<string, unknown> = {};
      const transport = createByokDirectTransport(
        "https://provider.example",
        "secret",
        async (_target, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ choices: [] });
        },
      );
      await transport.createChatCompletion({
        model,
        stream: false,
        messages: [
          {
            role: "assistant",
            content: null,
            providerContext: [
              {
                type: "provider_context",
                provider: "deepseek-chat",
                contextType: "reasoning_content",
                step: 0,
                text: "Need current sources",
              },
              {
                type: "provider_context",
                provider: "glm-chat",
                contextType: "reasoning_content",
                step: 0,
                text: "GLM current sources",
              },
              {
                type: "provider_context",
                provider: "qwen-chat",
                contextType: "reasoning_content",
                step: 0,
                text: "Qwen current sources",
              },
              {
                type: "provider_context",
                provider: "kimi-chat",
                contextType: "reasoning_content",
                step: 0,
                text: "Kimi current sources",
              },
            ],
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "web_search",
                  arguments: '{"query":"storm"}',
                },
              },
            ],
          },
        ],
        ...(reasoning ? { reasoning } : {}),
      });
      return body;
    };

    const deepSeekBody = await capture("deepseek-v4-flash");
    expect(deepSeekBody.messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        reasoning_content: "Need current sources",
      }),
    );
    expect(JSON.stringify(deepSeekBody)).not.toContain("GLM current sources");

    const glmBody = await capture("glm-5.2", {
      mode: "effort",
      effort: "high",
    });
    expect(glmBody.messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        reasoning_content: "GLM current sources",
      }),
    );
    expect(JSON.stringify(glmBody)).not.toContain("Need current sources");
    expect(JSON.stringify(await capture("glm-5.2"))).not.toContain(
      "GLM current sources",
    );
    const qwenBody = await capture("qwen3.8-max");
    expect(qwenBody.messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        reasoning_content: "Qwen current sources",
      }),
    );
    expect(JSON.stringify(qwenBody)).not.toContain("Kimi current sources");
    expect(
      JSON.stringify(await capture("qwen3.8-max", { mode: "off" })),
    ).not.toContain("Qwen current sources");
    const kimiBody = await capture("kimi-k3");
    expect(kimiBody.messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        reasoning_content: "Kimi current sources",
      }),
    );
    expect(JSON.stringify(kimiBody)).not.toContain("Qwen current sources");
    expect(JSON.stringify(await capture("gpt-5"))).not.toContain(
      "Need current sources",
    );
  });

  it.each(["deepseek-v4-pro", "glm-5.2", "qwen3.8-max", "kimi-k3"])(
    "keeps %s title generation on model default without proprietary controls",
    async (modelId) => {
      let body: Record<string, unknown> = {};
      const transport = createByokDirectTransport(
        "https://provider.example",
        "secret",
        async (_target, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ choices: [] });
        },
      );

      await transport.createChatCompletion(buildTitleRequest(modelId, []));

      expect(body).not.toHaveProperty("thinking");
      expect(body).not.toHaveProperty("enable_thinking");
      expect(body).not.toHaveProperty("reasoning_effort");
      expect(body).not.toHaveProperty("reasoning");
    },
  );

  it("rejects unsupported DeepSeek V4 Pro Low before fetch", async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [] }));
    const transport = createByokDirectTransport(
      "https://provider.example",
      "secret",
      fetchMock,
    );

    await expect(
      transport.createChatCompletion({
        ...request,
        model: "deepseek-v4-pro",
        reasoning: { mode: "effort", effort: "low" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["glm-5.2", { mode: "on" }],
    ["glm-5.2", { mode: "effort", effort: "low" }],
    ["glm-4.7", { mode: "auto" }],
    ["glm-4.7", { mode: "effort", effort: "high" }],
  ] as const)(
    "rejects unsupported GLM choice %j for %s before fetch",
    async (modelId, reasoning) => {
      const fetchMock = vi.fn(async () => Response.json({ choices: [] }));
      const transport = createByokDirectTransport(
        "https://provider.example",
        "secret",
        fetchMock,
      );

      await expect(
        transport.createChatCompletion({
          ...request,
          model: modelId,
          reasoning: reasoning as NonNullable<
            NonStreamingChatCompletionsRequest["reasoning"]
          >,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["qwen3.8-max-preview", { mode: "off" }],
    ["qwen3.5-plus", { mode: "effort", effort: "low" }],
    ["kimi-k3", { mode: "off" }],
    ["kimi-k3", { mode: "effort", effort: "medium" }],
  ] as const)(
    "rejects unsupported Qwen/Kimi choice %j for %s before fetch",
    async (modelId, reasoning) => {
      const fetchMock = vi.fn(async () => Response.json({ choices: [] }));
      const transport = createByokDirectTransport(
        "https://provider.example",
        "secret",
        fetchMock,
      );

      await expect(
        transport.createChatCompletion({
          ...request,
          model: modelId,
          reasoning: reasoning as NonNullable<
            NonStreamingChatCompletionsRequest["reasoning"]
          >,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("distinguishes upstream authentication responses from network failures", async () => {
    const unauthorized = createByokDirectTransport(
      "https://provider.example",
      "secret",
      vi.fn(
        async () => new Response("bad key", { status: 401 }),
      ) as unknown as typeof fetch,
    );
    await expect(unauthorized.listModels()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });

    const networkFailure = createByokDirectTransport(
      "https://provider.example",
      "secret",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    );
    await expect(networkFailure.listModels()).rejects.toMatchObject({
      code: "CORS_OR_NETWORK",
      status: null,
    });
  });

  it("bounds and redacts upstream error bodies", async () => {
    const oversized = createByokDirectTransport(
      "https://provider.example",
      "secret",
      async () =>
        new Response(`sk-${"a".repeat(ERROR_RESPONSE_MAX_BYTES)}`, {
          status: 500,
        }),
    );

    await expect(oversized.listModels()).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      detail: "Upstream error response exceeded the size limit",
    });
  });

  it("rejects oversized or overpopulated model lists as protocol errors", async () => {
    const oversized = createByokDirectTransport(
      "https://provider.example",
      "secret",
      async () =>
        new Response("{}", {
          headers: {
            "Content-Length": String(MODEL_LIST_RESPONSE_MAX_BYTES + 1),
          },
        }),
    );
    await expect(oversized.listModels()).rejects.toMatchObject({
      code: "STREAM_PROTOCOL_ERROR",
    });

    const tooManyModels = createByokDirectTransport(
      "https://provider.example",
      "secret",
      async () =>
        Response.json({
          data: Array.from(
            { length: MAX_MODEL_LIST_ITEMS + 1 },
            (_, index) => ({
              id: `model-${index}`,
            }),
          ),
        }),
    );
    await expect(tooManyModels.listModels()).rejects.toMatchObject({
      code: "STREAM_PROTOCOL_ERROR",
    });
  });

  it("rejects credential-bearing or non-HTTP Base URLs", () => {
    expect(() => normalizeDirectBaseUrl("file:///tmp/model")).toThrow(
      ChatTransportError,
    );
    expect(() =>
      normalizeDirectBaseUrl("https://user:pass@example.com"),
    ).toThrow(ChatTransportError);
  });

  it("maps distinct upstream status classes to stable error codes", () => {
    expect(errorCodeForStatus(403)).toBe("FORBIDDEN");
    expect(errorCodeForStatus(429)).toBe("RATE_LIMITED");
    expect(errorCodeForStatus(504)).toBe("REQUEST_TIMEOUT");
    expect(errorCodeForStatus(500)).toBe("UPSTREAM_ERROR");
    expect(
      toMessageError(
        new ChatTransportError("REQUEST_TIMEOUT", "Timed out", 504),
      ),
    ).toEqual({ code: "REQUEST_TIMEOUT", status: 504, retryable: true });
  });
});
