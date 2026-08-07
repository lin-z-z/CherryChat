import { describe, expect, it } from "vitest";

import { getEndpointProfile } from "@/runtime/models/endpoint-profiles";
import { resolveEffectiveModelCapability } from "@/runtime/models/effective-model-capabilities";
import {
  getGlmReasoningVariant,
  getQwenChatReasoningVariant,
  getModelFamilyProfile,
  isKimiK3Model,
} from "@/runtime/models/model-family-profiles";
import { resolveModelCapability } from "@/runtime/models/model-capabilities";

describe("reviewed model-family profile projection", () => {
  it.each([
    {
      family: "GPT",
      modelId: "openai/gpt-5.4-pro",
      profileId: "gpt-5.2-plus",
      efforts: ["medium", "high", "xhigh"],
      vision: true,
      contextWindow: 1_050_000,
      temperature: "unsupported",
    },
    {
      family: "Claude",
      modelId: "anthropic/claude-opus-4-7",
      profileId: "claude-4.6-plus",
      efforts: ["none", "low", "medium", "high", "xhigh"],
      vision: true,
      contextWindow: 1_000_000,
      temperature: "unsupported",
    },
    {
      family: "Gemini",
      modelId: "google/gemini-3.1-pro-preview-customtools",
      profileId: "gemini-3.1-pro",
      efforts: ["low", "medium", "high"],
      vision: true,
      contextWindow: 1_048_576,
      temperature: "supported",
    },
    {
      family: "Grok",
      modelId: "xai/grok-4.3",
      profileId: "grok-4.3",
      efforts: ["none", "low", "medium", "high"],
      vision: true,
      contextWindow: 1_000_000,
      temperature: "supported",
    },
    {
      family: "Qwen",
      modelId: "alibaba/qwen3.5-plus",
      profileId: "qwen-hybrid-default-on",
      efforts: ["none", "on"],
      vision: true,
      contextWindow: 1_000_000,
      temperature: "supported",
    },
    {
      family: "Kimi K3",
      modelId: "moonshotai/kimi-k3",
      profileId: "kimi-k3",
      efforts: ["low", "high", "max"],
      vision: true,
      contextWindow: 1_048_576,
      temperature: "unsupported",
    },
    {
      family: "DeepSeek Flash",
      modelId: "deepseek/deepseek-v4-flash",
      profileId: "deepseek-v4-flash",
      efforts: ["none", "low", "high", "max"],
      vision: false,
      contextWindow: 1_000_000,
      temperature: "supported",
    },
    {
      family: "DeepSeek Pro",
      modelId: "deepseek/deepseek-v4-pro",
      profileId: "deepseek-v4-pro",
      efforts: ["none", "high", "max"],
      vision: false,
      contextWindow: 1_000_000,
      temperature: "supported",
    },
    {
      family: "GLM 5.2",
      modelId: "zhipuai/glm-5.2",
      profileId: "glm-5.2",
      efforts: ["none", "high", "max"],
      vision: false,
      contextWindow: 1_000_000,
      temperature: "supported",
    },
  ] as const)(
    "keeps $family reasoning, vision, context and parameter data aligned",
    ({ modelId, profileId, efforts, vision, contextWindow, temperature }) => {
      const resolved = resolveModelCapability(modelId);

      expect(getModelFamilyProfile(modelId)?.id).toBe(profileId);
      expect(resolved).toMatchObject({
        reasoning: true,
        supportedEfforts: efforts,
        vision,
        contextWindow,
        temperature,
      });
    },
  );

  it.each([
    ["us.anthropic.claude-opus-4-7-v1:0", "claude-4.6-plus"],
    ["gemini_3.1_pro_preview_customtools", "gemini-3.1-pro"],
    ["qwen3_5-plus-2026-07-01-fp8", "qwen-hybrid-default-on"],
    ["moonshotai/kimi-k3-2026-08-01-fp8", "kimi-k3"],
    ["accounts/fireworks/models/deepseek-v4_flash-fp8", "deepseek-v4-flash"],
    ["deepseek-ai/deepseek-v4-pro-2026-08-01", "deepseek-v4-pro"],
    ["zai-org-glm-5.2-thinking", "glm-5.2"],
    ["zhipuai/glm-4.7-flash-2026-07-01-fp8", "glm-switch"],
    ["gemini-pro-latest", "gemini-3.1-pro"],
    ["gemini-flash-latest", "gemini-3-flash"],
    ["gemini-flash-lite-latest", "gemini-3-flash"],
  ] as const)("resolves variant %s", (modelId, profileId) => {
    expect(getModelFamilyProfile(modelId)?.id).toBe(profileId);
  });

  it.each([
    ["qwen3.8-max", "qwen3.8-max"],
    ["alibaba/qwen3_8-max-2026-08-01-fp8", "qwen3.8-max"],
    ["qwen3.8-max-preview", "qwen3.8-max-preview"],
    ["qwen3.5-plus", "hybrid-default-on"],
    ["qwen3-235b-a22b", "hybrid-default-on"],
    ["qwen3-max", "hybrid-default-off"],
    ["qwen-plus", "hybrid-default-off"],
  ] as const)("classifies reviewed Qwen Chat model %s", (modelId, variant) => {
    expect(getQwenChatReasoningVariant(modelId)).toBe(variant);
  });

  it.each([
    "qwen3-coder-plus",
    "qwen3-32b-instruct",
    "qwen3-vl-plus",
    "qwen3-32b-thinking",
    "qwen3-next-80b-a3b-thinking",
    "qwq-plus",
    "qwen3.8-max-unknown",
    "qwen3.9-max",
  ])("does not classify excluded or future Qwen model %s", (modelId) => {
    expect(getQwenChatReasoningVariant(modelId)).toBeNull();
  });

  it.each([
    ["qwen3-32b-thinking", "qwen-always-thinking"],
    ["qwen-plus-thinking", "qwen-always-thinking"],
    ["qwq-plus", "qwen-fixed"],
  ] as const)(
    "keeps always-thinking Qwen model %s fixed",
    (modelId, profileId) => {
      expect(getModelFamilyProfile(modelId)).toMatchObject({
        id: profileId,
        reasoning: { kind: "fixed" },
      });
      expect(
        resolveEffectiveModelCapability({
          modelCapability: resolveModelCapability(modelId),
          endpointProfile: getEndpointProfile("openai-compatible"),
        }).reasoningControl,
      ).toEqual({ kind: "fixed" });
    },
  );

  it.each(["kimi-k3", "moonshotai/kimi-k3", "kimi-k3-2026-08-01-fp8"])(
    "classifies reviewed Kimi K3 model %s",
    (modelId) => {
      expect(isKimiK3Model(modelId)).toBe(true);
    },
  );

  it.each(["kimi-k2.5", "kimi-k3-preview", "kimi-k3-thinking", "kimi-k3.1"])(
    "does not classify unreviewed Kimi model %s",
    (modelId) => {
      expect(isKimiK3Model(modelId)).toBe(false);
    },
  );

  it.each([
    ["glm-5.2", "glm-5.2"],
    ["zai-org-glm-5.2-thinking", "glm-5.2"],
    ["glm-5.1", "switch"],
    ["glm-5-turbo", "switch"],
    ["glm-4.5-air", "switch"],
    ["glm-4.6-flashx-2026-07-01-int8", "switch"],
    ["glm-4.7-thinking", "switch"],
  ] as const)("classifies reviewed GLM Chat model %s", (modelId, variant) => {
    expect(getGlmReasoningVariant(modelId)).toBe(variant);
  });

  it.each([
    "glm-4.6v",
    "glm-4.7-vision",
    "glm-5-vision",
    "glm-5.3",
    "glm-6",
    "glm-4.4",
    "glm-4.7-unknown",
  ])("does not classify unreviewed or multimodal GLM model %s", (modelId) => {
    expect(getGlmReasoningVariant(modelId)).toBeNull();
  });

  it.each(["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"])(
    "keeps %s adjustable on OpenAI Chat compatible endpoints",
    (modelId) => {
      const effective = resolveEffectiveModelCapability({
        modelCapability: resolveModelCapability(modelId),
        endpointProfile: getEndpointProfile("openai-compatible"),
      });

      expect(effective.reasoningControl.kind).toBe("effort");
      expect(effective.reasoningWireFormat).toBe("openai-chat");
    },
  );
});
