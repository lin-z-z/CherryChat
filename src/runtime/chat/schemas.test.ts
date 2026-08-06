import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_THINKING_CONTEXT_LIMITS,
  anthropicThinkingContextPartSchema,
  DEEPSEEK_REASONING_CONTEXT_LIMITS,
  deepSeekReasoningContextPartSchema,
  glmReasoningContextPartSchema,
  kimiReasoningContextPartSchema,
  qwenReasoningContextPartSchema,
  GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS,
  geminiThoughtSignatureContextPartSchema,
  JSON_VALUE_LIMITS,
  jsonValueSchema,
  messageNodeSchema,
  OPENAI_RESPONSES_CONTEXT_LIMITS,
  openAIResponsesContextPartSchema,
} from "@/runtime/chat/schemas";

const timestamp = "2026-07-27T00:00:00.000Z";

describe("bounded JSON value schema", () => {
  it("accepts ordinary JSON and rejects non-finite or non-JSON values", () => {
    expect(
      jsonValueSchema.safeParse({ query: "CherryChat", values: [1, true] })
        .success,
    ).toBe(true);
    expect(jsonValueSchema.safeParse(Number.NaN).success).toBe(false);
    expect(jsonValueSchema.safeParse(new Date()).success).toBe(false);
  });

  it("rejects excessive depth, node count, and cyclic structures iteratively", () => {
    let nested: unknown = "leaf";
    for (let depth = 0; depth <= JSON_VALUE_LIMITS.maximumDepth; depth += 1) {
      nested = [nested];
    }
    expect(jsonValueSchema.safeParse(nested).success).toBe(false);
    expect(
      jsonValueSchema.safeParse(
        Array.from({ length: JSON_VALUE_LIMITS.maximumNodes }, () => null),
      ).success,
    ).toBe(false);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(jsonValueSchema.safeParse(cyclic).success).toBe(false);
  });
});

function providerContext(index = 0, encryptedContent = "encrypted") {
  return {
    type: "provider_context" as const,
    provider: "openai-responses" as const,
    contextType: "reasoning" as const,
    step: 0,
    itemId: `reasoning-${index}`,
    encryptedContent,
    reasoningTokens: 42,
  };
}

function message(parts: unknown[]) {
  return {
    id: "assistant-1",
    conversationId: "conversation-1",
    parentId: "user-1",
    role: "assistant",
    parts,
    status: "completed",
    modelSnapshot: null,
    usage: null,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function geminiContext(
  toolCallId = "call-1",
  thoughtSignature = "thought-signature",
) {
  return {
    type: "provider_context" as const,
    provider: "gemini" as const,
    contextType: "thought_signature" as const,
    step: 0,
    toolCallId,
    thoughtSignature,
  };
}

function anthropicContext(blockIndex = 0, value = "anthropic-signature") {
  return {
    type: "provider_context" as const,
    provider: "anthropic" as const,
    contextType: "thinking" as const,
    step: 0,
    blockIndex,
    text: "private plan",
    signature: value,
  };
}

function deepSeekContext(step = 0, text = "deepseek private plan") {
  return {
    type: "provider_context" as const,
    provider: "deepseek-chat" as const,
    contextType: "reasoning_content" as const,
    step,
    text,
  };
}

function glmContext(step = 0, text = "glm private plan") {
  return {
    type: "provider_context" as const,
    provider: "glm-chat" as const,
    contextType: "reasoning_content" as const,
    step,
    text,
  };
}

function qwenContext(step = 0, text = "qwen private plan") {
  return {
    type: "provider_context" as const,
    provider: "qwen-chat" as const,
    contextType: "reasoning_content" as const,
    step,
    text,
  };
}

function kimiContext(step = 0, text = "kimi private plan") {
  return {
    type: "provider_context" as const,
    provider: "kimi-chat" as const,
    contextType: "reasoning_content" as const,
    step,
    text,
  };
}

function toolCall() {
  return {
    type: "tool_call" as const,
    id: "call-1",
    name: "web_search",
    step: 0,
    input: { query: "storm" },
    output: [],
    status: "completed" as const,
    errorCode: null,
    errorStatus: null,
    retryable: false,
  };
}

describe("OpenAI Responses provider context schema", () => {
  it("accepts the closed persisted contract", () => {
    expect(openAIResponsesContextPartSchema.parse(providerContext())).toEqual(
      providerContext(),
    );
  });

  it("rejects malformed, oversized, and unknown provider metadata", () => {
    expect(
      openAIResponsesContextPartSchema.safeParse({
        ...providerContext(),
        provider: "another-provider",
      }).success,
    ).toBe(false);
    expect(
      openAIResponsesContextPartSchema.safeParse({
        ...providerContext(),
        encryptedContent: "x".repeat(
          OPENAI_RESPONSES_CONTEXT_LIMITS.maxEncryptedContentBytes + 1,
        ),
      }).success,
    ).toBe(false);
    expect(
      openAIResponsesContextPartSchema.safeParse({
        ...providerContext(),
        unexpected: "must-not-survive",
      }).success,
    ).toBe(false);
  });

  it("bounds provider context count and total encrypted content per message", () => {
    const tooMany = Array.from(
      { length: OPENAI_RESPONSES_CONTEXT_LIMITS.maxItemsPerMessage + 1 },
      (_, index) => providerContext(index),
    );
    expect(messageNodeSchema.safeParse(message(tooMany)).success).toBe(false);

    const oversizedTotal = Array.from({ length: 3 }, (_, index) =>
      providerContext(index, "x".repeat(400_000)),
    );
    expect(messageNodeSchema.safeParse(message(oversizedTotal)).success).toBe(
      false,
    );
  });

  it("rejects duplicate item IDs and provider context on user messages", () => {
    expect(
      messageNodeSchema.safeParse(
        message([providerContext(1), providerContext(1)]),
      ).success,
    ).toBe(false);
    expect(
      messageNodeSchema.safeParse({
        ...message([providerContext()]),
        role: "user",
      }).success,
    ).toBe(false);
  });
});

describe("Gemini thought signature context schema", () => {
  it("accepts the closed persisted contract", () => {
    expect(
      geminiThoughtSignatureContextPartSchema.parse(geminiContext()),
    ).toEqual(geminiContext());
  });

  it("rejects malformed, repeated, and oversized signatures", () => {
    expect(
      geminiThoughtSignatureContextPartSchema.safeParse({
        ...geminiContext(),
        thoughtSignature: "x".repeat(
          GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS.maxThoughtSignatureBytes + 1,
        ),
      }).success,
    ).toBe(false);
    expect(
      messageNodeSchema.safeParse(message([geminiContext(), geminiContext()]))
        .success,
    ).toBe(false);
  });

  it("bounds aggregate signatures and rejects them on user messages", () => {
    const tooMany = Array.from(
      {
        length: GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS.maxItemsPerMessage + 1,
      },
      (_, index) => geminiContext(`call-${index}`),
    );
    expect(messageNodeSchema.safeParse(message(tooMany)).success).toBe(false);

    const oversized = Array.from({ length: 3 }, (_, index) =>
      geminiContext(`call-${index}`, "x".repeat(400_000)),
    );
    expect(messageNodeSchema.safeParse(message(oversized)).success).toBe(false);
    expect(
      geminiThoughtSignatureContextPartSchema.safeParse(
        geminiContext(
          "multibyte-call",
          "签".repeat(
            Math.floor(
              GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS.maxThoughtSignatureBytes /
                3,
            ) + 1,
          ),
        ),
      ).success,
    ).toBe(false);
    expect(
      messageNodeSchema.safeParse({
        ...message([geminiContext()]),
        role: "user",
      }).success,
    ).toBe(false);
  });
});

describe("DeepSeek reasoning context schema", () => {
  it("accepts the closed persisted contract", () => {
    expect(deepSeekReasoningContextPartSchema.parse(deepSeekContext())).toEqual(
      deepSeekContext(),
    );
    expect(
      messageNodeSchema.safeParse(message([deepSeekContext(), toolCall()]))
        .success,
    ).toBe(true);
  });

  it("rejects duplicate steps and UTF-8 oversized text", () => {
    expect(
      messageNodeSchema.safeParse(
        message([deepSeekContext(), deepSeekContext(), toolCall()]),
      ).success,
    ).toBe(false);
    expect(
      deepSeekReasoningContextPartSchema.safeParse(
        deepSeekContext(
          0,
          "签".repeat(
            Math.floor(DEEPSEEK_REASONING_CONTEXT_LIMITS.maxTextBytes / 3) + 1,
          ),
        ),
      ).success,
    ).toBe(false);
  });

  it("bounds aggregate text and rejects it on user messages", () => {
    const oversized = Array.from({ length: 5 }, (_, index) =>
      deepSeekContext(index, "x".repeat(900_000)),
    );
    expect(
      messageNodeSchema.safeParse(message([...oversized, toolCall()])).success,
    ).toBe(false);
    expect(
      messageNodeSchema.safeParse({
        ...message([deepSeekContext()]),
        role: "user",
      }).success,
    ).toBe(false);
    expect(
      messageNodeSchema.safeParse(message([deepSeekContext()])).success,
    ).toBe(false);
  });
});

describe("GLM reasoning context schema", () => {
  it("accepts the closed persisted contract with tool-call history", () => {
    expect(glmReasoningContextPartSchema.parse(glmContext())).toEqual(
      glmContext(),
    );
    expect(
      messageNodeSchema.safeParse(message([glmContext(), toolCall()])).success,
    ).toBe(true);
  });

  it("rejects duplicate steps, oversized text, and missing tool history", () => {
    expect(
      messageNodeSchema.safeParse(
        message([glmContext(), glmContext(), toolCall()]),
      ).success,
    ).toBe(false);
    expect(
      glmReasoningContextPartSchema.safeParse(
        glmContext(
          0,
          "签".repeat(
            Math.floor(DEEPSEEK_REASONING_CONTEXT_LIMITS.maxTextBytes / 3) + 1,
          ),
        ),
      ).success,
    ).toBe(false);
    expect(messageNodeSchema.safeParse(message([glmContext()])).success).toBe(
      false,
    );
    expect(
      messageNodeSchema.safeParse({
        ...message([glmContext(), toolCall()]),
        role: "user",
      }).success,
    ).toBe(false);
  });
});

describe("Qwen and Kimi reasoning context schemas", () => {
  it("accepts bounded no-tool reasoning context for each owner", () => {
    expect(qwenReasoningContextPartSchema.parse(qwenContext())).toEqual(
      qwenContext(),
    );
    expect(kimiReasoningContextPartSchema.parse(kimiContext())).toEqual(
      kimiContext(),
    );
    expect(
      messageNodeSchema.safeParse(message([qwenContext(), kimiContext()]))
        .success,
    ).toBe(true);
  });

  it.each([
    ["Qwen", qwenContext],
    ["Kimi", kimiContext],
  ] as const)(
    "rejects duplicate and oversized %s context",
    (_label, context) => {
      expect(
        messageNodeSchema.safeParse(message([context(), context()])).success,
      ).toBe(false);
      expect(
        messageNodeSchema.safeParse(
          message(
            Array.from({ length: 5 }, (_, index) =>
              context(index, "x".repeat(900_000)),
            ),
          ),
        ).success,
      ).toBe(false);
    },
  );
});

describe("Anthropic thinking context schema", () => {
  it("accepts signed and redacted thinking blocks", () => {
    expect(
      anthropicThinkingContextPartSchema.parse(anthropicContext()),
    ).toEqual(anthropicContext());
    expect(
      anthropicThinkingContextPartSchema.parse({
        type: "provider_context",
        provider: "anthropic",
        contextType: "redacted_thinking",
        step: 1,
        blockIndex: 2,
        redactedData: "encrypted-thinking",
      }),
    ).toMatchObject({ contextType: "redacted_thinking" });
  });

  it("rejects duplicate positions and UTF-8 oversized fields", () => {
    expect(
      messageNodeSchema.safeParse(
        message([anthropicContext(), anthropicContext()]),
      ).success,
    ).toBe(false);
    expect(
      anthropicThinkingContextPartSchema.safeParse(
        anthropicContext(
          0,
          "签".repeat(
            Math.floor(ANTHROPIC_THINKING_CONTEXT_LIMITS.maxFieldBytes / 3) + 1,
          ),
        ),
      ).success,
    ).toBe(false);
  });

  it("bounds aggregate context and rejects it on user messages", () => {
    const oversized = Array.from({ length: 5 }, (_, index) =>
      anthropicContext(index, "x".repeat(500_000)),
    );
    expect(messageNodeSchema.safeParse(message(oversized)).success).toBe(false);
    expect(
      messageNodeSchema.safeParse({
        ...message([anthropicContext()]),
        role: "user",
      }).success,
    ).toBe(false);
  });
});
