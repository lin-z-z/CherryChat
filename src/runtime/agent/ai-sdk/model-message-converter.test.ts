import { describe, expect, it } from "vitest";

import {
  toAnthropicModelMessages,
  toAiSdkModelMessages,
  toGoogleModelMessages,
  toOpenAICompatibleModelMessages,
  toOpenAIResponsesModelMessages,
} from "@/runtime/agent/ai-sdk/model-message-converter";

describe("toAiSdkModelMessages", () => {
  it("projects image, assistant tool calls, and tool results explicitly", () => {
    const messages = toAiSdkModelMessages([
      { role: "system", content: "Be concise" },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AA==" },
          },
        ],
      },
      {
        role: "assistant",
        content: "I will search",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "web_search",
              arguments: '{"query":"latest docs"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-1",
        name: "web_search",
        content: '[{"title":"Docs"}]',
      },
    ]);

    expect(messages[1]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "Inspect this" },
        { type: "image", image: "AA==", mediaType: "image/png" },
      ],
    });
    expect(messages[2]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "I will search" },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "web_search",
          input: { query: "latest docs" },
        },
      ],
    });
    expect(messages[3]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "web_search",
          output: { type: "json", value: [{ title: "Docs" }] },
        },
      ],
    });
  });

  it("rejects malformed historical tool input before calling a provider", () => {
    expect(() =>
      toAiSdkModelMessages([
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "web_search", arguments: "{" },
            },
          ],
        },
      ]),
    ).toThrow(/valid JSON/u);
  });

  it("replays encrypted reasoning only for the Responses converter", () => {
    const assistant = {
      role: "assistant" as const,
      content: "Answer",
      providerContext: [
        {
          type: "provider_context" as const,
          provider: "openai-responses" as const,
          contextType: "reasoning" as const,
          step: 0,
          itemId: "reasoning-1",
          encryptedContent: "encrypted-context",
          reasoningTokens: 20,
        },
      ],
    };

    expect(toAiSdkModelMessages([assistant])).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "Answer" }],
      },
    ]);
    expect(toOpenAIResponsesModelMessages([assistant])).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "",
            providerOptions: {
              openai: {
                itemId: "reasoning-1",
                reasoningEncryptedContent: "encrypted-context",
              },
            },
          },
          { type: "text", text: "Answer" },
        ],
      },
    ]);
  });

  it("replays Gemini thought signatures only on the owning tool call", () => {
    const assistant = {
      role: "assistant" as const,
      content: "Checking",
      tool_calls: [
        {
          id: "call-1",
          type: "function" as const,
          function: {
            name: "web_search",
            arguments: '{"query":"storm"}',
          },
        },
      ],
      providerContext: [
        {
          type: "provider_context" as const,
          provider: "gemini" as const,
          contextType: "thought_signature" as const,
          step: 0,
          toolCallId: "call-1",
          thoughtSignature: "signature-1",
        },
      ],
    };

    expect(toAiSdkModelMessages([assistant])).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "web_search",
            input: { query: "storm" },
          },
        ],
      },
    ]);
    expect(toGoogleModelMessages([assistant])).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "web_search",
            input: { query: "storm" },
            providerOptions: {
              google: { thoughtSignature: "signature-1" },
            },
          },
        ],
      },
    ]);
    expect(
      JSON.stringify(toOpenAIResponsesModelMessages([assistant])),
    ).not.toContain("signature-1");
  });

  it("replays DeepSeek reasoning content only for a V4 compatible model", () => {
    const assistant = {
      role: "assistant" as const,
      content: "Checking",
      providerContext: [
        {
          type: "provider_context" as const,
          provider: "deepseek-chat" as const,
          contextType: "reasoning_content" as const,
          step: 0,
          text: "Need current sources",
        },
      ],
      tool_calls: [
        {
          id: "call-1",
          type: "function" as const,
          function: {
            name: "web_search",
            arguments: '{"query":"storm"}',
          },
        },
      ],
    };

    expect(
      toOpenAICompatibleModelMessages([assistant], "deepseek-v4-flash"),
    ).toEqual([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Need current sources" },
          { type: "text", text: "Checking" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "web_search",
            input: { query: "storm" },
          },
        ],
      },
    ]);
    expect(
      JSON.stringify(toOpenAICompatibleModelMessages([assistant], "gpt-5")),
    ).not.toContain("Need current sources");
  });

  it("replays GLM reasoning content only for explicit retained thinking", () => {
    const assistant = {
      role: "assistant" as const,
      content: "Checking",
      providerContext: [
        {
          type: "provider_context" as const,
          provider: "deepseek-chat" as const,
          contextType: "reasoning_content" as const,
          step: 0,
          text: "DeepSeek-only plan",
        },
        {
          type: "provider_context" as const,
          provider: "glm-chat" as const,
          contextType: "reasoning_content" as const,
          step: 0,
          text: "GLM-only plan",
        },
      ],
      tool_calls: [
        {
          id: "call-1",
          type: "function" as const,
          function: {
            name: "web_search",
            arguments: '{"query":"storm"}',
          },
        },
      ],
    };

    const retained = toOpenAICompatibleModelMessages([assistant], "glm-5.2", {
      mode: "effort",
      effort: "high",
    });
    expect(JSON.stringify(retained)).toContain("GLM-only plan");
    expect(JSON.stringify(retained)).not.toContain("DeepSeek-only plan");

    for (const reasoning of [
      { mode: "default" as const },
      { mode: "off" as const },
    ]) {
      const messages = toOpenAICompatibleModelMessages(
        [assistant],
        "glm-5.2",
        reasoning,
      );
      expect(JSON.stringify(messages)).not.toContain("GLM-only plan");
      expect(JSON.stringify(messages)).not.toContain("DeepSeek-only plan");
    }

    const deepSeek = toOpenAICompatibleModelMessages(
      [assistant],
      "deepseek-v4-flash",
    );
    expect(JSON.stringify(deepSeek)).toContain("DeepSeek-only plan");
    expect(JSON.stringify(deepSeek)).not.toContain("GLM-only plan");
  });

  it("keeps Qwen and Kimi reasoning replay strictly model-owned", () => {
    const assistant = {
      role: "assistant" as const,
      content: "Answer",
      providerContext: [
        {
          type: "provider_context" as const,
          provider: "qwen-chat" as const,
          contextType: "reasoning_content" as const,
          step: 0,
          text: "Qwen-only plan",
        },
        {
          type: "provider_context" as const,
          provider: "kimi-chat" as const,
          contextType: "reasoning_content" as const,
          step: 0,
          text: "Kimi-only plan",
        },
      ],
    };

    const qwen = JSON.stringify(
      toOpenAICompatibleModelMessages([assistant], "qwen3.8-max"),
    );
    expect(qwen).toContain("Qwen-only plan");
    expect(qwen).not.toContain("Kimi-only plan");

    const qwenOff = JSON.stringify(
      toOpenAICompatibleModelMessages([assistant], "qwen3.8-max", {
        mode: "off",
      }),
    );
    expect(qwenOff).not.toContain("Qwen-only plan");

    const kimi = JSON.stringify(
      toOpenAICompatibleModelMessages([assistant], "kimi-k3"),
    );
    expect(kimi).toContain("Kimi-only plan");
    expect(kimi).not.toContain("Qwen-only plan");
  });

  it("replays Anthropic signed and redacted thinking only on its converter", () => {
    const assistant = {
      role: "assistant" as const,
      content: "Answer",
      providerContext: [
        {
          type: "provider_context" as const,
          provider: "anthropic" as const,
          contextType: "thinking" as const,
          step: 0,
          blockIndex: 0,
          text: "Private plan",
          signature: "anthropic-signature",
        },
        {
          type: "provider_context" as const,
          provider: "anthropic" as const,
          contextType: "redacted_thinking" as const,
          step: 0,
          blockIndex: 1,
          redactedData: "encrypted-redacted-data",
        },
      ],
    };

    expect(toAnthropicModelMessages([assistant])).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Private plan",
            providerOptions: {
              anthropic: { signature: "anthropic-signature" },
            },
          },
          {
            type: "reasoning",
            text: "",
            providerOptions: {
              anthropic: { redactedData: "encrypted-redacted-data" },
            },
          },
          { type: "text", text: "Answer" },
        ],
      },
    ]);
    expect(JSON.stringify(toAiSdkModelMessages([assistant]))).not.toContain(
      "anthropic-signature",
    );
    expect(JSON.stringify(toGoogleModelMessages([assistant]))).not.toContain(
      "encrypted-redacted-data",
    );
  });
});
