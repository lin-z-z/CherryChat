import { describe, expect, it } from "vitest";

import {
  buildSelectedPath,
  getSiblingPosition,
  MessageTreeIntegrityError,
  parentKey,
} from "@/runtime/chat/message-tree";
import type { BranchSelectionRecord, MessageNode } from "@/runtime/chat/types";

function message(
  id: string,
  parentId: string | null,
  createdAt = "2026-07-16T00:00:00.000Z",
) {
  return {
    id,
    conversationId: "conversation-1",
    parentId,
    role: id.startsWith("u") ? "user" : "assistant",
    parts: [{ type: "text", text: id }],
    status: "completed",
    modelSnapshot: null,
    usage: null,
    error: null,
    createdAt,
    updatedAt: createdAt,
  } satisfies MessageNode;
}

function selection(
  parentId: string | null,
  selectedChildId: string,
): BranchSelectionRecord {
  return {
    conversationId: "conversation-1",
    parentKey: parentKey(parentId),
    selectedChildId,
  };
}

describe("message tree projection", () => {
  it("builds only the selected root-to-leaf path", () => {
    const messages = [
      message("u1", null),
      message("a1", "u1"),
      message("a2", "u1"),
      message("u2", "a2"),
    ];
    const selections = [
      selection(null, "u1"),
      selection("u1", "a2"),
      selection("a2", "u2"),
    ];

    expect(buildSelectedPath(messages, selections).map(({ id }) => id)).toEqual(
      ["u1", "a2", "u2"],
    );
  });

  it("rejects a selection whose child belongs to another parent", () => {
    const messages = [message("u1", null), message("a1", "u1")];
    const selections = [selection(null, "a1")];

    expect(() => buildSelectedPath(messages, selections)).toThrow(
      MessageTreeIntegrityError,
    );
  });

  it("returns deterministic sibling positions", () => {
    const messages = [
      message("u1", null),
      message("u2", null, "2026-07-16T00:00:01.000Z"),
    ];

    const result = getSiblingPosition("u2", messages);
    expect(result.index).toBe(1);
    expect(result.total).toBe(2);
    expect(result.siblings.map(({ id }) => id)).toEqual(["u1", "u2"]);
  });
});
