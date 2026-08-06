import { describe, expect, it } from "vitest";

import { summarizeBranchUsage } from "@/runtime/chat/projections";
import type { MessageNode } from "@/runtime/chat/types";

function assistant(
  id: string,
  totalTokens: number,
  estimated: boolean,
): MessageNode {
  return {
    id,
    conversationId: "conversation",
    parentId: null,
    role: "assistant",
    parts: [{ type: "text", text: id }],
    status: "completed",
    modelSnapshot: null,
    usage: {
      promptTokens: totalTokens - 2,
      completionTokens: 2,
      reasoningTokens: 0,
      totalTokens,
      estimated,
    },
    error: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

describe("summarizeBranchUsage", () => {
  it("aggregates only messages supplied by the current branch projection", () => {
    expect(
      summarizeBranchUsage([
        assistant("a1", 10, false),
        assistant("a2", 20, true),
      ]),
    ).toEqual({
      promptTokens: 26,
      completionTokens: 4,
      reasoningTokens: 0,
      totalTokens: 30,
      estimated: true,
      messageCount: 2,
    });
  });
});
