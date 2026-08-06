import type { MessageNode, TokenUsage } from "@/runtime/chat/types";

export interface ConversationUsageSummary extends TokenUsage {
  messageCount: number;
}

export function summarizeBranchUsage(
  path: readonly MessageNode[],
): ConversationUsageSummary {
  const summary: ConversationUsageSummary = {
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimated: false,
    messageCount: 0,
  };

  for (const message of path) {
    if (message.role !== "assistant" || !message.usage) continue;
    summary.messageCount += 1;
    summary.estimated ||= message.usage.estimated;
    summary.promptTokens = addNullable(
      summary.promptTokens,
      message.usage.promptTokens,
    );
    summary.completionTokens = addNullable(
      summary.completionTokens,
      message.usage.completionTokens,
    );
    summary.reasoningTokens = addNullable(
      summary.reasoningTokens,
      message.usage.reasoningTokens,
    );
    summary.totalTokens = addNullable(
      summary.totalTokens,
      message.usage.totalTokens,
    );
  }

  return summary;
}

function addNullable(
  total: number | null,
  value: number | null,
): number | null {
  if (total === null || value === null) return null;
  return total + value;
}

export function textFromMessage(message: MessageNode): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
