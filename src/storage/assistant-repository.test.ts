import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_ID,
  DEFAULT_ASSISTANT_NAME,
} from "@/runtime/chat/types";
import {
  AssistantRepository,
  DefaultAssistantOperationError,
} from "@/storage/assistant-repository";
import { ChatDatabase } from "@/storage/database";
import { ConversationRepository } from "@/storage/conversation-repository";

describe("AssistantRepository", () => {
  let database: ChatDatabase;
  let repository: AssistantRepository;
  let id = 0;
  let tick = 0;

  beforeEach(() => {
    database = new ChatDatabase(`assistant-test-${crypto.randomUUID()}`);
    repository = new AssistantRepository(database, {
      createId: () => `assistant-${++id}`,
      now: () => new Date(Date.UTC(2026, 6, 20, 0, 0, tick++)).toISOString(),
    });
  });

  afterEach(async () => {
    await database.delete();
  });

  it("seeds one stable Default Assistant idempotently", async () => {
    const first = await repository.ensureDefault();
    const second = await repository.ensureDefault();

    expect(first).toMatchObject({
      id: DEFAULT_ASSISTANT_ID,
      kind: "default",
      name: DEFAULT_ASSISTANT_NAME,
      icon: DEFAULT_ASSISTANT_ICON,
      systemPrompt: "",
    });
    expect(second.id).toBe(first.id);
    expect(await database.assistants.count()).toBe(1);
  });

  it("creates and updates a custom Assistant with a detached snapshot", async () => {
    await repository.ensureDefault();
    const created = await repository.create({
      name: "  Code helper  ",
      icon: "code",
      systemPrompt: "  Review carefully.  ",
    });
    const snapshot = repository.snapshot(created);
    const updated = await repository.update(created.id, {
      name: "Reviewer",
      icon: "book",
      systemPrompt: "Find regressions.",
    });

    expect(created).toMatchObject({
      kind: "custom",
      name: "Code helper",
      systemPrompt: "Review carefully.",
    });
    expect(snapshot).toEqual({
      name: "Code helper",
      icon: "code",
      systemPrompt: "Review carefully.",
    });
    expect(updated.name).toBe("Reviewer");
    expect(snapshot.name).toBe("Code helper");
    expect((await repository.list()).map(({ id }) => id)).toEqual([
      DEFAULT_ASSISTANT_ID,
      created.id,
    ]);
  });

  it("keeps Default identity fixed while allowing its prompt to change", async () => {
    const current = await repository.ensureDefault();
    await expect(
      repository.update(current.id, {
        name: "Renamed",
        icon: current.icon,
        systemPrompt: "",
      }),
    ).rejects.toBeInstanceOf(DefaultAssistantOperationError);

    const updated = await repository.update(current.id, {
      name: DEFAULT_ASSISTANT_NAME,
      icon: DEFAULT_ASSISTANT_ICON,
      systemPrompt: "Be concise.",
    });
    expect(updated.systemPrompt).toBe("Be concise.");
  });

  it("deletes custom Assistants but never the Default Assistant", async () => {
    const defaultAssistant = await repository.ensureDefault();
    const custom = await repository.create({
      name: "Writer",
      icon: "pen",
      systemPrompt: "",
    });
    const conversationRepository = new ConversationRepository(database);
    const conversation = await conversationRepository.createConversation({
      assistant: { id: custom.id, snapshot: repository.snapshot(custom) },
    });

    await repository.delete(custom.id);
    expect(await database.assistants.get(custom.id)).toBeUndefined();
    expect(await database.conversations.get(conversation.id)).toMatchObject({
      assistantId: custom.id,
      assistantSnapshot: { name: "Writer", icon: "pen", systemPrompt: "" },
    });
    await expect(repository.delete(defaultAssistant.id)).rejects.toBeInstanceOf(
      DefaultAssistantOperationError,
    );
  });
});
