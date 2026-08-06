import type { BranchSelectionRecord, MessageNode } from "@/runtime/chat/types";

export const ROOT_PARENT_KEY = "$root";

export class MessageTreeIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageTreeIntegrityError";
  }
}

export function parentKey(parentId: string | null): string {
  return parentId ?? ROOT_PARENT_KEY;
}

export function buildSelectedPath(
  messages: readonly MessageNode[],
  selections: readonly BranchSelectionRecord[],
): MessageNode[] {
  const messagesById = new Map(
    messages.map((message) => [message.id, message]),
  );
  if (messagesById.size !== messages.length) {
    throw new MessageTreeIntegrityError("Duplicate message IDs detected");
  }

  const selectedChildByParent = new Map(
    selections.map((selection) => [
      selection.parentKey,
      selection.selectedChildId,
    ]),
  );
  const path: MessageNode[] = [];
  const visited = new Set<string>();
  let expectedParentId: string | null = null;

  while (true) {
    const selectedChildId = selectedChildByParent.get(
      parentKey(expectedParentId),
    );
    if (!selectedChildId) {
      return path;
    }

    const message = messagesById.get(selectedChildId);
    if (!message) {
      throw new MessageTreeIntegrityError(
        `Selected message does not exist: ${selectedChildId}`,
      );
    }
    if (message.parentId !== expectedParentId) {
      throw new MessageTreeIntegrityError(
        `Selected message has an invalid parent: ${selectedChildId}`,
      );
    }
    if (visited.has(message.id)) {
      throw new MessageTreeIntegrityError(
        `Message cycle detected: ${message.id}`,
      );
    }

    visited.add(message.id);
    path.push(message);
    expectedParentId = message.id;
  }
}

export function getSiblingPosition(
  messageId: string,
  messages: readonly MessageNode[],
): { index: number; total: number; siblings: MessageNode[] } {
  const current = messages.find((message) => message.id === messageId);
  if (!current) {
    throw new MessageTreeIntegrityError(`Message does not exist: ${messageId}`);
  }

  const siblings = messages
    .filter(
      (message) =>
        message.conversationId === current.conversationId &&
        message.parentId === current.parentId,
    )
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    );

  return {
    index: siblings.findIndex((message) => message.id === messageId),
    total: siblings.length,
    siblings,
  };
}
