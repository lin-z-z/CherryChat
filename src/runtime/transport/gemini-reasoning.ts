import type { ReasoningChoice } from "@/runtime/chat/types";
import { isReasoningChoiceSupported } from "@/runtime/models/effective-model-capabilities";
import { getModelFamilyProfile } from "@/runtime/models/model-family-profiles";
import { ChatTransportError } from "@/runtime/transport/chat-errors";

export type GeminiThinkingConfig = {
  includeThoughts: boolean;
  thinkingBudget?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
};

const GEMINI_REASONING_LEVELS = new Set(["minimal", "low", "medium", "high"]);

export function resolveGeminiThinkingConfig(
  modelId: string,
  choice: ReasoningChoice | undefined,
): GeminiThinkingConfig | undefined {
  if (!choice || choice.mode === "default") return undefined;
  const profile = getModelFamilyProfile(modelId);
  if (!profile?.geminiReasoningFormat) {
    throw invalidChoice(modelId);
  }
  if (!isReasoningChoiceSupported(profile.reasoning, choice)) {
    throw invalidChoice(modelId);
  }

  if (profile.geminiReasoningFormat === "level") {
    if (choice.mode === "auto") return { includeThoughts: true };
    if (
      choice.mode === "effort" &&
      GEMINI_REASONING_LEVELS.has(choice.effort)
    ) {
      const thinkingLevel =
        choice.effort === "minimal"
          ? profile.id.includes("pro")
            ? "low"
            : "minimal"
          : choice.effort === "medium"
            ? "medium"
            : choice.effort === "high"
              ? "high"
              : "low";
      return {
        includeThoughts: true,
        thinkingLevel,
      };
    }
    throw invalidChoice(modelId);
  }

  if (choice.mode === "auto") {
    return { includeThoughts: true, thinkingBudget: -1 };
  }
  if (choice.mode === "off") {
    return { includeThoughts: false, thinkingBudget: 0 };
  }
  if (choice.mode !== "effort") throw invalidChoice(modelId);
  return {
    includeThoughts: true,
    thinkingBudget: geminiBudgetForEffort(modelId, choice.effort),
  };
}

function geminiBudgetForEffort(modelId: string, effort: string): number {
  const name = modelId.toLowerCase();
  const limits = name.includes("flash-lite")
    ? { min: 512, max: 24_576 }
    : name.includes("flash")
      ? { min: 0, max: 24_576 }
      : { min: 128, max: 32_768 };
  const ratio =
    effort === "medium"
      ? 0.5
      : effort === "high" || effort === "max" || effort === "xhigh"
        ? 0.8
        : 0.05;
  return Math.floor((limits.max - limits.min) * ratio + limits.min);
}

function invalidChoice(modelId: string): ChatTransportError {
  return new ChatTransportError(
    "INVALID_REQUEST",
    `Gemini reasoning choice is unavailable for ${modelId}`,
    null,
  );
}
