import { describe, expect, it } from "vitest";

import type { ChatCompletionMessage } from "@/runtime/chat/chat-completions-contract";
import { DefaultTokenEstimator } from "@/runtime/chat/token-estimator";

describe("DefaultTokenEstimator", () => {
  const estimator = new DefaultTokenEstimator();

  it("uses a known tokenizer for OpenAI model families", () => {
    const result = estimator.estimate(
      [{ role: "user", content: "Hello CherryChat" }],
      "gpt-4o-mini",
    );

    expect(result.method).toBe("o200k_base");
    expect(result.estimated).toBe(false);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("uses a conservative UTF-8 estimate for unknown compatible models", () => {
    const result = estimator.estimate(
      [{ role: "user", content: "你好，CherryChat" }],
      "vendor-custom-model",
    );

    expect(result.method).toBe("utf8-conservative");
    expect(result.estimated).toBe(true);
  });

  it("charges a fixed conservative budget for image parts", () => {
    const message: ChatCompletionMessage = {
      role: "user",
      content: [
        { type: "text", text: "Describe this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
      ],
    };
    const result = estimator.estimate([message], "gpt-4o");

    expect(result.estimated).toBe(true);
    expect(result.tokens).toBeGreaterThan(1024);
  });

  it("uses recorded reasoning tokens for encrypted Responses context", () => {
    const withoutContext = estimator.estimate(
      [{ role: "assistant", content: "Answer" }],
      "gpt-5",
    );
    const withContext = estimator.estimate(
      [
        {
          role: "assistant",
          content: "Answer",
          providerContext: [
            {
              type: "provider_context",
              provider: "openai-responses",
              contextType: "reasoning",
              step: 0,
              itemId: "reasoning-1",
              encryptedContent: "encrypted",
              reasoningTokens: 37,
            },
          ],
        },
      ],
      "gpt-5",
    );

    expect(withContext.tokens - withoutContext.tokens).toBe(37);
    expect(withContext.estimated).toBe(false);
  });

  it("falls back to a conservative encrypted-content estimate", () => {
    const result = estimator.estimate(
      [
        {
          role: "assistant",
          content: null,
          providerContext: [
            {
              type: "provider_context",
              provider: "openai-responses",
              contextType: "reasoning",
              step: 0,
              itemId: "reasoning-1",
              encryptedContent: "encrypted-context",
              reasoningTokens: null,
            },
          ],
        },
      ],
      "gpt-5",
    );

    expect(result.tokens).toBeGreaterThanOrEqual("encrypted-context".length);
    expect(result.estimated).toBe(true);
  });

  it("counts Gemini thought signatures by their UTF-8 byte length", () => {
    const signature = "Gemini-签名";
    const withoutContext = estimator.estimate(
      [{ role: "assistant", content: "Answer" }],
      "gemini-3.1-pro",
    );
    const withContext = estimator.estimate(
      [
        {
          role: "assistant",
          content: "Answer",
          providerContext: [
            {
              type: "provider_context",
              provider: "gemini",
              contextType: "thought_signature",
              step: 0,
              toolCallId: "call-1",
              thoughtSignature: signature,
            },
          ],
        },
      ],
      "gemini-3.1-pro",
    );

    expect(withContext.tokens - withoutContext.tokens).toBe(
      new TextEncoder().encode(signature).byteLength,
    );
    expect(withContext.estimated).toBe(true);
  });

  it.each([
    ["deepseek-chat", "deepseek-v4-flash", "DeepSeek 工具计划"],
    ["glm-chat", "glm-5.2", "GLM 工具计划"],
    ["qwen-chat", "qwen3.8-max", "Qwen 私有计划"],
    ["kimi-chat", "kimi-k3", "Kimi 私有计划"],
  ] as const)("counts %s reasoning replay text", (provider, modelId, text) => {
    const withoutContext = estimator.estimate(
      [{ role: "assistant", content: "Answer" }],
      modelId,
    );
    const withContext = estimator.estimate(
      [
        {
          role: "assistant",
          content: "Answer",
          providerContext: [
            {
              type: "provider_context",
              provider,
              contextType: "reasoning_content",
              step: 0,
              text,
            },
          ],
        },
      ],
      modelId,
    );

    expect(withContext.tokens - withoutContext.tokens).toBe(
      new TextEncoder().encode(text).byteLength,
    );
    expect(withContext.estimated).toBe(true);
  });

  it("counts Anthropic signed thinking replay by UTF-8 byte length", () => {
    const text = "私密计划";
    const signature = "anthropic-signature";
    const withoutContext = estimator.estimate(
      [{ role: "assistant", content: "Answer" }],
      "claude-sonnet-4-6",
    );
    const withContext = estimator.estimate(
      [
        {
          role: "assistant",
          content: "Answer",
          providerContext: [
            {
              type: "provider_context",
              provider: "anthropic",
              contextType: "thinking",
              step: 0,
              blockIndex: 0,
              text,
              signature,
            },
          ],
        },
      ],
      "claude-sonnet-4-6",
    );

    expect(withContext.tokens - withoutContext.tokens).toBe(
      new TextEncoder().encode(`${text}${signature}`).byteLength,
    );
    expect(withContext.estimated).toBe(true);
  });
});
