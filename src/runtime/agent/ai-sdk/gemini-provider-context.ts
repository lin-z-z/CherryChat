import { z } from "zod";

import {
  GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS,
  geminiThoughtSignatureContextPartSchema,
} from "@/runtime/chat/schemas";
import type { GeminiThoughtSignatureContextPart } from "@/runtime/chat/types";

const geminiToolMetadataSchema = z
  .object({
    google: z
      .object({
        thoughtSignature: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export function parseGeminiThoughtSignatureContext(
  providerMetadata: unknown,
  step: number,
  toolCallId: string,
): GeminiThoughtSignatureContextPart | null {
  const metadata = geminiToolMetadataSchema.safeParse(providerMetadata);
  if (!metadata.success) return null;
  const part = geminiThoughtSignatureContextPartSchema.safeParse({
    type: "provider_context",
    provider: "gemini",
    contextType: "thought_signature",
    step,
    toolCallId,
    thoughtSignature: metadata.data.google.thoughtSignature,
  });
  return part.success ? part.data : null;
}

export function canAppendGeminiThoughtSignatureContext(
  current: readonly GeminiThoughtSignatureContextPart[],
  candidate: GeminiThoughtSignatureContextPart,
): boolean {
  if (
    current.some(
      ({ step, toolCallId }) =>
        step === candidate.step && toolCallId === candidate.toolCallId,
    )
  ) {
    return false;
  }
  if (
    current.length >= GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS.maxItemsPerMessage
  ) {
    return false;
  }
  const totalBytes = [...current, candidate].reduce(
    (total, part) => total + utf8ByteLength(part.thoughtSignature),
    0,
  );
  return (
    totalBytes <=
    GEMINI_THOUGHT_SIGNATURE_CONTEXT_LIMITS.maxTotalThoughtSignatureBytes
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
