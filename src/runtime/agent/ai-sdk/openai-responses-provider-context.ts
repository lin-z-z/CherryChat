import { z } from "zod";

import {
  OPENAI_RESPONSES_CONTEXT_LIMITS,
  openAIResponsesContextPartSchema,
} from "@/runtime/chat/schemas";
import type { OpenAIResponsesContextPart } from "@/runtime/chat/types";

const openAIReasoningMetadataSchema = z
  .object({
    openai: z
      .object({
        itemId: z.string(),
        reasoningEncryptedContent: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export function parseOpenAIResponsesProviderContext(
  providerMetadata: unknown,
  step: number,
): OpenAIResponsesContextPart | null {
  const metadata = openAIReasoningMetadataSchema.safeParse(providerMetadata);
  if (!metadata.success) return null;
  const encryptedContent = metadata.data.openai.reasoningEncryptedContent;
  if (!encryptedContent) return null;

  const part = openAIResponsesContextPartSchema.safeParse({
    type: "provider_context",
    provider: "openai-responses",
    contextType: "reasoning",
    step,
    itemId: metadata.data.openai.itemId,
    encryptedContent,
    reasoningTokens: null,
  });
  return part.success ? part.data : null;
}

export function canAppendOpenAIResponsesProviderContext(
  current: readonly OpenAIResponsesContextPart[],
  candidate: OpenAIResponsesContextPart,
): boolean {
  if (current.some(({ itemId }) => itemId === candidate.itemId)) return false;
  if (current.length >= OPENAI_RESPONSES_CONTEXT_LIMITS.maxItemsPerMessage) {
    return false;
  }
  const totalBytes = [...current, candidate].reduce(
    (total, part) => total + utf8ByteLength(part.encryptedContent),
    0,
  );
  return (
    totalBytes <= OPENAI_RESPONSES_CONTEXT_LIMITS.maxTotalEncryptedContentBytes
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
