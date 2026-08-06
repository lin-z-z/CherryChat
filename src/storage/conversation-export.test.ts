import { strFromU8, unzipSync } from "fflate";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";

import { readBlobBytes, sha256Bytes } from "@/runtime/attachments/blob-utils";
import { projectConversationExport } from "@/runtime/chat/export-projection";
import {
  createDefaultAssistantSnapshot,
  DEFAULT_ASSISTANT_ID,
} from "@/runtime/chat/types";
import {
  exportConversationJson,
  exportConversationMarkdown,
} from "@/storage/conversation-export";
import { ChatDatabase } from "@/storage/database";

const timestamp = "2026-07-17T00:00:00.000Z";
const databases: ChatDatabase[] = [];

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe("conversation export", () => {
  it("uses one projection for branch scope and reasoning filtering", () => {
    const source = createSource();
    const all = projectConversationExport(source, {
      branch: "all",
      includeReasoning: false,
    });
    const current = projectConversationExport(source, {
      branch: "current",
      includeReasoning: true,
    });

    expect(all.conversation.activeModelId).toBe("gpt-4.1-mini");
    expect(current.conversation.activeModelId).toBe("gpt-4.1-mini");
    expect(all.messages.map(({ id }) => id)).toEqual([
      "user-1",
      "assistant-1",
      "assistant-2",
    ]);
    expect(
      all.messages
        .flatMap(({ parts }) => parts)
        .some(({ type }) => type === "reasoning"),
    ).toBe(false);
    expect(current.messages.map(({ id }) => id)).toEqual([
      "user-1",
      "assistant-2",
    ]);
    expect(
      current.messages
        .flatMap(({ parts }) => parts)
        .some(({ type }) => type === "reasoning"),
    ).toBe(true);
    expect(
      current.messages
        .flatMap(({ parts }) => parts)
        .some(({ type }) => type === "provider_context"),
    ).toBe(false);
  });

  it("exports all branches as JSON with an optional reasoning projection", async () => {
    const database = await createDatabase("conversation-json");
    await seedDatabase(database);

    const withoutReasoning = await exportConversationJson(
      database,
      "conversation-1",
      false,
    );
    const withReasoning = await exportConversationJson(
      database,
      "conversation-1",
      true,
    );
    const plainText = strFromU8(await readBlobBytes(withoutReasoning.blob));
    const reasoningText = strFromU8(await readBlobBytes(withReasoning.blob));
    const plainProjection: unknown = JSON.parse(plainText);

    expect(withoutReasoning.filename).toBe("Export fixture.json");
    expect(plainProjection).toMatchObject({
      conversation: { activeModelId: "gpt-4.1-mini" },
    });
    expect(plainText).toContain('"assistant-1"');
    expect(plainText).toContain('"assistant-2"');
    expect(plainText).not.toContain("Hidden chain");
    expect(reasoningText).toContain("Hidden chain");
    expect(reasoningText).not.toContain("encrypted-reasoning-context");
    expect(reasoningText).not.toContain("response-reasoning-item");
    expect(reasoningText).not.toContain("gemini-export-signature");
    expect(reasoningText).not.toContain("gemini-export-call");
    expect(reasoningText).not.toContain("deepseek export plan");
    expect(reasoningText).not.toContain("glm export plan");
    expect(reasoningText).not.toContain("qwen export plan");
    expect(reasoningText).not.toContain("kimi export plan");
    expect(reasoningText).not.toContain("anthropic-export-signature");
    expect(reasoningText).not.toContain("anthropic private plan");
    expect(reasoningText).not.toContain("data:image");
  });

  it("exports image Markdown as a ZIP with relative paths", async () => {
    const database = await createDatabase("conversation-markdown");
    await seedDatabase(database);

    const artifact = await exportConversationMarkdown(
      database,
      "conversation-1",
      false,
    );
    const files = unzipSync(await readBlobBytes(artifact.blob));
    const markdownName = Object.keys(files).find((name) =>
      name.endsWith(".md"),
    );
    if (!markdownName) throw new Error("Markdown file is missing");
    const markdown = strFromU8(files[markdownName] ?? new Uint8Array());

    expect(artifact.filename).toBe("Export fixture-markdown.zip");
    expect(Object.keys(files)).toContain("attachments/attachment-1.png");
    expect(markdown).toContain(
      "![Attached image](attachments/attachment-1.png)",
    );
    expect(markdown).toContain("Selected answer");
    expect(markdown).not.toContain("Old answer");
    expect(markdown).not.toContain("Hidden chain");
    expect(markdown).not.toContain("data:image");
    expect(markdown).not.toContain("blob:");
  });
});

function createSource() {
  const conversation = {
    id: "conversation-1",
    title: "Export fixture",
    titleSource: "user" as const,
    archived: false,
    activeLeafId: "assistant-2",
    activeModelId: "gpt-4.1-mini",
    contextCutoffId: null,
    assistantId: DEFAULT_ASSISTANT_ID,
    assistantSnapshot: createDefaultAssistantSnapshot(),
    autoTitle: true,
    webSearchEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const messages = [
    {
      id: "user-1",
      conversationId: conversation.id,
      parentId: null,
      role: "user" as const,
      parts: [
        { type: "text" as const, text: "Question" },
        { type: "image_ref" as const, attachmentId: "attachment-1", alt: null },
      ],
      status: "completed" as const,
      modelSnapshot: null,
      usage: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "assistant-1",
      conversationId: conversation.id,
      parentId: "user-1",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Old answer" }],
      status: "completed" as const,
      modelSnapshot: null,
      usage: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "assistant-2",
      conversationId: conversation.id,
      parentId: "user-1",
      role: "assistant" as const,
      parts: [
        {
          type: "reasoning" as const,
          text: "Hidden chain",
          source: "reasoning_content" as const,
          durationMs: 100,
        },
        {
          type: "provider_context" as const,
          provider: "openai-responses" as const,
          contextType: "reasoning" as const,
          step: 0,
          itemId: "response-reasoning-item",
          encryptedContent: "encrypted-reasoning-context",
          reasoningTokens: 12,
        },
        {
          type: "provider_context" as const,
          provider: "gemini" as const,
          contextType: "thought_signature" as const,
          step: 0,
          toolCallId: "gemini-export-call",
          thoughtSignature: "gemini-export-signature",
        },
        {
          type: "provider_context" as const,
          provider: "deepseek-chat" as const,
          contextType: "reasoning_content" as const,
          step: 0,
          text: "deepseek export plan",
        },
        {
          type: "provider_context" as const,
          provider: "glm-chat" as const,
          contextType: "reasoning_content" as const,
          step: 0,
          text: "glm export plan",
        },
        {
          type: "provider_context" as const,
          provider: "qwen-chat" as const,
          contextType: "reasoning_content" as const,
          step: 0,
          text: "qwen export plan",
        },
        {
          type: "provider_context" as const,
          provider: "kimi-chat" as const,
          contextType: "reasoning_content" as const,
          step: 0,
          text: "kimi export plan",
        },
        {
          type: "tool_call" as const,
          id: "deepseek-export-call",
          name: "web_search",
          step: 0,
          input: { query: "export" },
          output: [],
          status: "completed" as const,
          errorCode: null,
          errorStatus: null,
          retryable: false,
        },
        {
          type: "provider_context" as const,
          provider: "anthropic" as const,
          contextType: "thinking" as const,
          step: 0,
          blockIndex: 0,
          text: "anthropic private plan",
          signature: "anthropic-export-signature",
        },
        { type: "text" as const, text: "Selected answer" },
      ],
      status: "completed" as const,
      modelSnapshot: null,
      usage: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  return {
    conversation,
    messages,
    branchSelections: [
      {
        conversationId: conversation.id,
        parentKey: "$root",
        selectedChildId: "user-1",
      },
      {
        conversationId: conversation.id,
        parentKey: "user-1",
        selectedChildId: "assistant-2",
      },
    ],
    attachments: [
      {
        id: "attachment-1",
        blob: createIndexedDbFixtureBlob(new Uint8Array([1]), "image/png"),
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteSize: 1,
        sha256: "0".repeat(64),
        createdAt: timestamp,
      },
    ],
  };
}

async function createDatabase(prefix: string): Promise<ChatDatabase> {
  const database = new ChatDatabase(`${prefix}-${crypto.randomUUID()}`);
  databases.push(database);
  await database.open();
  return database;
}

async function seedDatabase(database: ChatDatabase): Promise<void> {
  const source = createSource();
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const attachment = source.attachments[0];
  if (!attachment) throw new Error("Fixture attachment is missing");
  await database.conversations.add(source.conversation);
  await database.messages.bulkAdd(source.messages);
  await database.branchSelections.bulkAdd(source.branchSelections);
  await database.attachments.add({
    ...attachment,
    blob: createIndexedDbFixtureBlob(bytes, "image/png"),
    byteSize: bytes.byteLength,
    sha256: await sha256Bytes(bytes),
  });
  await database.messageAttachments.add({
    messageId: "user-1",
    attachmentId: "attachment-1",
    conversationId: "conversation-1",
  });
}

function createIndexedDbFixtureBlob(bytes: Uint8Array, type: string): Blob {
  // fake-indexeddb 使用 Node structured clone；Node Blob 与 DOM Blob 仅类型泛型不同。
  return new NodeBlob([bytes], { type }) as unknown as Blob;
}
