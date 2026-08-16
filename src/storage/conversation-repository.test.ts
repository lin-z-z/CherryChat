import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatDatabase } from "@/storage/database";
import { ConversationRepository } from "@/storage/conversation-repository";
import { createDefaultAssistantSnapshot } from "@/runtime/chat/types";
import { StorageError } from "@/storage/errors";

describe("ConversationRepository", () => {
  let database: ChatDatabase;
  let repository: ConversationRepository;
  let id = 0;
  let tick = 0;

  beforeEach(() => {
    database = new ChatDatabase(`cherrychat-test-${crypto.randomUUID()}`);
    repository = new ConversationRepository(database, {
      createId: () => `id-${++id}`,
      now: () => new Date(Date.UTC(2026, 6, 16, 0, 0, tick++)).toISOString(),
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await database.delete();
  });

  it("persists a trimmed active model and rejects blank updates", async () => {
    const conversation = await repository.createConversation({
      activeModelId: "  gpt-4.1-mini  ",
    });

    expect(conversation.activeModelId).toBe("gpt-4.1-mini");
    expect(conversation).not.toHaveProperty("contextMessageLimit");
    expect(conversation).not.toHaveProperty("advancedSettings");
    const storedConversation = await database.conversations.get(
      conversation.id,
    );
    expect(storedConversation).toMatchObject({
      activeModelId: "gpt-4.1-mini",
    });
    expect(storedConversation).not.toHaveProperty("contextMessageLimit");
    expect(storedConversation).not.toHaveProperty("advancedSettings");

    await repository.setActiveModel(conversation.id, "  o3-mini  ");
    await expect(
      repository.getConversation(conversation.id),
    ).resolves.toMatchObject({ activeModelId: "o3-mini" });

    await expect(
      repository.setActiveModel(conversation.id, "   "),
    ).rejects.toThrow("Active model ID cannot be empty");
    await expect(
      database.conversations.get(conversation.id),
    ).resolves.toMatchObject({ activeModelId: "o3-mini" });
  });

  it("recovers interrupted tool messages as stopped after a reload", async () => {
    const conversation = await repository.createConversation();
    const assistant = await repository.appendMessage(conversation.id, {
      role: "assistant",
      status: "streaming",
      parts: [
        { type: "text", text: "I will search." },
        {
          type: "tool_call",
          id: "call-1",
          name: "web_search",
          step: 0,
          input: { query: "latest" },
          output: null,
          status: "running",
          errorCode: null,
          errorStatus: null,
          retryable: false,
        },
      ],
    });

    await expect(repository.recoverInterruptedMessages()).resolves.toBe(1);
    await expect(database.messages.get(assistant.id)).resolves.toMatchObject({
      status: "stopped",
      parts: [
        { type: "text", text: "I will search." },
        {
          type: "tool_call",
          status: "error",
          errorCode: "TOOL_REQUEST_ABORTED",
          retryable: true,
        },
      ],
    });
    await expect(repository.recoverInterruptedMessages()).resolves.toBe(0);
  });

  it("rolls back messages and attachment links when a transaction fails", async () => {
    const conversation = await repository.createConversation();
    vi.spyOn(database.branchSelections, "put").mockRejectedValueOnce(
      new DOMException("aborted", "AbortError"),
    );

    await expect(
      repository.appendMessage(conversation.id, {
        role: "user",
        parts: [
          { type: "text", text: "Must roll back" },
          { type: "image_ref", attachmentId: "image-1", alt: null },
        ],
      }),
    ).rejects.toThrow();

    expect(await database.messages.count()).toBe(0);
    expect(await database.messageAttachments.count()).toBe(0);
    expect(await database.branchSelections.count()).toBe(0);
    expect(
      (await database.conversations.get(conversation.id))?.activeLeafId,
    ).toBeNull();
  });

  it("atomically completes image generation and rolls back failed attachment writes", async () => {
    const conversation = await repository.createConversation();
    const reference = await repository.appendMessage(conversation.id, {
      role: "user",
      parts: [{ type: "image_ref", attachmentId: "reference-1", alt: null }],
    });
    const assistant = await repository.appendMessage(conversation.id, {
      role: "assistant",
      status: "pending",
      parts: [
        {
          type: "image_generation",
          modelId: "gpt-image-test",
          connectionScope: "byok:https://images.example",
          size: "1024x1024",
          quality: "high",
          referenceAttachmentIds: ["reference-1"],
        },
      ],
    });
    expect(
      await database.messageAttachments.get([reference.id, "reference-1"]),
    ).toBeDefined();
    vi.spyOn(database.messageAttachments, "bulkPut").mockRejectedValueOnce(
      new DOMException("aborted", "AbortError"),
    );

    await expect(
      repository.completeImageGeneration(assistant.id, [processedImage()]),
    ).rejects.toBeInstanceOf(StorageError);
    expect(await database.attachments.count()).toBe(0);
    expect(await database.messages.get(assistant.id)).toMatchObject({
      status: "pending",
      parts: [{ type: "image_generation" }],
    });
    expect(
      await database.messageAttachments
        .where("messageId")
        .equals(assistant.id)
        .count(),
    ).toBe(1);
  });

  it("stores Assistant snapshots and only rebinds an empty conversation", async () => {
    const conversation = await repository.createConversation({
      assistant: {
        id: "assistant-code",
        snapshot: {
          name: "Code helper",
          icon: "code",
          systemPrompt: "Review code.",
        },
      },
    });
    expect(conversation).toMatchObject({
      assistantId: "assistant-code",
      assistantSnapshot: {
        name: "Code helper",
        icon: "code",
        systemPrompt: "Review code.",
      },
    });

    await expect(
      repository.rebindAssistantIfEmpty(conversation.id, {
        id: "default-assistant",
        snapshot: createDefaultAssistantSnapshot(),
      }),
    ).resolves.toBe(true);
    await repository.appendMessage(conversation.id, {
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    });
    await expect(
      repository.rebindAssistantIfEmpty(conversation.id, {
        id: "assistant-writer",
        snapshot: { name: "Writer", icon: "pen", systemPrompt: "Write." },
      }),
    ).resolves.toBe(false);
    expect(await repository.getConversation(conversation.id)).toMatchObject({
      assistantId: "default-assistant",
      assistantSnapshot: createDefaultAssistantSnapshot(),
    });
  });

  it("creates branches without overwriting old messages", async () => {
    const conversation = await repository.createConversation();
    const originalUser = await repository.appendMessage(conversation.id, {
      role: "user",
      parts: [{ type: "text", text: "Original" }],
    });
    const originalAssistant = await repository.appendMessage(conversation.id, {
      role: "assistant",
      parts: [{ type: "text", text: "First answer" }],
    });
    expect(originalUser.error).toBeNull();
    expect(originalAssistant.error).toBeNull();

    const editedUser = await repository.createVersion(originalUser.id, {
      role: "user",
      parts: [{ type: "text", text: "Edited" }],
    });
    const editedAssistant = await repository.appendMessage(conversation.id, {
      role: "assistant",
      parts: [{ type: "text", text: "Edited answer" }],
    });

    expect(
      (await repository.getCurrentPath(conversation.id)).map(({ id }) => id),
    ).toEqual([editedUser.id, editedAssistant.id]);
    expect(await repository.listMessages(conversation.id)).toHaveLength(4);

    const restoredPath = await repository.selectVersion(originalUser.id);
    expect(restoredPath.map(({ id }) => id)).toEqual([
      originalUser.id,
      originalAssistant.id,
    ]);
  });

  it("regenerates an assistant response as a sibling version", async () => {
    const conversation = await repository.createConversation();
    const user = await repository.appendMessage(conversation.id, {
      role: "user",
      parts: [{ type: "text", text: "Question" }],
    });
    const first = await repository.appendMessage(conversation.id, {
      role: "assistant",
      parts: [{ type: "text", text: "First" }],
    });
    const regenerated = await repository.createVersion(first.id, {
      role: "assistant",
      parts: [{ type: "text", text: "Second" }],
    });

    expect(
      (await repository.getCurrentPath(conversation.id)).map(({ id }) => id),
    ).toEqual([user.id, regenerated.id]);
    expect(await repository.listMessages(conversation.id)).toHaveLength(3);
  });

  it("searches every branch and can select the matching message path", async () => {
    const conversation = await repository.createConversation({
      title: "Research",
    });
    const originalUser = await repository.appendMessage(conversation.id, {
      role: "user",
      parts: [{ type: "text", text: "First branch" }],
    });
    await repository.appendMessage(conversation.id, {
      role: "assistant",
      parts: [{ type: "text", text: "Hidden searchable answer" }],
    });
    await repository.createVersion(originalUser.id, {
      role: "user",
      parts: [{ type: "text", text: "Current branch" }],
    });

    const [result] = await repository.search("SEARCHABLE");
    expect(result?.snippet).toContain("Hidden searchable answer");
    expect(result?.messageId).not.toBeNull();
    if (!result?.messageId) throw new Error("Expected a message search result");

    const selectedPath = await repository.selectPathToMessage(result.messageId);
    expect(selectedPath.map(({ parts }) => parts[0])).toEqual([
      { type: "text", text: "First branch" },
      { type: "text", text: "Hidden searchable answer" },
    ]);
  });

  it("sets a context boundary without deleting messages", async () => {
    const conversation = await repository.createConversation();
    const user = await repository.appendMessage(conversation.id, {
      role: "user",
      parts: [{ type: "text", text: "Keep locally" }],
    });

    await repository.setContextCutoff(conversation.id, user.id);

    expect(
      (await database.conversations.get(conversation.id))?.contextCutoffId,
    ).toBe(user.id);
    expect(await repository.listMessages(conversation.id)).toHaveLength(1);
  });

  it("keeps a shared attachment until its last message reference is deleted", async () => {
    const firstConversation = await repository.createConversation();
    const firstMessage = await repository.appendMessage(firstConversation.id, {
      role: "user",
      parts: [
        { type: "text", text: "First" },
        { type: "image_ref", attachmentId: "attachment-1", alt: null },
      ],
    });
    const secondConversation = await repository.createConversation();
    const secondMessage = await repository.appendMessage(
      secondConversation.id,
      {
        role: "user",
        parts: [
          { type: "text", text: "Second" },
          { type: "image_ref", attachmentId: "attachment-1", alt: null },
        ],
      },
    );
    await database.attachments.add({
      id: "attachment-1",
      blob: new Blob(["image"], { type: "image/webp" }),
      mimeType: "image/webp",
      width: 1,
      height: 1,
      byteSize: 5,
      sha256: "hash",
      createdAt: "2026-07-16T00:00:00.000Z",
    });

    expect(
      await database.messageAttachments.get([firstMessage.id, "attachment-1"]),
    ).toBeDefined();
    expect(
      await database.messageAttachments.get([secondMessage.id, "attachment-1"]),
    ).toBeDefined();

    await repository.deleteConversation(firstConversation.id);
    expect(await database.attachments.get("attachment-1")).toBeDefined();

    await repository.deleteConversation(secondConversation.id);
    expect(await database.attachments.get("attachment-1")).toBeUndefined();
  });

  it("reuses images by default when editing and allows individual removal", async () => {
    const conversation = await repository.createConversation();
    const original = await repository.appendMessage(conversation.id, {
      role: "user",
      parts: [
        { type: "text", text: "Original" },
        { type: "image_ref", attachmentId: "image-1", alt: null },
        { type: "image_ref", attachmentId: "image-2", alt: null },
      ],
    });

    const reused = await repository.editUserMessage(original.id, "Edited");
    expect(reused.parts).toEqual([
      { type: "text", text: "Edited" },
      { type: "image_ref", attachmentId: "image-1", alt: null },
      { type: "image_ref", attachmentId: "image-2", alt: null },
    ]);

    const removed = await repository.editUserMessage(
      original.id,
      "Edited again",
      ["image-2"],
    );
    expect(removed.parts).toEqual([
      { type: "text", text: "Edited again" },
      { type: "image_ref", attachmentId: "image-2", alt: null },
    ]);
  });

  it("lists archived and active conversations separately", async () => {
    const active = await repository.createConversation({ title: "Active" });
    const archived = await repository.createConversation({ title: "Archived" });
    await repository.setArchived(archived.id, true);

    expect(
      (await repository.listConversations(false)).map(({ id }) => id),
    ).toEqual([active.id]);
    expect(
      (await repository.listConversations(true)).map(({ id }) => id),
    ).toEqual([archived.id]);
  });

  it("never lets an AI title overwrite a manual title", async () => {
    const conversation = await repository.createConversation();
    await repository.setAiTitle(conversation.id, "Generated title");
    expect(
      (await repository.getConversation(conversation.id)).titleSource,
    ).toBe("ai");

    const manual = await repository.createConversation();
    await repository.rename(manual.id, "Manual title");
    await repository.setAiTitle(manual.id, "Should not win");
    expect(await repository.getConversation(manual.id)).toMatchObject({
      title: "Manual title",
      titleSource: "user",
    });
  });
});

function processedImage() {
  return {
    blob: new Blob(["generated"], { type: "image/png" }),
    mimeType: "image/png" as const,
    width: 1,
    height: 1,
    byteSize: 9,
    sha256: "generated".padEnd(64, "0"),
  };
}
