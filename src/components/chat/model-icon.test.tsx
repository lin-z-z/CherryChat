import { describe, expect, it } from "vitest";

import { resolveModelProvider } from "@/components/chat/model-icon";

describe("resolveModelProvider", () => {
  it.each([
    ["openai/gpt-5-mini", "openai"],
    ["claude-sonnet-4-5", "anthropic"],
    ["google/gemini-2.5-pro", "google"],
    ["grok-4.5", "xai"],
    ["deepseek-reasoner", "deepseek"],
    ["zhipuai/glm-5", "zhipu"],
    ["qwen3:8b", "qwen"],
    ["mistral/mistral-small-latest", "mistral"],
  ] as const)("maps %s to %s", (modelId, provider) => {
    expect(resolveModelProvider(modelId)).toBe(provider);
  });

  it("uses the neutral fallback for unknown custom IDs", () => {
    expect(resolveModelProvider("company/private-chat-model")).toBe("custom");
  });
});
