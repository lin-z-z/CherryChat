import type {
  ModelFamilyProfile,
  ModelReasoningControl,
  ReasoningChoice,
  ReasoningEffortLevel,
  ResolvedModelCapability,
} from "@/runtime/chat/types";
import { REASONING_EFFORT_LEVELS } from "@/runtime/chat/types";
import { normalizeModelLookupName } from "@/runtime/models/model-id-normalization";

const DEFAULT_CHOICE = { mode: "default" } as const satisfies ReasoningChoice;

function effortControl(
  efforts: readonly ReasoningEffortLevel[],
  modes: readonly ("on" | "auto" | "off")[] = [],
): ModelReasoningControl {
  return {
    kind: "effort",
    options: [
      DEFAULT_CHOICE,
      ...modes.map((mode): ReasoningChoice => ({ mode })),
      ...efforts.map((effort): ReasoningChoice => ({ mode: "effort", effort })),
    ],
  };
}

export const MODEL_FAMILY_PROFILES: readonly ModelFamilyProfile[] = [
  // OpenAI GPT/o-series. Specific variants must precede broad GPT-5 rules.
  {
    id: "gpt-5.1-codex-max",
    matches: (name) => name.includes("gpt-5-1-codex-max"),
    reasoning: effortControl(["medium", "high", "xhigh"]),
    reasoningOverride: "always",
  },
  {
    id: "gpt-5.1-codex",
    matches: (name) => name.includes("gpt-5-1-codex"),
    reasoning: effortControl(["medium", "high"]),
    reasoningOverride: "always",
  },
  {
    id: "gpt-5.2-codex",
    matches: (name) => name.includes("gpt-5-2-codex"),
    reasoning: effortControl(["low", "medium", "high", "xhigh"]),
    reasoningOverride: "always",
  },
  {
    id: "gpt-5-codex",
    matches: (name) => /^gpt-5-codex(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high"]),
    reasoningOverride: "when-empty",
  },
  {
    id: "gpt-5.2-pro",
    matches: (name) => name.includes("gpt-5-2-pro"),
    reasoning: effortControl(["medium", "high", "xhigh"]),
    reasoningOverride: "always",
  },
  {
    id: "gpt-5-pro",
    matches: (name) => /^gpt-5-pro(?:-|$)/u.test(name),
    reasoning: effortControl(["high"]),
    reasoningOverride: "when-empty",
  },
  {
    id: "gpt-5.1",
    matches: (name) => /^gpt-5-1(?!-chat)(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high"], ["off"]),
    reasoningOverride: "always",
  },
  {
    id: "gpt-5.2-plus",
    matches: (name) => /^gpt-5-(?:[2-9]|[1-9]\d)(?!.*-chat)(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high", "xhigh"], ["off"]),
    reasoningOverride: "when-empty",
  },
  {
    id: "gpt-5",
    matches: (name) => /^gpt-5(?!-\d)(?!.*-chat)(?:-|$)/u.test(name),
    reasoning: effortControl(["minimal", "low", "medium", "high"]),
    reasoningOverride: "when-empty",
  },
  {
    id: "gpt-oss",
    matches: (name) => /^gpt-oss(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high"]),
    reasoningOverride: "when-empty",
  },
  {
    id: "openai-o-series",
    matches: (name) => /^(?:o1|o3|o4)(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high"]),
    reasoningOverride: "when-empty",
  },

  // Anthropic Claude extended/adaptive thinking.
  {
    id: "claude-4.6-plus",
    matches: (name) =>
      /^claude-(?:opus|sonnet)-4-(?:6|[7-9]|[1-9]\d)(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high", "xhigh"], ["off"]),
    reasoningOverride: "always",
    anthropicReasoningFormat: "adaptive",
  },
  {
    id: "claude-reasoning",
    matches: (name) =>
      /^claude-(?:3-7.*sonnet|(?:sonnet|opus|haiku)-4)(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high"], ["off"]),
    reasoningOverride: "when-empty",
    anthropicReasoningFormat: "budget",
  },

  // Gemini image variants reason internally but do not expose the Gemini 3 level knob.
  {
    id: "gemini-3-image",
    matches: (name) => /^gemini-3(?:-1)?-.*image(?:-|$)/u.test(name),
    reasoning: { kind: "fixed" },
    reasoningOverride: "always",
    geminiReasoningFormat: "level",
  },
  {
    id: "gemini-3.1-pro",
    matches: (name) =>
      name === "gemini-pro-latest" || /^gemini-3-1-pro(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high"]),
    reasoningOverride: "always",
    geminiReasoningFormat: "level",
  },
  {
    id: "gemini-3-pro",
    matches: (name) => /^gemini-3-pro(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "high"]),
    reasoningOverride: "always",
    geminiReasoningFormat: "level",
  },
  {
    id: "gemini-3-flash",
    matches: (name) =>
      /^(?:gemini-(?:3-flash|3-1-flash-lite)|gemini-(?:flash|flash-lite)-latest)(?:-|$)/u.test(
        name,
      ),
    reasoning: effortControl(["minimal", "low", "medium", "high"]),
    reasoningOverride: "always",
    geminiReasoningFormat: "level",
  },
  {
    id: "gemini-2.5-flash",
    matches: (name) => /^gemini-2-5-flash(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high"], ["off", "auto"]),
    reasoningOverride: "always",
    geminiReasoningFormat: "budget",
  },
  {
    id: "gemini-2.5-pro",
    matches: (name) => /^gemini-2-5-pro(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high"], ["auto"]),
    reasoningOverride: "always",
    geminiReasoningFormat: "budget",
  },

  // xAI Grok.
  {
    id: "grok-4-fast",
    matches: (name) => /^grok-4-fast(?!.*non-reasoning)(?:-|$)/u.test(name),
    reasoning: effortControl([], ["off", "auto"]),
    reasoningOverride: "when-empty",
  },
  {
    id: "grok-4.3",
    matches: (name) => /^grok-4-3(?!.*non-reasoning)(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "medium", "high"], ["off"]),
    reasoningOverride: "always",
  },
  {
    id: "grok-3-mini",
    matches: (name) => /^grok-3-mini(?:-|$)/u.test(name),
    reasoning: effortControl(["low", "high"]),
    reasoningOverride: "when-empty",
  },

  // Qwen Chat controls are limited to reviewed text variants.
  {
    id: "qwen-always-thinking",
    matches: (name) => /^qwen.*thinking(?:-|$)/u.test(name),
    reasoning: { kind: "fixed" },
    reasoningOverride: "always",
    nativeReasoningOnly: true,
  },
  {
    id: "qwen-non-reasoning",
    matches: (name) =>
      /^qwen/u.test(name) && isExcludedQwenChatReasoningName(name),
    reasoning: { kind: "none" },
    reasoningOverride: "always",
  },
  {
    id: "qwen-fixed",
    matches: (name) => /^qwq(?:-|$)/u.test(name),
    reasoning: { kind: "fixed" },
    reasoningOverride: "always",
    nativeReasoningOnly: true,
  },
  {
    id: "qwen3.8-max-preview",
    matches: (name) =>
      qwenChatReasoningVariantFromName(name) === "qwen3.8-max-preview",
    reasoning: effortControl(["low", "medium", "xhigh"]),
    reasoningOverride: "always",
  },
  {
    id: "qwen3.8-max",
    matches: (name) => qwenChatReasoningVariantFromName(name) === "qwen3.8-max",
    reasoning: effortControl(["low", "medium", "xhigh"], ["off"]),
    reasoningOverride: "always",
  },
  {
    id: "qwen-hybrid-default-on",
    matches: (name) =>
      qwenChatReasoningVariantFromName(name) === "hybrid-default-on",
    reasoning: { kind: "switch", options: ["off", "on"] },
    reasoningOverride: "always",
  },
  {
    id: "qwen-hybrid-default-off",
    matches: (name) =>
      qwenChatReasoningVariantFromName(name) === "hybrid-default-off",
    reasoning: { kind: "switch", options: ["off", "on"] },
    reasoningOverride: "always",
  },

  // Kimi K3 has a reviewed Chat-only effort contract and fixed sampling.
  {
    id: "kimi-k3-unreviewed-variant",
    matches: (name) => /^kimi-k3(?:-|:).+/u.test(name),
    reasoning: { kind: "none" },
    reasoningOverride: "always",
  },
  {
    id: "kimi-k3",
    matches: (name) => name === "kimi-k3",
    reasoning: effortControl(["low", "high", "max"]),
    reasoningOverride: "always",
    temperature: "unsupported",
    topP: "unsupported",
  },

  // DeepSeek V4 Chat Completions thinking controls.
  {
    id: "deepseek-v4-flash",
    matches: (name) => deepSeekV4VariantFromName(name) === "flash",
    reasoning: effortControl(["low", "high", "max"], ["off"]),
    reasoningOverride: "always",
  },
  {
    id: "deepseek-v4-pro",
    matches: (name) => deepSeekV4VariantFromName(name) === "pro",
    reasoning: effortControl(["high", "max"], ["off"]),
    reasoningOverride: "always",
  },
  {
    id: "deepseek-hybrid",
    matches: (name) =>
      /^deepseek-(?:chat|v3-(?:1|2))(?!.*speciale)(?:-|$)/u.test(name),
    reasoning: effortControl([], ["off", "auto"]),
    reasoningOverride: "always",
    nativeReasoningOnly: true,
  },
  {
    id: "deepseek-fixed",
    matches: (name) => /^deepseek-(?:reasoner|r1)(?:-|$)/u.test(name),
    reasoning: { kind: "fixed" },
    reasoningOverride: "when-empty",
  },

  // Zhipu GLM Chat controls are limited to explicitly reviewed text families.
  {
    id: "glm-5.2",
    matches: (name) => glmReasoningVariantFromName(name) === "glm-5.2",
    reasoning: effortControl(["high", "max"], ["off"]),
    reasoningOverride: "always",
  },
  {
    id: "glm-switch",
    matches: (name) => glmReasoningVariantFromName(name) === "switch",
    reasoning: effortControl([], ["off", "on"]),
    reasoningOverride: "always",
  },
] as const;

export function getModelFamilyProfile(
  modelId: string,
): ModelFamilyProfile | null {
  const modelNames = [
    normalizeModelFamilyName(modelId),
    normalizeModelLookupName(modelId),
  ];
  return (
    MODEL_FAMILY_PROFILES.find(({ matches }) =>
      modelNames.some((modelName) => matches(modelName)),
    ) ?? null
  );
}

export type DeepSeekV4Variant = "flash" | "pro";
export type GlmReasoningVariant = "glm-5.2" | "switch";
export type QwenChatReasoningVariant =
  | "qwen3.8-max"
  | "qwen3.8-max-preview"
  | "hybrid-default-on"
  | "hybrid-default-off";

export function getQwenChatReasoningVariant(
  modelId: string,
): QwenChatReasoningVariant | null {
  const familyName = normalizeModelFamilyName(modelId);
  if (isExcludedQwenChatReasoningName(familyName)) return null;

  const modelNames = [familyName, normalizeModelLookupName(modelId)];
  for (const modelName of modelNames) {
    const variant = qwenChatReasoningVariantFromName(modelName);
    if (variant) return variant;
  }
  return null;
}

export function isKimiK3Model(modelId: string): boolean {
  return normalizeModelFamilyName(modelId) === "kimi-k3";
}

export function getDeepSeekV4Variant(
  modelId: string,
): DeepSeekV4Variant | null {
  const modelNames = [
    normalizeModelFamilyName(modelId),
    normalizeModelLookupName(modelId),
  ];
  for (const modelName of modelNames) {
    const variant = deepSeekV4VariantFromName(modelName);
    if (variant) return variant;
  }
  return null;
}

export function getGlmReasoningVariant(
  modelId: string,
): GlmReasoningVariant | null {
  const modelNames = [
    normalizeModelFamilyName(modelId),
    normalizeModelLookupName(modelId),
  ];
  for (const modelName of modelNames) {
    const variant = glmReasoningVariantFromName(modelName);
    if (variant) return variant;
  }
  return null;
}

export function applyReviewedModelFamilyProfile(
  capability: ResolvedModelCapability,
): ResolvedModelCapability {
  const profile = getModelFamilyProfile(capability.modelId);
  if (!profile) return capability;

  const shouldApplyReasoning =
    profile.reasoningOverride === "always" ||
    (profile.reasoningOverride === "when-empty" &&
      capability.reasoning &&
      capability.supportedEfforts.length === 0);

  const reasoning = shouldApplyReasoning
    ? profile.reasoning.kind !== "none"
    : capability.reasoning;
  return {
    ...capability,
    reasoning,
    supportedEfforts: shouldApplyReasoning
      ? reasoning
        ? reasoningControlToLegacyEfforts(profile.reasoning)
        : []
      : capability.supportedEfforts,
    ...(profile.vision === undefined
      ? {}
      : { vision: profile.vision !== "unsupported" }),
    ...(profile.contextWindow === undefined
      ? {}
      : { contextWindow: profile.contextWindow }),
    ...(profile.temperature === undefined
      ? {}
      : { temperature: profile.temperature }),
    ...(profile.topP === undefined ? {} : { topP: profile.topP }),
  };
}

/**
 * Family matching preserves behavior-bearing suffixes such as `thinking` and
 * `instruct`; catalogue lookup normalization intentionally strips some of them
 * and therefore cannot be reused here.
 */
export function normalizeModelFamilyName(modelId: string): string {
  const segments = modelId.normalize("NFKC").trim().toLowerCase().split("/");
  let name = (segments.at(-1) ?? "")
    .replace(/^(?:[a-z]+\.)+/u, "")
    .replace(/(?:[-_]v?\d+)?:\d+$/u, "")
    .replace(/(\d)[,._p](?=\d)/gu, "$1-")
    .replaceAll("_", "-");

  for (;;) {
    const next = name
      .replace(/@.*$/u, "")
      .replace(/-20\d{2}(?:-?\d{2}){1,2}$/u, "")
      .replace(/-(?:fp8|fp16|bf16|awq|int4|int8|gguf|gptq)$/u, "");
    if (next === name) return name;
    name = next;
  }
}

export function reasoningControlFromCapability(
  capability: ResolvedModelCapability,
): ModelReasoningControl {
  if (!capability.reasoning) return { kind: "none" };

  const options: ReasoningChoice[] = [DEFAULT_CHOICE];
  for (const value of new Set(capability.supportedEfforts)) {
    if (value === "none") options.push({ mode: "off" });
    else if (value === "on") options.push({ mode: "on" });
    else if (value === "auto") options.push({ mode: "auto" });
    else if (isReasoningEffortLevel(value)) {
      options.push({ mode: "effort", effort: value });
    }
  }

  if (options.length === 1) return { kind: "fixed" };
  const modes = options
    .filter(
      (
        choice,
      ): choice is Extract<ReasoningChoice, { mode: "on" | "auto" | "off" }> =>
        choice.mode === "on" || choice.mode === "auto" || choice.mode === "off",
    )
    .map(({ mode }) => mode);
  if (options.every(({ mode }) => mode !== "effort")) {
    return { kind: "switch", options: modes };
  }
  return { kind: "effort", options };
}

function reasoningControlToLegacyEfforts(
  control: ModelReasoningControl,
): string[] {
  if (control.kind === "none" || control.kind === "fixed") return [];
  if (control.kind === "switch") {
    return control.options.map((mode) => (mode === "off" ? "none" : mode));
  }
  return control.options.flatMap((choice) => {
    if (choice.mode === "default") return [];
    if (choice.mode === "off") return ["none"];
    if (choice.mode === "on") return ["on"];
    if (choice.mode === "auto") return ["auto"];
    return [choice.effort];
  });
}

function isReasoningEffortLevel(value: string): value is ReasoningEffortLevel {
  return (REASONING_EFFORT_LEVELS as readonly string[]).includes(value);
}

function deepSeekV4VariantFromName(
  normalizedModelName: string,
): DeepSeekV4Variant | null {
  const match = /^deepseek-v4-(flash|pro)(?:-|$)/u.exec(normalizedModelName);
  return (match?.[1] as DeepSeekV4Variant | undefined) ?? null;
}

function glmReasoningVariantFromName(
  normalizedModelName: string,
): GlmReasoningVariant | null {
  if (normalizedModelName === "glm-5-2") return "glm-5.2";

  const switchFamily =
    /^(?:glm-5(?:-1)?|glm-4-(?:5|6|7))(?:$|-(?:air|airx|flash|flashx|turbo)$)/u;
  return switchFamily.test(normalizedModelName) ? "switch" : null;
}

function isExcludedQwenChatReasoningName(modelName: string): boolean {
  return (
    /^qwq(?:-|$)/u.test(modelName) ||
    /(?:^|-)(?:asr|audio|coder|embedding|instruct|omni|reranker|thinking|tts|vision|vl)(?:-|$)/u.test(
      modelName,
    )
  );
}

function qwenChatReasoningVariantFromName(
  normalizedModelName: string,
): QwenChatReasoningVariant | null {
  if (normalizedModelName === "qwen3-8-max-preview") {
    return "qwen3.8-max-preview";
  }
  if (normalizedModelName === "qwen3-8-max") return "qwen3.8-max";

  const qwen3OpenSource = /^qwen3-\d+(?:-\d+)?b(?:-a\d+(?:-\d+)?b)?$/u.test(
    normalizedModelName,
  );
  const qwen35 = /^qwen3-5-(?:plus|9b|27b|35b-a3b|122b-a10b|397b-a17b)$/u.test(
    normalizedModelName,
  );
  const qwen36 = /^qwen3-6-(?:plus|flash|max-preview|27b|35b-a3b)$/u.test(
    normalizedModelName,
  );
  const qwen37 = /^qwen3-7-(?:max|plus)$/u.test(normalizedModelName);
  if (qwen3OpenSource || qwen35 || qwen36 || qwen37) {
    return "hybrid-default-on";
  }

  if (
    /^(?:qwen3-max|qwen-(?:plus|turbo|flash)|qwen-max-latest)$/u.test(
      normalizedModelName,
    )
  ) {
    return "hybrid-default-off";
  }
  return null;
}
