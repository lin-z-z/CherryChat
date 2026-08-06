import { describe, expect, it } from "vitest";

import { resolveAnthropicRequestSettings } from "@/runtime/transport/anthropic-reasoning";

describe("Anthropic reasoning settings", () => {
  it("keeps default settings omitted and makes temperature win over Top P", () => {
    expect(
      resolveAnthropicRequestSettings({
        model: "claude-sonnet-4-6",
        reasoning: { mode: "default" },
        temperature: 0.4,
        top_p: 0.8,
      }),
    ).toEqual({
      wireMaxTokens: 8_192,
      aiSdkMaxOutputTokens: 8_192,
      temperature: 0.4,
    });
  });

  it("uses adaptive effort without incompatible sampling settings", () => {
    expect(
      resolveAnthropicRequestSettings({
        model: "claude-opus-4-6",
        reasoning: { mode: "effort", effort: "xhigh" },
        max_tokens: 16_384,
        temperature: 0.2,
        top_p: 0.95,
      }),
    ).toEqual({
      thinking: { type: "adaptive" },
      effort: "max",
      wireMaxTokens: 16_384,
      aiSdkMaxOutputTokens: 16_384,
    });
    expect(
      resolveAnthropicRequestSettings({
        model: "claude-opus-4-7",
        reasoning: { mode: "effort", effort: "xhigh" },
      }).effort,
    ).toBe("xhigh");
  });

  it("maps early Claude effort to a bounded thinking budget", () => {
    expect(
      resolveAnthropicRequestSettings({
        model: "claude-sonnet-4-5",
        reasoning: { mode: "effort", effort: "low" },
      }),
    ).toEqual({
      thinking: { type: "enabled", budgetTokens: 4_172 },
      wireMaxTokens: 8_192,
      aiSdkMaxOutputTokens: 4_020,
    });
    expect(
      resolveAnthropicRequestSettings({
        model: "claude-sonnet-4",
        reasoning: { mode: "auto" },
      }).thinking,
    ).toEqual({ type: "enabled", budgetTokens: 8_191 });
  });

  it("keeps disabled distinct and rejects unknown reasoning models", () => {
    expect(
      resolveAnthropicRequestSettings({
        model: "claude-sonnet-4-6",
        reasoning: { mode: "off" },
        top_p: 0.9,
      }),
    ).toEqual({
      thinking: { type: "disabled" },
      wireMaxTokens: 8_192,
      aiSdkMaxOutputTokens: 8_192,
      topP: 0.9,
    });
    expect(() =>
      resolveAnthropicRequestSettings({
        model: "custom-claude",
        reasoning: { mode: "auto" },
      }),
    ).toThrow(/unavailable/u);
  });
});
