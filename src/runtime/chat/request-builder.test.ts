import { describe, expect, it } from "vitest";

import type { ChatCompletionMessage } from "@/runtime/chat/chat-completions-contract";
import { buildChatCompletionsRequest } from "@/runtime/chat/request-builder";
import type {
  MessageNode,
  ModelPreferences,
  ResolvedModelCapability,
} from "@/runtime/chat/types";
import { createDefaultModelPreferences } from "@/runtime/chat/types";

const estimator = {
  estimate: (messages: readonly ChatCompletionMessage[]) => ({
    tokens: messages.length * 10,
    estimated: false,
    method: "o200k_base" as const,
  }),
};

const normalCapability: ResolvedModelCapability = {
  modelId: "gpt-4o",
  reasoning: false,
  supportedEfforts: [],
  vision: true,
  tools: true,
  contextWindow: 4096,
  temperature: "supported",
  topP: "supported",
  source: "builtin",
};

function message(
  id: string,
  role: MessageNode["role"],
  text: string,
  parts: MessageNode["parts"] = [{ type: "text", text }],
): MessageNode {
  return {
    id,
    conversationId: "conversation-1",
    parentId: null,
    role,
    parts,
    status: "completed",
    modelSnapshot: null,
    usage: null,
    error: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

function input(
  overrides: Partial<Parameters<typeof buildChatCompletionsRequest>[0]> = {},
) {
  return {
    modelId: "gpt-4o",
    capability: normalCapability,
    preferences: createDefaultModelPreferences(),
    reasoning: { mode: "default" as const },
    systemPrompt: "",
    historyPath: [
      message("u1", "user", "old"),
      message("a1", "assistant", "answer"),
    ],
    currentUserMessage: message("u2", "user", "current"),
    contextCutoffId: null,
    loadAttachment: async () => null,
    estimator,
    ...overrides,
  };
}

describe("Chat Completions request builder", () => {
  it("uses model defaults and emits a streaming contract without usage options", async () => {
    const result = await buildChatCompletionsRequest(input());

    expect(result.request).toMatchObject({
      model: "gpt-4o",
      stream: true,
    });
    expect(result.request).not.toHaveProperty("stream_options");
    expect(result.request).not.toHaveProperty("temperature");
    expect(result.request).not.toHaveProperty("top_p");
    expect(result.request).not.toHaveProperty("max_tokens");
  });

  it("sends enabled per-model generation parameters and supports non-streaming responses", async () => {
    const preferences: ModelPreferences = {
      streaming: false,
      temperature: { enabled: true, value: 0.7 },
      topP: { enabled: false, value: 0.9 },
    };
    const result = await buildChatCompletionsRequest(input({ preferences }));

    expect(result.request).toMatchObject({
      stream: false,
      temperature: 0.7,
    });
    expect(result.request).not.toHaveProperty("top_p");
  });

  it("does not send an enabled preference when the model is explicitly unsupported", async () => {
    const result = await buildChatCompletionsRequest(
      input({
        capability: {
          ...normalCapability,
          temperature: "unsupported",
          topP: "unsupported",
        },
        preferences: {
          streaming: true,
          temperature: { enabled: true, value: 0.8 },
          topP: { enabled: true, value: 0.9 },
        },
      }),
    );

    expect(result.request).not.toHaveProperty("temperature");
    expect(result.request).not.toHaveProperty("top_p");
  });

  it("uses the Assistant snapshot prompt and replays text without reasoning parts", async () => {
    const assistantWithReasoning = message("a1", "assistant", "final", [
      {
        type: "reasoning",
        text: "secret",
        source: "reasoning_content",
        durationMs: 1,
      },
      { type: "text", text: "final" },
    ]);
    const result = await buildChatCompletionsRequest(
      input({
        systemPrompt: "  Review carefully.  ",
        historyPath: [message("u1", "user", "old"), assistantWithReasoning],
      }),
    );

    expect(result.request.messages).toEqual([
      { role: "system", content: "Review carefully." },
      { role: "user", content: "old" },
      { role: "assistant", content: "final" },
      { role: "user", content: "current" },
    ]);
  });

  it("replays persisted tool steps before the assistant answer", async () => {
    const assistantWithSearch = message("a1", "assistant", "final", [
      { type: "text", text: "I will check." },
      {
        type: "tool_call",
        id: "call-1",
        name: "web_search",
        step: 0,
        input: { query: "current" },
        output: {
          query: "current",
          results: [{ title: "Source", url: "https://example.com" }],
        },
        status: "completed",
        errorCode: null,
        errorStatus: null,
        retryable: false,
      },
      { type: "text", text: "final" },
    ]);
    const result = await buildChatCompletionsRequest(
      input({
        historyPath: [message("u1", "user", "old"), assistantWithSearch],
      }),
    );

    expect(result.request.messages).toEqual([
      { role: "user", content: "old" },
      {
        role: "assistant",
        content: "I will check.",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "web_search",
              arguments: '{"query":"current"}',
            },
          },
        ],
      },
      {
        role: "tool",
        content:
          '{"results":[{"id":1,"title":"Source","url":"https://example.com","content":""}]}',
        tool_call_id: "call-1",
        name: "web_search",
      },
      { role: "assistant", content: "final" },
      { role: "user", content: "current" },
    ]);
  });

  it("attaches hidden Responses context only to its selected assistant step", async () => {
    const assistantWithContext = message("a1", "assistant", "final", [
      {
        type: "provider_context",
        provider: "openai-responses",
        contextType: "reasoning",
        step: 0,
        itemId: "reasoning-tool",
        encryptedContent: "encrypted-tool",
        reasoningTokens: 20,
      },
      { type: "text", text: "I will check." },
      {
        type: "tool_call",
        id: "call-1",
        name: "web_search",
        step: 0,
        input: { query: "current" },
        output: { query: "current", results: [] },
        status: "completed",
        errorCode: null,
        errorStatus: null,
        retryable: false,
      },
      {
        type: "provider_context",
        provider: "openai-responses",
        contextType: "reasoning",
        step: 1,
        itemId: "reasoning-answer",
        encryptedContent: "encrypted-answer",
        reasoningTokens: null,
      },
      { type: "text", text: "final" },
    ]);

    const result = await buildChatCompletionsRequest(
      input({
        historyPath: [message("u1", "user", "old"), assistantWithContext],
      }),
    );

    expect(result.request.messages[1]).toMatchObject({
      role: "assistant",
      providerContext: [
        expect.objectContaining({ itemId: "reasoning-tool", step: 0 }),
      ],
    });
    expect(result.request.messages[3]).toMatchObject({
      role: "assistant",
      content: "final",
      providerContext: [
        expect.objectContaining({ itemId: "reasoning-answer", step: 1 }),
      ],
    });
  });

  it("binds a Gemini thought signature to its selected tool step", async () => {
    const assistantWithContext = message("a1", "assistant", "final", [
      {
        type: "provider_context",
        provider: "gemini",
        contextType: "thought_signature",
        step: 0,
        toolCallId: "call-1",
        thoughtSignature: "gemini-request-signature",
      },
      {
        type: "tool_call",
        id: "call-1",
        name: "web_search",
        step: 0,
        input: { query: "current" },
        output: { query: "current", results: [] },
        status: "completed",
        errorCode: null,
        errorStatus: null,
        retryable: false,
      },
      { type: "text", text: "final" },
    ]);

    const result = await buildChatCompletionsRequest(
      input({
        historyPath: [message("u1", "user", "old"), assistantWithContext],
      }),
    );

    expect(result.request.messages[1]).toMatchObject({
      role: "assistant",
      tool_calls: [expect.objectContaining({ id: "call-1" })],
      providerContext: [
        expect.objectContaining({
          provider: "gemini",
          toolCallId: "call-1",
          thoughtSignature: "gemini-request-signature",
        }),
      ],
    });
    expect(JSON.stringify(result.request.messages[3])).not.toContain(
      "gemini-request-signature",
    );
  });

  it.each(["deepseek-chat", "glm-chat", "qwen-chat", "kimi-chat"] as const)(
    "binds persisted %s reasoning content to each Assistant tool step",
    async (provider) => {
      const assistantWithContext = message("a1", "assistant", "final", [
        {
          type: "provider_context",
          provider,
          contextType: "reasoning_content",
          step: 0,
          text: "Search plan",
        },
        { type: "text", text: "I will check." },
        {
          type: "tool_call",
          id: "call-1",
          name: "web_search",
          step: 0,
          input: { query: "current" },
          output: { query: "current", results: [] },
          status: "completed",
          errorCode: null,
          errorStatus: null,
          retryable: false,
        },
        {
          type: "provider_context",
          provider,
          contextType: "reasoning_content",
          step: 1,
          text: "Answer plan",
        },
        { type: "text", text: "final" },
      ]);

      const result = await buildChatCompletionsRequest(
        input({
          historyPath: [message("u1", "user", "old"), assistantWithContext],
        }),
      );

      expect(result.request.messages[1]).toMatchObject({
        role: "assistant",
        providerContext: [
          expect.objectContaining({
            provider,
            step: 0,
            text: "Search plan",
          }),
        ],
      });
      expect(result.request.messages[3]).toMatchObject({
        role: "assistant",
        providerContext: [
          expect.objectContaining({
            provider,
            step: 1,
            text: "Answer plan",
          }),
        ],
      });
    },
  );

  it("binds Anthropic thinking blocks to their selected tool step", async () => {
    const assistantWithContext = message("a1", "assistant", "final", [
      {
        type: "provider_context",
        provider: "anthropic",
        contextType: "thinking",
        step: 0,
        blockIndex: 0,
        text: "search plan",
        signature: "anthropic-request-signature",
      },
      {
        type: "tool_call",
        id: "call-1",
        name: "web_search",
        step: 0,
        input: { query: "current" },
        output: { query: "current", results: [] },
        status: "completed",
        errorCode: null,
        errorStatus: null,
        retryable: false,
      },
      { type: "text", text: "final" },
    ]);

    const result = await buildChatCompletionsRequest(
      input({
        historyPath: [message("u1", "user", "old"), assistantWithContext],
      }),
    );

    expect(result.request.messages[1]).toMatchObject({
      role: "assistant",
      tool_calls: [expect.objectContaining({ id: "call-1" })],
      providerContext: [
        expect.objectContaining({
          provider: "anthropic",
          text: "search plan",
          signature: "anthropic-request-signature",
        }),
      ],
    });
    expect(JSON.stringify(result.request.messages[3])).not.toContain(
      "anthropic-request-signature",
    );
  });

  it("rejects an invalid reasoning effort instead of silently downgrading", async () => {
    const capability = {
      ...normalCapability,
      modelId: "custom-reasoner",
      reasoning: true,
      supportedEfforts: ["low"],
    } satisfies ResolvedModelCapability;
    await expect(
      buildChatCompletionsRequest(
        input({
          modelId: "custom-reasoner",
          capability,
          reasoning: { mode: "effort", effort: "high" },
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REASONING_CHOICE" });
  });

  it("sends a reasoning effort only when the active model supports it", async () => {
    const capability = {
      ...normalCapability,
      modelId: "gpt-5-mini",
      reasoning: true,
      supportedEfforts: ["low", "medium", "high"],
      temperature: "unsupported",
      topP: "unsupported",
    } satisfies ResolvedModelCapability;
    const result = await buildChatCompletionsRequest(
      input({
        modelId: "gpt-5-mini",
        capability,
        reasoning: { mode: "effort", effort: "high" },
      }),
    );

    expect(result.request).toHaveProperty("reasoning", {
      mode: "effort",
      effort: "high",
    });
  });

  it("does not send an effort for a fixed reasoning model", async () => {
    const capability = {
      ...normalCapability,
      modelId: "deepseek-reasoner",
      reasoning: true,
      supportedEfforts: [],
      temperature: "unsupported",
      topP: "unsupported",
    } satisfies ResolvedModelCapability;
    const result = await buildChatCompletionsRequest(
      input({
        modelId: "deepseek-reasoner",
        capability,
        reasoning: { mode: "default" },
      }),
    );

    expect(result.request).toHaveProperty("reasoning", { mode: "default" });
    expect(result.request).not.toHaveProperty("stream_options");
  });

  it("hydrates only selected image references into data URLs", async () => {
    const imageMessage = message("u1", "user", "with image", [
      { type: "text", text: "with image" },
      { type: "image_ref", attachmentId: "image-1", alt: null },
    ]);
    const result = await buildChatCompletionsRequest(
      input({
        historyPath: [],
        currentUserMessage: imageMessage,
        loadAttachment: async (attachmentId) => ({
          id: attachmentId,
          blob: new Blob(["hello"], { type: "image/png" }),
          mimeType: "image/png",
          width: 1,
          height: 1,
          byteSize: 5,
          sha256: "hash",
          createdAt: "2026-07-16T00:00:00.000Z",
        }),
      }),
    );

    expect(result.request.messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "with image" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,aGVsbG8=" },
        },
      ],
    });
  });
});
