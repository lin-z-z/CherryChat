import { z } from "zod";

import {
  ANTHROPIC_THINKING_CONTEXT_LIMITS,
  anthropicThinkingContextPartSchema,
} from "@/runtime/chat/schemas";
import type { AnthropicThinkingContextPart } from "@/runtime/chat/types";

const anthropicReasoningMetadataSchema = z
  .object({
    anthropic: z
      .object({
        signature: z.string().optional(),
        redactedData: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export interface ParsedAnthropicReasoningMetadata {
  signature: string | null;
  redactedData: string | null;
}

export function parseAnthropicReasoningMetadata(
  providerMetadata: unknown,
): ParsedAnthropicReasoningMetadata | null {
  const metadata = anthropicReasoningMetadataSchema.safeParse(providerMetadata);
  if (!metadata.success) return null;
  const { signature, redactedData } = metadata.data.anthropic;
  if (!signature && !redactedData) return null;
  if (signature && redactedData) return null;
  return {
    signature: signature?.trim() ? signature : null,
    redactedData: redactedData?.trim() ? redactedData : null,
  };
}

export function parseAnthropicThinkingContext(
  candidate: unknown,
): AnthropicThinkingContextPart | null {
  const parsed = anthropicThinkingContextPartSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function canAppendAnthropicThinkingContext(
  current: readonly AnthropicThinkingContextPart[],
  candidate: AnthropicThinkingContextPart,
): boolean {
  if (
    current.some(
      ({ step, blockIndex }) =>
        step === candidate.step && blockIndex === candidate.blockIndex,
    )
  ) {
    return false;
  }
  if (current.length >= ANTHROPIC_THINKING_CONTEXT_LIMITS.maxItemsPerMessage) {
    return false;
  }
  return (
    [...current, candidate].reduce(
      (total, part) => total + anthropicContextBytes(part),
      0,
    ) <= ANTHROPIC_THINKING_CONTEXT_LIMITS.maxTotalBytes
  );
}

function anthropicContextBytes(part: AnthropicThinkingContextPart): number {
  return part.contextType === "thinking"
    ? utf8ByteLength(part.text) + utf8ByteLength(part.signature)
    : utf8ByteLength(part.redactedData);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
