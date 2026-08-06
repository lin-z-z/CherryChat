import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import type { ReasoningEffortLevel } from "@/runtime/chat/types";
import { isReasoningChoiceSupported } from "@/runtime/models/effective-model-capabilities";
import {
  getModelFamilyProfile,
  normalizeModelFamilyName,
} from "@/runtime/models/model-family-profiles";
import { ChatTransportError } from "@/runtime/transport/chat-errors";

const DEFAULT_MAX_TOKENS = 8_192;
const MIN_BUDGET_TOKENS = 1_024;
const DEFAULT_BUDGET_TOKENS = 13_312;

export type AnthropicThinkingOption =
  | { type: "adaptive" }
  | { type: "enabled"; budgetTokens: number }
  | { type: "disabled" };

export interface AnthropicRequestSettings {
  thinking?: AnthropicThinkingOption;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  wireMaxTokens: number;
  aiSdkMaxOutputTokens: number;
  temperature?: number;
  topP?: number;
}

export function resolveAnthropicRequestSettings(
  request: Pick<
    ChatCompletionsRequest,
    "model" | "reasoning" | "max_tokens" | "temperature" | "top_p"
  >,
): AnthropicRequestSettings {
  const wireMaxTokens = request.max_tokens ?? DEFAULT_MAX_TOKENS;
  if (!Number.isInteger(wireMaxTokens) || wireMaxTokens <= 0) {
    throw invalidChoice(request.model);
  }
  const thinking = resolveThinking(
    request.model,
    request.reasoning,
    wireMaxTokens,
  );
  const thinkingEnabled =
    thinking !== undefined && thinking.option.type !== "disabled";
  const aiSdkMaxOutputTokens =
    thinking?.option.type === "enabled"
      ? wireMaxTokens - thinking.option.budgetTokens
      : wireMaxTokens;

  return {
    ...(thinking ? { thinking: thinking.option } : {}),
    ...(thinking?.effort ? { effort: thinking.effort } : {}),
    wireMaxTokens,
    aiSdkMaxOutputTokens,
    ...(!thinkingEnabled && request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(!thinkingEnabled &&
    request.temperature === undefined &&
    request.top_p !== undefined
      ? { topP: request.top_p }
      : {}),
  };
}

function resolveThinking(
  modelId: string,
  choice: ChatCompletionsRequest["reasoning"],
  maxTokens: number,
):
  | {
      option: AnthropicThinkingOption;
      effort?: AnthropicRequestSettings["effort"];
    }
  | undefined {
  if (!choice || choice.mode === "default") return undefined;
  if (choice.mode === "on") throw invalidChoice(modelId);
  const profile = getModelFamilyProfile(modelId);
  if (
    !profile?.anthropicReasoningFormat ||
    (choice.mode !== "auto" &&
      !isReasoningChoiceSupported(profile.reasoning, choice))
  ) {
    throw invalidChoice(modelId);
  }
  if (choice.mode === "off") return { option: { type: "disabled" } };

  if (profile.anthropicReasoningFormat === "adaptive") {
    if (choice.mode === "auto") return { option: { type: "adaptive" } };
    if (choice.mode !== "effort") throw invalidChoice(modelId);
    return {
      option: { type: "adaptive" },
      effort: adaptiveEffort(modelId, choice.effort),
    };
  }

  const budgetTokens = budgetForChoice(modelId, choice, maxTokens);
  return { option: { type: "enabled", budgetTokens } };
}

function adaptiveEffort(
  modelId: string,
  effort: ReasoningEffortLevel,
): AnthropicRequestSettings["effort"] {
  if (effort === "minimal") return "low";
  if (effort !== "xhigh") return effort;
  return /^claude-opus-4-(?:[7-9]|[1-9]\d)(?:-|$)/u.test(
    normalizeModelFamilyName(modelId),
  )
    ? "xhigh"
    : "max";
}

function budgetForChoice(
  modelId: string,
  choice: Exclude<
    NonNullable<ChatCompletionsRequest["reasoning"]>,
    { mode: "default" | "on" | "off" }
  >,
  maxTokens: number,
): number {
  if (maxTokens <= MIN_BUDGET_TOKENS) throw invalidChoice(modelId);
  const maximum = budgetMaximum(modelId);
  const unbounded =
    choice.mode === "auto"
      ? DEFAULT_BUDGET_TOKENS
      : Math.floor(
          (maximum - MIN_BUDGET_TOKENS) * effortRatio(choice.effort) +
            MIN_BUDGET_TOKENS,
        );
  return Math.min(Math.max(MIN_BUDGET_TOKENS, unbounded), maxTokens - 1);
}

function budgetMaximum(modelId: string): number {
  const name = normalizeModelFamilyName(modelId);
  if (/^claude-(?:opus-4-1|opus-4)(?:-|$)/u.test(name)) return 32_000;
  return 64_000;
}

function effortRatio(effort: ReasoningEffortLevel): number {
  if (effort === "medium") return 0.5;
  if (effort === "high") return 0.8;
  if (effort === "xhigh") return 0.9;
  if (effort === "max") return 1;
  return 0.05;
}

function invalidChoice(modelId: string): ChatTransportError {
  return new ChatTransportError(
    "INVALID_REQUEST",
    `Anthropic reasoning choice is unavailable for ${modelId}`,
    null,
  );
}
