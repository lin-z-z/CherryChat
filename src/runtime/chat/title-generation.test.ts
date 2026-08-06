import { describe, expect, it } from "vitest";

import {
  buildTitleRequest,
  parseGeneratedTitle,
  shouldGenerateTitle,
  TITLE_GENERATION_THRESHOLD,
} from "@/runtime/chat/title-generation";
import {
  createDefaultAssistantSnapshot,
  DEFAULT_ASSISTANT_ID,
  type MessageNode,
} from "@/runtime/chat/types";

const timestamp = "2026-07-17T00:00:00.000Z";

describe("title generation", () => {
  it("waits for enough completed user and assistant text", () => {
    const conversation = createConversation();
    expect(
      shouldGenerateTitle(conversation, [
        createMessage("user", "short"),
        createMessage("assistant", "answer"),
      ]),
    ).toBe(false);
    expect(
      shouldGenerateTitle(conversation, [
        createMessage("user", "Q".repeat(TITLE_GENERATION_THRESHOLD)),
        createMessage("assistant", "answer"),
      ]),
    ).toBe(true);
    expect(
      shouldGenerateTitle({ ...conversation, titleSource: "user" }, [
        createMessage("user", "Q".repeat(TITLE_GENERATION_THRESHOLD)),
        createMessage("assistant", "answer"),
      ]),
    ).toBe(false);
    expect(
      shouldGenerateTitle({ ...conversation, autoTitle: false }, [
        createMessage("user", "Q".repeat(TITLE_GENERATION_THRESHOLD)),
        createMessage("assistant", "answer"),
      ]),
    ).toBe(false);
  });

  it("builds one minimal non-streaming request without historical reasoning", () => {
    const request = buildTitleRequest("model", [
      createMessage("user", "Question"),
      {
        ...createMessage("assistant", "Answer"),
        parts: [
          {
            type: "reasoning",
            text: "Do not include this",
            source: "reasoning_content",
            durationMs: 100,
          },
          { type: "text", text: "Answer" },
        ],
      },
    ]);

    expect(request).toMatchObject({
      model: "model",
      stream: false,
      max_tokens: 32,
    });
    expect(JSON.stringify(request)).not.toContain("Do not include this");
  });

  it("normalizes the provider title and rejects empty output", () => {
    expect(
      parseGeneratedTitle({
        choices: [{ message: { content: '  "Cherry Chat Plan"  ' } }],
      }),
    ).toBe("Cherry Chat Plan");
    expect(() =>
      parseGeneratedTitle({ choices: [{ message: { content: "   " } }] }),
    ).toThrow(/empty/u);
  });
});

function createConversation() {
  return {
    id: "conversation",
    title: "Local title",
    titleSource: "local" as const,
    archived: false,
    activeLeafId: null,
    activeModelId: "gpt-4.1-mini",
    contextCutoffId: null,
    assistantId: DEFAULT_ASSISTANT_ID,
    assistantSnapshot: createDefaultAssistantSnapshot(),
    autoTitle: true,
    webSearchEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createMessage(role: "user" | "assistant", text: string): MessageNode {
  return {
    id: `${role}-${text.length}`,
    conversationId: "conversation",
    parentId: null,
    role,
    parts: [{ type: "text", text }],
    status: "completed",
    modelSnapshot: null,
    usage: null,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
