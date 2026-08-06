import {
  OPENAI_CHAT_REASONING_CONTEXT_LIMITS,
  deepSeekReasoningContextPartSchema,
  glmReasoningContextPartSchema,
  kimiReasoningContextPartSchema,
  qwenReasoningContextPartSchema,
} from "@/runtime/chat/schemas";
import type {
  DeepSeekReasoningContextPart,
  OpenAIChatReasoningContextPart,
  OpenAIChatReasoningContextProvider,
} from "@/runtime/chat/types";

export function createOpenAIChatReasoningContext(
  provider: OpenAIChatReasoningContextProvider,
  step: number,
  text: string,
): OpenAIChatReasoningContextPart | null {
  const schemas = {
    "deepseek-chat": deepSeekReasoningContextPartSchema,
    "glm-chat": glmReasoningContextPartSchema,
    "qwen-chat": qwenReasoningContextPartSchema,
    "kimi-chat": kimiReasoningContextPartSchema,
  } as const;
  const schema = schemas[provider];
  const parsed = schema.safeParse({
    type: "provider_context",
    provider,
    contextType: "reasoning_content",
    step,
    text,
  });
  return parsed.success ? parsed.data : null;
}

export function canAppendOpenAIChatReasoningContext(
  current: readonly OpenAIChatReasoningContextPart[],
  candidate: OpenAIChatReasoningContextPart,
): boolean {
  if (
    current.length >= OPENAI_CHAT_REASONING_CONTEXT_LIMITS.maxItemsPerMessage ||
    current.some(({ step }) => step === candidate.step)
  ) {
    return false;
  }
  const totalBytes = [...current, candidate].reduce(
    (total, part) => total + new TextEncoder().encode(part.text).byteLength,
    0,
  );
  return totalBytes <= OPENAI_CHAT_REASONING_CONTEXT_LIMITS.maxTotalTextBytes;
}

export function createDeepSeekReasoningContext(
  step: number,
  text: string,
): DeepSeekReasoningContextPart | null {
  const context = createOpenAIChatReasoningContext("deepseek-chat", step, text);
  return context?.provider === "deepseek-chat" ? context : null;
}

export function canAppendDeepSeekReasoningContext(
  current: readonly DeepSeekReasoningContextPart[],
  candidate: DeepSeekReasoningContextPart,
): boolean {
  return canAppendOpenAIChatReasoningContext(current, candidate);
}
