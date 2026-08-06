import type { ChatCompletionsRequest } from "@/runtime/chat/chat-completions-contract";
import type {
  OpenAIChatReasoningContextBehavior,
  OpenAIChatReasoningContextProvider,
  ReasoningChoice,
} from "@/runtime/chat/types";
import {
  getDeepSeekV4Variant,
  getGlmReasoningVariant,
  type GlmReasoningVariant,
  getQwenChatReasoningVariant,
  type QwenChatReasoningVariant,
  isKimiK3Model,
} from "@/runtime/models/model-family-profiles";
import { ChatTransportError } from "@/runtime/transport/chat-errors";

export interface OpenAIChatReasoningWire {
  thinking?: {
    type: "enabled" | "disabled";
    clear_thinking?: false;
  };
  enableThinking?: boolean;
  reasoningEffort?: string;
  suppressSampling: boolean;
}

export function encodeOpenAIChatReasoning(
  modelId: string,
  choice: ReasoningChoice | undefined,
): OpenAIChatReasoningWire {
  const deepSeekVariant = getDeepSeekV4Variant(modelId);
  if (deepSeekVariant) {
    return encodeDeepSeekReasoning(modelId, deepSeekVariant, choice);
  }
  const glmVariant = getGlmReasoningVariant(modelId);
  if (glmVariant) return encodeGlmReasoning(modelId, glmVariant, choice);
  const qwenVariant = getQwenChatReasoningVariant(modelId);
  if (qwenVariant) return encodeQwenReasoning(modelId, qwenVariant, choice);
  if (isKimiK3Model(modelId)) return encodeKimiReasoning(modelId, choice);

  const reasoningEffort = reasoningChoiceToEffort(choice);
  return {
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    suppressSampling: false,
  };
}

export function getOpenAIChatReasoningContextProvider(
  modelId: string,
  choice: ReasoningChoice | undefined,
): OpenAIChatReasoningContextProvider | null {
  return (
    getOpenAIChatReasoningContextBehavior(modelId, choice)?.provider ?? null
  );
}

export function getOpenAIChatReasoningContextBehavior(
  modelId: string,
  choice: ReasoningChoice | undefined,
): OpenAIChatReasoningContextBehavior | null {
  if (getDeepSeekV4Variant(modelId)) {
    return { provider: "deepseek-chat", capture: "tool-call" };
  }
  const glmVariant = getGlmReasoningVariant(modelId);
  if (glmVariant && isRetainedGlmReasoningChoice(glmVariant, choice)) {
    return { provider: "glm-chat", capture: "tool-call" };
  }
  const qwenVariant = getQwenChatReasoningVariant(modelId);
  if (
    (qwenVariant === "qwen3.8-max" || qwenVariant === "qwen3.8-max-preview") &&
    choice?.mode !== "off"
  ) {
    return { provider: "qwen-chat", capture: "always" };
  }
  if (isKimiK3Model(modelId)) {
    return { provider: "kimi-chat", capture: "always" };
  }
  return null;
}

function encodeDeepSeekReasoning(
  modelId: string,
  variant: NonNullable<ReturnType<typeof getDeepSeekV4Variant>>,
  choice: ReasoningChoice | undefined,
): OpenAIChatReasoningWire {
  if (!choice || choice.mode === "default") {
    return { suppressSampling: true };
  }
  if (choice.mode === "off") {
    return { thinking: { type: "disabled" }, suppressSampling: false };
  }
  if (choice.mode !== "effort") {
    throw invalidDeepSeekReasoningChoice(modelId);
  }

  const supportedEfforts =
    variant === "flash"
      ? (["low", "high", "max"] as const)
      : (["high", "max"] as const);
  if (!(supportedEfforts as readonly string[]).includes(choice.effort)) {
    throw invalidDeepSeekReasoningChoice(modelId);
  }
  return {
    thinking: { type: "enabled" },
    reasoningEffort: choice.effort,
    suppressSampling: true,
  };
}

function encodeGlmReasoning(
  modelId: string,
  variant: GlmReasoningVariant,
  choice: ReasoningChoice | undefined,
): OpenAIChatReasoningWire {
  if (!choice || choice.mode === "default") {
    return { suppressSampling: false };
  }
  if (choice.mode === "off") {
    return { thinking: { type: "disabled" }, suppressSampling: false };
  }
  if (variant === "switch" && isRetainedGlmReasoningChoice(variant, choice)) {
    return {
      thinking: { type: "enabled", clear_thinking: false },
      suppressSampling: false,
    };
  }
  if (
    variant === "glm-5.2" &&
    choice.mode === "effort" &&
    (choice.effort === "high" || choice.effort === "max")
  ) {
    return {
      thinking: { type: "enabled", clear_thinking: false },
      reasoningEffort: choice.effort,
      suppressSampling: false,
    };
  }
  throw invalidGlmReasoningChoice(modelId);
}

function isRetainedGlmReasoningChoice(
  variant: GlmReasoningVariant,
  choice: ReasoningChoice | undefined,
): boolean {
  return (
    (variant === "switch" && choice?.mode === "on") ||
    (variant === "glm-5.2" &&
      choice?.mode === "effort" &&
      (choice.effort === "high" || choice.effort === "max"))
  );
}

function encodeQwenReasoning(
  modelId: string,
  variant: QwenChatReasoningVariant,
  choice: ReasoningChoice | undefined,
): OpenAIChatReasoningWire {
  if (!choice || choice.mode === "default") {
    return { suppressSampling: false };
  }
  if (variant === "qwen3.8-max" || variant === "qwen3.8-max-preview") {
    if (choice.mode === "off" && variant === "qwen3.8-max") {
      return { enableThinking: false, suppressSampling: false };
    }
    if (
      choice.mode === "effort" &&
      (choice.effort === "low" ||
        choice.effort === "medium" ||
        choice.effort === "xhigh")
    ) {
      return {
        reasoningEffort: choice.effort,
        suppressSampling: false,
      };
    }
    throw invalidReasoningChoice(modelId);
  }

  if (choice.mode === "off" || choice.mode === "on") {
    return {
      enableThinking: choice.mode === "on",
      suppressSampling: false,
    };
  }
  throw invalidReasoningChoice(modelId);
}

function encodeKimiReasoning(
  modelId: string,
  choice: ReasoningChoice | undefined,
): OpenAIChatReasoningWire {
  if (!choice || choice.mode === "default") {
    return { suppressSampling: true };
  }
  if (
    choice.mode === "effort" &&
    (choice.effort === "low" ||
      choice.effort === "high" ||
      choice.effort === "max")
  ) {
    return {
      reasoningEffort: choice.effort,
      suppressSampling: true,
    };
  }
  throw invalidReasoningChoice(modelId);
}

export function toOpenAIReasoningEffort(
  request: Pick<ChatCompletionsRequest, "reasoning"> | undefined,
): string | undefined {
  return reasoningChoiceToEffort(request?.reasoning);
}

export function reasoningChoiceToEffort(
  choice: ReasoningChoice | undefined,
): string | undefined {
  if (!choice || choice.mode === "default") return undefined;
  if (choice.mode === "off") return "none";
  if (choice.mode === "auto") return "auto";
  if (choice.mode === "on") {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Explicit reasoning On is only supported by reviewed model encoders",
      null,
    );
  }
  return choice.effort;
}

function invalidDeepSeekReasoningChoice(modelId: string): ChatTransportError {
  return new ChatTransportError(
    "INVALID_REQUEST",
    `Reasoning choice is not supported by ${modelId}`,
    null,
  );
}

function invalidGlmReasoningChoice(modelId: string): ChatTransportError {
  return new ChatTransportError(
    "INVALID_REQUEST",
    `GLM reasoning choice is not supported by ${modelId}`,
    null,
  );
}

function invalidReasoningChoice(modelId: string): ChatTransportError {
  return new ChatTransportError(
    "INVALID_REQUEST",
    `Reasoning choice is not supported by ${modelId}`,
    null,
  );
}
