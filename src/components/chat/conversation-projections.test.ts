import { describe, expect, it } from "vitest";

import {
  groupConversationsByDate,
  projectRelativeConversationTime,
} from "@/components/chat/conversation-projections";
import {
  createDefaultAssistantSnapshot,
  DEFAULT_ASSISTANT_ID,
  type ConversationRecord,
} from "@/runtime/chat/types";

const now = new Date(2026, 6, 17, 12, 0, 0);

function conversation(id: string, updatedAt: Date): ConversationRecord {
  return {
    id,
    title: id,
    titleSource: "local",
    archived: false,
    activeLeafId: null,
    activeModelId: null,
    contextCutoffId: null,
    assistantId: DEFAULT_ASSISTANT_ID,
    assistantSnapshot: createDefaultAssistantSnapshot(),
    autoTitle: true,
    webSearchEnabled: false,
    createdAt: updatedAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

describe("conversation sidebar projections", () => {
  it("groups conversations by local calendar buckets without reordering rows", () => {
    const rows = [
      conversation("today", new Date(2026, 6, 17, 10)),
      conversation("yesterday", new Date(2026, 6, 16, 18)),
      conversation("week", new Date(2026, 6, 13, 9)),
      conversation("month", new Date(2026, 6, 2, 9)),
      conversation("may", new Date(2026, 4, 25, 9)),
    ];

    expect(
      groupConversationsByDate(rows, now).map((group) => ({
        key: group.key,
        ids: group.conversations.map(({ id }) => id),
      })),
    ).toEqual([
      { key: "today", ids: ["today"] },
      { key: "yesterday", ids: ["yesterday"] },
      { key: "previous7Days", ids: ["week"] },
      { key: "previous30Days", ids: ["month"] },
      { key: "month:2026-05", ids: ["may"] },
    ]);
  });

  it("projects stable relative-time units at their boundaries", () => {
    expect(
      projectRelativeConversationTime(new Date(2026, 6, 17, 11, 59, 40), now),
    ).toEqual({ kind: "justNow" });
    expect(
      projectRelativeConversationTime(new Date(2026, 6, 17, 11, 55), now),
    ).toEqual({ kind: "minutes", value: 5 });
    expect(
      projectRelativeConversationTime(new Date(2026, 6, 17, 9), now),
    ).toEqual({ kind: "hours", value: 3 });
    expect(
      projectRelativeConversationTime(new Date(2026, 6, 14, 12), now),
    ).toEqual({ kind: "days", value: 3 });
    expect(
      projectRelativeConversationTime(new Date(2026, 5, 1, 12), now),
    ).toEqual({ kind: "date", date: new Date(2026, 5, 1, 12) });
  });
});
