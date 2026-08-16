import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";

import { readBlobBytes, sha256Bytes } from "@/runtime/attachments/blob-utils";
import {
  createDefaultAssistantSnapshot,
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_ID,
  DEFAULT_ASSISTANT_NAME,
} from "@/runtime/chat/types";
import {
  BACKUP_ENTITY_LIMITS,
  backupManifestSchema,
  BackupValidationError,
  exportBackupArchive,
  importPreparedBackup,
  MAX_BACKUP_MANIFEST_BYTES,
  MAX_BACKUP_JSON_DEPTH,
  prepareBackupImport,
  type BackupManifest,
} from "@/storage/backup";
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

describe("backup archive", () => {
  it("exports no credentials and restores every non-sensitive relation", async () => {
    const source = await createDatabase("backup-source");
    await seedDatabase(source);

    const archive = await exportBackupArchive(source, () => timestamp);
    const files = unzipSync(await readBlobBytes(archive));
    const archiveText = Object.values(files)
      .map((bytes) => strFromU8(bytes))
      .join("\n");
    expect(archiveText).not.toContain("secret-api-key");
    expect(archiveText).not.toContain("secret-access-code");
    expect(archiveText).not.toContain("credential-digest");
    const manifest = backupManifestSchema.parse(
      JSON.parse(strFromU8(files["backup.json"] ?? new Uint8Array())),
    );
    expect(Object.keys(manifest)).not.toContain("credentials");
    expect(Object.keys(manifest)).not.toContain("connections");
    expect(manifest.conversations[0]?.activeModelId).toBe("o3-mini");
    const legacyManifest = {
      ...manifest,
      messages: manifest.messages.map((message) => {
        const legacyMessage: Partial<typeof message> = { ...message };
        delete legacyMessage.error;
        return legacyMessage;
      }),
    };
    expect(
      backupManifestSchema
        .parse(legacyManifest)
        .messages.every(({ error }) => error === null),
    ).toBe(true);
    expect(
      backupManifestSchema.parse({
        ...manifest,
        modelOverrides: manifest.modelOverrides.map((record) => ({
          ...record,
          capabilityVersion: 1 as const,
        })),
      }).modelOverrides[0]?.capabilityVersion,
    ).toBe(1);

    const prepared = await prepareBackupImport(archive);
    const target = await createDatabase("backup-target");
    let id = 0;
    const summary = await importPreparedBackup(
      target,
      prepared,
      () => `import-${(id += 1)}`,
    );

    expect(summary).toEqual({
      conversations: 1,
      messages: 2,
      attachments: 1,
      attachmentBytes: 24,
    });
    expect(await target.conversations.count()).toBe(1);
    expect(await target.assistants.count()).toBe(2);
    expect(await target.messages.count()).toBe(2);
    expect(await target.attachments.count()).toBe(1);
    expect(await target.messageAttachments.count()).toBe(1);
    expect(await target.branchSelections.count()).toBe(2);
    expect(await target.settings.get("theme")).toMatchObject({ value: "dark" });
    expect(await target.modelOverrides.count()).toBe(1);
    await expect(
      target.modelOverrides.get([
        "byok:https://api.example.test",
        "gpt-4.1-mini",
      ]),
    ).resolves.toMatchObject({
      capabilityVersion: 2,
      preferences: {
        streaming: false,
        temperature: { enabled: true, value: 0.6 },
      },
    });
    expect(await target.credentials.count()).toBe(0);
    expect(await target.connections.count()).toBe(0);

    const restoredConversation = await target.conversations
      .toCollection()
      .first();
    const restoredMessages = await target.messages.toArray();
    expect(restoredConversation?.id).toMatch(/^import-/u);
    expect(restoredConversation).toMatchObject({
      activeModelId: "o3-mini",
      assistantSnapshot: {
        name: "Code helper",
        icon: "code",
        systemPrompt: "Keep concise",
      },
    });
    expect(restoredConversation?.assistantId).toMatch(/^import-/u);
    expect(
      restoredMessages.every(({ id: messageId }) =>
        messageId.startsWith("import-"),
      ),
    ).toBe(true);
    expect(
      restoredMessages
        .filter(({ parentId }) => parentId)
        .every(({ parentId }) =>
          restoredMessages.some(({ id: messageId }) => messageId === parentId),
        ),
    ).toBe(true);
    expect(
      restoredMessages.find(({ role }) => role === "assistant")?.error,
    ).toEqual({ code: "RATE_LIMITED", status: 429, retryable: true });
    expect(
      restoredMessages
        .find(({ role }) => role === "assistant")
        ?.parts.find(({ type }) => type === "provider_context"),
    ).toEqual({
      type: "provider_context",
      provider: "openai-responses",
      contextType: "reasoning",
      step: 0,
      itemId: "response-reasoning-item",
      encryptedContent: "encrypted-reasoning-context",
      reasoningTokens: 2,
    });
    expect(
      restoredMessages
        .find(({ role }) => role === "assistant")
        ?.parts.find(
          (part) =>
            part.type === "provider_context" && part.provider === "gemini",
        ),
    ).toEqual({
      type: "provider_context",
      provider: "gemini",
      contextType: "thought_signature",
      step: 0,
      toolCallId: "gemini-tool-call",
      thoughtSignature: "gemini-backup-signature",
    });
    expect(
      restoredMessages
        .find(({ role }) => role === "assistant")
        ?.parts.find(
          (part) =>
            part.type === "provider_context" &&
            part.provider === "deepseek-chat",
        ),
    ).toEqual({
      type: "provider_context",
      provider: "deepseek-chat",
      contextType: "reasoning_content",
      step: 0,
      text: "deepseek backup plan",
    });
    expect(
      restoredMessages
        .find(({ role }) => role === "assistant")
        ?.parts.find(
          (part) =>
            part.type === "provider_context" && part.provider === "glm-chat",
        ),
    ).toEqual({
      type: "provider_context",
      provider: "glm-chat",
      contextType: "reasoning_content",
      step: 0,
      text: "glm backup plan",
    });
    expect(
      restoredMessages
        .find(({ role }) => role === "assistant")
        ?.parts.find(
          (part) =>
            part.type === "provider_context" && part.provider === "qwen-chat",
        ),
    ).toEqual({
      type: "provider_context",
      provider: "qwen-chat",
      contextType: "reasoning_content",
      step: 0,
      text: "qwen backup plan",
    });
    expect(
      restoredMessages
        .find(({ role }) => role === "assistant")
        ?.parts.find(
          (part) =>
            part.type === "provider_context" && part.provider === "kimi-chat",
        ),
    ).toEqual({
      type: "provider_context",
      provider: "kimi-chat",
      contextType: "reasoning_content",
      step: 0,
      text: "kimi backup plan",
    });
    expect(
      restoredMessages
        .find(({ role }) => role === "assistant")
        ?.parts.find(
          (part) =>
            part.type === "provider_context" && part.provider === "anthropic",
        ),
    ).toEqual({
      type: "provider_context",
      provider: "anthropic",
      contextType: "thinking",
      step: 0,
      blockIndex: 0,
      text: "anthropic private plan",
      signature: "anthropic-backup-signature",
    });
  });

  it("round-trips ordered image-generation references with remapped links", async () => {
    const source = await createDatabase("backup-image-generation-source");
    await seedDatabase(source);

    const firstAttachment = await source.attachments.get("attachment-1");
    if (!firstAttachment) throw new Error("Image fixture is missing");
    await source.attachments.add({
      ...firstAttachment,
      id: "attachment-2",
    });
    const assistant = await source.messages.get("assistant-1");
    if (!assistant) throw new Error("Assistant fixture is missing");
    await source.messages.put({
      ...assistant,
      parts: [
        ...assistant.parts,
        {
          type: "image_generation",
          profileId: "profile-gpt-image-2",
          profileName: "GPT Image 2",
          modelId: "gpt-image-2",
          connectionScope: "byok:https://api.example.test",
          resolutionTier: "4K",
          aspectRatio: "9:16",
          size: "2160x3840",
          quality: "high",
          outputFormat: "webp",
          outputCompression: 80,
          referenceAttachmentIds: ["attachment-1", "attachment-2"],
        },
      ],
    });
    await source.messageAttachments.bulkAdd([
      {
        messageId: "assistant-1",
        attachmentId: "attachment-1",
        conversationId: "conversation-1",
      },
      {
        messageId: "assistant-1",
        attachmentId: "attachment-2",
        conversationId: "conversation-1",
      },
    ]);

    const archive = await exportBackupArchive(source, () => timestamp);
    const prepared = await prepareBackupImport(archive);
    const target = await createDatabase("backup-image-generation-target");
    let id = 0;
    await importPreparedBackup(target, prepared, () => `image-import-${++id}`);

    const importedAssistant = (await target.messages.toArray()).find(
      ({ role }) => role === "assistant",
    );
    const generation = importedAssistant?.parts.find(
      (part) => part.type === "image_generation",
    );
    expect(generation).toMatchObject({
      type: "image_generation",
      profileId: "profile-gpt-image-2",
      profileName: "GPT Image 2",
      modelId: "gpt-image-2",
      resolutionTier: "4K",
      aspectRatio: "9:16",
      size: "2160x3840",
      quality: "high",
      outputFormat: "webp",
      outputCompression: 80,
      referenceAttachmentIds: ["image-import-5", "image-import-6"],
    });

    const importedLinks = (await target.messageAttachments.toArray()).filter(
      ({ messageId }) => messageId === importedAssistant?.id,
    );
    expect(
      importedLinks
        .map(({ attachmentId }) => attachmentId)
        .filter((attachmentId) =>
          ["image-import-5", "image-import-6"].includes(attachmentId),
        ),
    ).toEqual(["image-import-5", "image-import-6"]);
    expect(
      await target.attachments.bulkGet(["image-import-5", "image-import-6"]),
    ).toEqual([
      expect.objectContaining({ id: "image-import-5" }),
      expect.objectContaining({ id: "image-import-6" }),
    ]);
  });

  it("accepts legacy v2 conversation settings without exporting them again", async () => {
    const source = await createDatabase("backup-legacy-settings-source");
    await seedDatabase(source);
    const archive = await exportBackupArchive(source, () => timestamp);
    const exportedFiles = unzipSync(await readBlobBytes(archive));
    const exportedManifestText = strFromU8(
      exportedFiles["backup.json"] ?? new Uint8Array(),
    );
    expect(exportedManifestText).not.toContain('"contextMessageLimit"');
    expect(exportedManifestText).not.toContain('"advancedSettings"');

    const legacyArchive = await rewriteRawManifest(archive, (manifest) => {
      const conversations = manifest.conversations;
      const conversation = Array.isArray(conversations)
        ? conversations[0]
        : null;
      if (conversation === null || typeof conversation !== "object") {
        throw new Error("Fixture conversation is missing");
      }
      const legacyConversation = conversation as Record<string, unknown>;
      legacyConversation.contextMessageLimit = 5;
      legacyConversation.advancedSettings = {
        temperature: { enabled: false, value: 1 },
        topP: { enabled: false, value: 1 },
        maxTokens: { enabled: true, value: 2048 },
        customParameters: { legacy: true },
      };
    });
    const prepared = await prepareBackupImport(legacyArchive);
    const preparedConversation = prepared.manifest.conversations[0];
    expect(preparedConversation).not.toHaveProperty("contextMessageLimit");
    expect(preparedConversation).not.toHaveProperty("advancedSettings");

    const target = await createDatabase("backup-legacy-settings-target");
    let id = 0;
    await importPreparedBackup(target, prepared, () => `legacy-${++id}`);
    const restoredConversation = await target.conversations
      .toCollection()
      .first();
    expect(restoredConversation).not.toHaveProperty("contextMessageLimit");
    expect(restoredConversation).not.toHaveProperty("advancedSettings");
  });

  it("rejects path traversal before extracting files", async () => {
    const archive = bytesToBlob(
      zipSync({ "../backup.json": strToU8("{}") }),
      "application/zip",
    );
    await expect(prepareBackupImport(archive)).rejects.toThrow(
      /Unsafe backup path/u,
    );
  });

  it("restores a conversation whose source Assistant was deleted", async () => {
    const source = await createDatabase("backup-deleted-assistant-source");
    await seedDatabase(source);
    await source.assistants.delete("assistant-code");
    const prepared = await prepareBackupImport(
      await exportBackupArchive(source, () => timestamp),
    );
    const target = await createDatabase("backup-deleted-assistant-target");
    let id = 0;

    await importPreparedBackup(target, prepared, () => `orphan-${++id}`);

    const restored = await target.conversations.toCollection().first();
    expect(await target.assistants.count()).toBe(1);
    expect(restored).toMatchObject({
      assistantId: expect.stringMatching(/^orphan-/u),
      assistantSnapshot: {
        name: "Code helper",
        icon: "code",
        systemPrompt: "Keep concise",
      },
    });
    expect(
      await target.assistants.get(restored?.assistantId ?? ""),
    ).toBeUndefined();
  });

  it("rejects incompatible versions and oversized entries", async () => {
    const source = await createDatabase("backup-version-source");
    await seedDatabase(source);
    const files = unzipSync(
      await readBlobBytes(await exportBackupArchive(source, () => timestamp)),
    );
    const manifestText = strFromU8(files["backup.json"] ?? new Uint8Array());
    files["backup.json"] = strToU8(
      manifestText.replace('"version":2', '"version":999'),
    );
    await expect(
      prepareBackupImport(bytesToBlob(zipSync(files), "application/zip")),
    ).rejects.toThrow(/version/u);

    const oversized = bytesToBlob(
      zipSync({
        "backup.json": new Uint8Array(MAX_BACKUP_MANIFEST_BYTES + 1),
      }),
      "application/zip",
    );
    await expect(prepareBackupImport(oversized)).rejects.toThrow(
      /file is too large/u,
    );
  });

  it("rejects export when stored image metadata disagrees with the file header", async () => {
    const source = await createDatabase("backup-export-metadata-source");
    await seedDatabase(source);
    const attachment = await source.attachments.toCollection().first();
    if (!attachment) throw new Error("Fixture attachment is missing");
    await source.attachments.put({
      ...attachment,
      blob: createIndexedDbFixtureBlob(
        await readBlobBytes(attachment.blob),
        attachment.mimeType,
      ),
      width: 2,
    });

    await expect(exportBackupArchive(source, () => timestamp)).rejects.toThrow(
      /dimensions are invalid/u,
    );
  });

  it("rejects excessive entity counts and JSON depth before recursive validation", async () => {
    const source = await createDatabase("backup-bounds-source");
    await seedDatabase(source);
    const archive = await exportBackupArchive(source, () => timestamp);

    const tooManyAssistants = await rewriteRawManifest(archive, (manifest) => {
      const assistants = manifest.assistants;
      if (!Array.isArray(assistants) || !assistants[0]) {
        throw new Error("Fixture Assistants are missing");
      }
      manifest.assistants = Array.from(
        { length: BACKUP_ENTITY_LIMITS.assistants + 1 },
        () => structuredClone(assistants[0]),
      );
    });
    await expect(prepareBackupImport(tooManyAssistants)).rejects.toThrow(
      /too many assistants/u,
    );

    const deeplyNested = await rewriteRawManifest(archive, (manifest) => {
      const settings = manifest.settings;
      const setting = Array.isArray(settings) ? settings[0] : null;
      if (setting === null || typeof setting !== "object") {
        throw new Error("Fixture settings are missing");
      }
      let value: unknown = "leaf";
      for (let depth = 0; depth < MAX_BACKUP_JSON_DEPTH; depth += 1) {
        value = [value];
      }
      (setting as Record<string, unknown>).value = value;
    });
    await expect(prepareBackupImport(deeplyNested)).rejects.toThrow(
      /nested too deeply/u,
    );
  });

  it("accepts a long linear message chain with one bounded traversal", async () => {
    const source = await createDatabase("backup-linear-chain-source");
    await seedDatabase(source);
    const archive = await exportBackupArchive(source, () => timestamp);
    const messageCount = 2_000;
    const longChain = await rewriteRawManifest(archive, (manifest) => {
      const messages = manifest.messages;
      const conversations = manifest.conversations;
      const message = Array.isArray(messages) ? messages[0] : null;
      const conversation = Array.isArray(conversations)
        ? conversations[0]
        : null;
      if (
        message === null ||
        typeof message !== "object" ||
        conversation === null ||
        typeof conversation !== "object"
      ) {
        throw new Error("Fixture conversation is incomplete");
      }
      manifest.messages = Array.from({ length: messageCount }, (_, index) => ({
        ...structuredClone(message),
        id: `message-${index}`,
        parentId: index === 0 ? null : `message-${index - 1}`,
        parts: [{ type: "text", text: `Message ${index}` }],
      }));
      (conversation as Record<string, unknown>).activeLeafId =
        `message-${messageCount - 1}`;
      manifest.branchSelections = [];
      manifest.messageAttachments = [];
    });

    const prepared = await prepareBackupImport(longChain);
    expect(prepared.manifest.messages).toHaveLength(messageCount);
  });

  it("rejects cycles and attachment metadata tampering", async () => {
    const source = await createDatabase("backup-invalid-source");
    await seedDatabase(source);
    const archive = await exportBackupArchive(source, () => timestamp);

    const cyclic = await rewriteManifest(archive, (manifest) => {
      const [user, assistant] = manifest.messages;
      if (!user || !assistant) throw new Error("Fixture messages are missing");
      user.parentId = assistant.id;
      assistant.parentId = user.id;
    });
    await expect(prepareBackupImport(cyclic)).rejects.toThrow(
      /cycle detected/u,
    );

    const badHash = await rewriteManifest(archive, (manifest) => {
      const attachment = manifest.attachments[0];
      if (!attachment) throw new Error("Fixture attachment is missing");
      attachment.sha256 = "0".repeat(64);
    });
    await expect(prepareBackupImport(badHash)).rejects.toThrow(
      /hash is invalid/u,
    );

    const badDimensions = await rewriteManifest(archive, (manifest) => {
      const attachment = manifest.attachments[0];
      if (!attachment) throw new Error("Fixture attachment is missing");
      attachment.width = 2;
    });
    await expect(prepareBackupImport(badDimensions)).rejects.toThrow(
      /dimensions are invalid/u,
    );

    const badMime = await rewriteManifest(archive, (manifest) => {
      const attachment = manifest.attachments[0];
      if (!attachment) throw new Error("Fixture attachment is missing");
      attachment.mimeType = "image/jpeg";
    });
    await expect(prepareBackupImport(badMime)).rejects.toThrow(
      /MIME is invalid/u,
    );
  });

  it("does not mutate existing data when remapping fails", async () => {
    const source = await createDatabase("backup-remap-source");
    await seedDatabase(source);
    const prepared = await prepareBackupImport(
      await exportBackupArchive(source, () => timestamp),
    );
    const target = await createDatabase("backup-remap-target");
    await target.conversations.add({
      id: "existing",
      title: "Existing",
      titleSource: "user",
      archived: false,
      activeLeafId: null,
      activeModelId: null,
      contextCutoffId: null,
      assistantId: DEFAULT_ASSISTANT_ID,
      assistantSnapshot: createDefaultAssistantSnapshot(),
      autoTitle: false,
      webSearchEnabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await expect(
      importPreparedBackup(target, prepared, () => "duplicate"),
    ).rejects.toThrow(BackupValidationError);
    expect(await target.conversations.toArray()).toHaveLength(1);
    expect(await target.conversations.get("existing")).toBeDefined();
    expect(await target.messages.count()).toBe(0);
  });
});

async function createDatabase(prefix: string): Promise<ChatDatabase> {
  const database = new ChatDatabase(`${prefix}-${crypto.randomUUID()}`);
  databases.push(database);
  await database.open();
  return database;
}

async function seedDatabase(database: ChatDatabase): Promise<void> {
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]);
  const sha256 = await sha256Bytes(pngBytes);
  await database.assistants.bulkAdd([
    {
      id: DEFAULT_ASSISTANT_ID,
      kind: "default",
      name: DEFAULT_ASSISTANT_NAME,
      icon: DEFAULT_ASSISTANT_ICON,
      systemPrompt: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "assistant-code",
      kind: "custom",
      name: "Code helper",
      icon: "code",
      systemPrompt: "Keep concise",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
  await database.conversations.add({
    id: "conversation-1",
    title: "Backup fixture",
    titleSource: "ai",
    archived: false,
    activeLeafId: "assistant-1",
    activeModelId: "o3-mini",
    contextCutoffId: null,
    assistantId: "assistant-code",
    assistantSnapshot: {
      name: "Code helper",
      icon: "code",
      systemPrompt: "Keep concise",
    },
    autoTitle: true,
    webSearchEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await database.messages.bulkAdd([
    {
      id: "user-1",
      conversationId: "conversation-1",
      parentId: null,
      role: "user",
      parts: [
        { type: "text", text: "Describe this" },
        { type: "image_ref", attachmentId: "attachment-1", alt: null },
      ],
      status: "completed",
      modelSnapshot: null,
      usage: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "assistant-1",
      conversationId: "conversation-1",
      parentId: "user-1",
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "Private reasoning",
          source: "reasoning_content",
          durationMs: 500,
        },
        {
          type: "provider_context",
          provider: "openai-responses",
          contextType: "reasoning",
          step: 0,
          itemId: "response-reasoning-item",
          encryptedContent: "encrypted-reasoning-context",
          reasoningTokens: 2,
        },
        {
          type: "provider_context",
          provider: "gemini",
          contextType: "thought_signature",
          step: 0,
          toolCallId: "gemini-tool-call",
          thoughtSignature: "gemini-backup-signature",
        },
        {
          type: "provider_context",
          provider: "deepseek-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "deepseek backup plan",
        },
        {
          type: "provider_context",
          provider: "glm-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "glm backup plan",
        },
        {
          type: "provider_context",
          provider: "qwen-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "qwen backup plan",
        },
        {
          type: "provider_context",
          provider: "kimi-chat",
          contextType: "reasoning_content",
          step: 0,
          text: "kimi backup plan",
        },
        {
          type: "tool_call",
          id: "deepseek-tool-call",
          name: "web_search",
          step: 0,
          input: { query: "backup" },
          output: [],
          status: "completed",
          errorCode: null,
          errorStatus: null,
          retryable: false,
        },
        {
          type: "provider_context",
          provider: "anthropic",
          contextType: "thinking",
          step: 0,
          blockIndex: 0,
          text: "anthropic private plan",
          signature: "anthropic-backup-signature",
        },
        { type: "text", text: "It is a test image." },
      ],
      status: "error",
      modelSnapshot: {
        modelId: "gpt-4.1-mini",
        connectionScope: "byok:https://api.example.test",
      },
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        reasoningTokens: 2,
        totalTokens: 15,
        estimated: false,
      },
      error: { code: "RATE_LIMITED", status: 429, retryable: true },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
  await database.branchSelections.bulkAdd([
    {
      conversationId: "conversation-1",
      parentKey: "$root",
      selectedChildId: "user-1",
    },
    {
      conversationId: "conversation-1",
      parentKey: "user-1",
      selectedChildId: "assistant-1",
    },
  ]);
  await database.attachments.add({
    id: "attachment-1",
    blob: createIndexedDbFixtureBlob(pngBytes, "image/png"),
    mimeType: "image/png",
    width: 1,
    height: 1,
    byteSize: pngBytes.byteLength,
    sha256,
    createdAt: timestamp,
  });
  await database.messageAttachments.add({
    messageId: "user-1",
    attachmentId: "attachment-1",
    conversationId: "conversation-1",
  });
  await database.settings.add({
    key: "theme",
    value: "dark",
    updatedAt: timestamp,
  });
  await database.modelOverrides.add({
    connectionScope: "byok:https://api.example.test",
    modelId: "gpt-4.1-mini",
    override: { vision: true },
    capabilityVersion: 2,
    preferences: {
      streaming: false,
      temperature: { enabled: true, value: 0.6 },
      topP: { enabled: false, value: 1 },
    },
    updatedAt: timestamp,
  });
  await database.connections.add({
    id: "current",
    mode: "byok",
    baseUrl: "https://api.example.test",
    modelId: "gpt-4.1-mini",
    apiType: "openai",
    updatedAt: timestamp,
  });
  await database.credentials.add({
    id: "current",
    apiKey: "secret-api-key",
    accessCode: "secret-access-code",
    encrypted: false,
    updatedAt: timestamp,
  });
  await database.meta.add({
    key: "credential-digest",
    value: "credential-digest",
    updatedAt: timestamp,
  });
}

async function rewriteManifest(
  archive: Blob,
  mutate: (manifest: BackupManifest) => void,
): Promise<Blob> {
  const files = unzipSync(await readBlobBytes(archive));
  const manifest = backupManifestSchema.parse(
    JSON.parse(strFromU8(files["backup.json"] ?? new Uint8Array())),
  );
  mutate(manifest);
  files["backup.json"] = strToU8(JSON.stringify(manifest));
  return bytesToBlob(zipSync(files), "application/zip");
}

async function rewriteRawManifest(
  archive: Blob,
  mutate: (manifest: Record<string, unknown>) => void,
): Promise<Blob> {
  const files = unzipSync(await readBlobBytes(archive));
  const value: unknown = JSON.parse(
    strFromU8(files["backup.json"] ?? new Uint8Array()),
  );
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Fixture manifest is invalid");
  }
  mutate(value as Record<string, unknown>);
  files["backup.json"] = strToU8(JSON.stringify(value));
  return bytesToBlob(zipSync(files), "application/zip");
}

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type });
}

function createIndexedDbFixtureBlob(bytes: Uint8Array, type: string): Blob {
  // fake-indexeddb 使用 Node structured clone；Node Blob 与 DOM Blob 仅类型泛型不同。
  return new NodeBlob([bytes], { type }) as unknown as Blob;
}
