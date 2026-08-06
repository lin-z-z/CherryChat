import { z } from "zod";

import type { ChatCompletionMessage } from "@/runtime/chat/chat-completions-contract";
import { textFromMessage } from "@/runtime/chat/projections";
import type { ConversationRecord, MessageNode } from "@/runtime/chat/types";
import type { NonStreamingChatCompletionsRequest } from "@/runtime/transport/chat-transport";

export const TITLE_GENERATION_THRESHOLD = 80;
export const TITLE_SOURCE_MAX_CHARACTERS = 1_600;
export const TITLE_MAX_CHARACTERS = 80;

const titleResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string() }).passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export function shouldGenerateTitle(
  conversation: ConversationRecord,
  messages: readonly MessageNode[],
): boolean {
  if (!conversation.autoTitle || conversation.titleSource !== "local") {
    return false;
  }
  const completedRoles = new Set(
    messages
      .filter(({ status }) => status === "completed" || status === "stopped")
      .map(({ role }) => role),
  );
  if (!completedRoles.has("user") || !completedRoles.has("assistant")) {
    return false;
  }
  return titleSourceText(messages).length >= TITLE_GENERATION_THRESHOLD;
}

export function buildTitleRequest(
  modelId: string,
  messages: readonly MessageNode[],
): NonStreamingChatCompletionsRequest {
  const requestMessages: ChatCompletionMessage[] = [
    {
      role: "system",
      content:
        "Create one concise title for this conversation. Return only the title, with no quotes, label, or punctuation wrapper. Use at most 8 words.",
    },
    { role: "user", content: titleSourceText(messages) },
  ];
  return {
    model: modelId,
    messages: requestMessages,
    stream: false,
    max_tokens: 32,
  };
}

export function parseGeneratedTitle(value: unknown): string {
  const parsed = titleResponseSchema.parse(value);
  const content = parsed.choices[0]?.message.content ?? "";
  const title = content
    .normalize("NFKC")
    .replace(/^[\s"'“”‘’`#*-]+|[\s"'“”‘’`]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, TITLE_MAX_CHARACTERS)
    .trim();
  if (!title) throw new Error("The title response was empty");
  return title;
}

function titleSourceText(messages: readonly MessageNode[]): string {
  return messages
    .filter(({ status }) => status !== "pending" && status !== "error")
    .map((message) => {
      const text = textFromMessage(message).trim();
      return text ? `${message.role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, TITLE_SOURCE_MAX_CHARACTERS);
}
