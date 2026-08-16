import type { MessagePart } from "@/runtime/chat/types";

export function attachmentIdsFromParts(
  parts: readonly MessagePart[],
): string[] {
  const ids: string[] = [];
  for (const part of parts) {
    if (part.type === "image_ref") {
      ids.push(part.attachmentId);
    } else if (part.type === "image_generation") {
      ids.push(...part.referenceAttachmentIds);
    }
  }
  return [...new Set(ids)];
}
