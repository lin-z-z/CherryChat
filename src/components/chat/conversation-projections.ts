import type { ConversationRecord } from "@/runtime/chat/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ConversationDateGroupKey =
  | "today"
  | "yesterday"
  | "previous7Days"
  | "previous30Days"
  | "earlier"
  | `month:${string}`;

export interface ConversationDateGroup {
  key: ConversationDateGroupKey;
  conversations: ConversationRecord[];
}

export type RelativeConversationTime =
  | { kind: "justNow" }
  | { kind: "minutes"; value: number }
  | { kind: "hours"; value: number }
  | { kind: "days"; value: number }
  | { kind: "date"; date: Date };

export function groupConversationsByDate(
  conversations: readonly ConversationRecord[],
  now = new Date(),
): ConversationDateGroup[] {
  const groups = new Map<ConversationDateGroupKey, ConversationRecord[]>();
  for (const conversation of conversations) {
    const updatedAt = new Date(conversation.updatedAt);
    const key = getConversationDateGroupKey(updatedAt, now);
    const group = groups.get(key);
    if (group) group.push(conversation);
    else groups.set(key, [conversation]);
  }
  return [...groups].map(([key, groupedConversations]) => ({
    key,
    conversations: groupedConversations,
  }));
}

export function projectRelativeConversationTime(
  updatedAt: Date,
  now = new Date(),
): RelativeConversationTime {
  const elapsedMs = Math.max(0, now.getTime() - updatedAt.getTime());
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) {
    return { kind: "justNow" };
  }
  if (elapsedMs < 60 * 60_000) {
    return { kind: "minutes", value: Math.floor(elapsedMs / 60_000) };
  }
  if (elapsedMs < DAY_MS) {
    return { kind: "hours", value: Math.floor(elapsedMs / (60 * 60_000)) };
  }
  if (elapsedMs < 7 * DAY_MS) {
    return { kind: "days", value: Math.floor(elapsedMs / DAY_MS) };
  }
  return { kind: "date", date: updatedAt };
}

function getConversationDateGroupKey(
  updatedAt: Date,
  now: Date,
): ConversationDateGroupKey {
  if (Number.isNaN(updatedAt.getTime())) return "earlier";
  const difference = localDayNumber(now) - localDayNumber(updatedAt);
  if (difference <= 0) return "today";
  if (difference === 1) return "yesterday";
  if (difference < 7) return "previous7Days";
  if (difference < 30) return "previous30Days";
  return `month:${updatedAt.getFullYear()}-${String(updatedAt.getMonth() + 1).padStart(2, "0")}`;
}

function localDayNumber(value: Date): number {
  return Math.floor(
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY_MS,
  );
}
