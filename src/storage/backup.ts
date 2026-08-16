import { strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";

import {
  bytesToBlob,
  readBlobBytes,
  sha256Bytes,
} from "@/runtime/attachments/blob-utils";
import {
  inspectImageMetadata,
  type ImageMetadata,
} from "@/runtime/attachments/image-metadata";
import {
  assistantSchema,
  conversationSchema,
  jsonValueSchema,
  messageNodeSchema,
  modelCapabilityOverrideSchema,
  modelPreferencesSchema,
} from "@/runtime/chat/schemas";
import { ROOT_PARENT_KEY } from "@/runtime/chat/message-tree";
import type {
  AssistantRecord,
  AttachmentRecord,
  BranchSelectionRecord,
  ConversationRecord,
  MessageAttachmentRecord,
  MessageNode,
  ModelOverrideRecord,
} from "@/runtime/chat/types";
import { attachmentIdsFromParts } from "@/runtime/chat/message-attachments";
import { DEFAULT_ASSISTANT_ID } from "@/runtime/chat/types";
import { parseModelCapabilityOverride } from "@/runtime/models/model-capabilities";
import type { ChatDatabase, KeyValueRecord } from "@/storage/database";

export const BACKUP_FORMAT = "cherrychat-backup";
export const BACKUP_VERSION = 2;
export const MAX_BACKUP_COMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_EXPANDED_BYTES = 128 * 1024 * 1024;
export const MAX_BACKUP_FILES = 1_024;
export const MAX_BACKUP_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_BACKUP_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_JSON_DEPTH = 32;
export const BACKUP_ENTITY_LIMITS = {
  assistants: 256,
  conversations: 2_000,
  messages: 50_000,
  branchSelections: 50_000,
  attachments: 1_000,
  messageAttachments: 3_000,
  settings: 512,
  modelOverrides: 5_000,
} as const;

const safeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const isoDateSchema = z.string().datetime({ offset: true });
const branchSelectionSchema = z
  .object({
    conversationId: safeIdSchema,
    parentKey: z.union([z.literal(ROOT_PARENT_KEY), safeIdSchema]),
    selectedChildId: safeIdSchema,
  })
  .strict();
const messageAttachmentSchema = z
  .object({
    messageId: safeIdSchema,
    attachmentId: safeIdSchema,
    conversationId: safeIdSchema,
  })
  .strict();
const attachmentManifestSchema = z
  .object({
    id: safeIdSchema,
    path: z
      .string()
      .regex(/^attachments\/[A-Za-z0-9_-]{1,128}\.(png|jpe?g|webp)$/u),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000),
    byteSize: z.number().int().nonnegative().max(MAX_BACKUP_ATTACHMENT_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: isoDateSchema,
  })
  .strict();
const keyValueSchema = z
  .object({
    key: z.string().min(1).max(256),
    value: jsonValueSchema,
    updatedAt: isoDateSchema,
  })
  .strict();
const modelOverrideSchema = z
  .object({
    connectionScope: z.string().min(1).max(2_048),
    modelId: z.string().min(1).max(512),
    override: modelCapabilityOverrideSchema,
    capabilityVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    preferences: modelPreferencesSchema.optional(),
    updatedAt: isoDateSchema,
  })
  .strict();
const backupAssistantSchema = assistantSchema.extend({ id: safeIdSchema });

export const backupManifestSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    exportedAt: isoDateSchema,
    assistants: z
      .array(backupAssistantSchema)
      .max(BACKUP_ENTITY_LIMITS.assistants),
    conversations: z
      .array(conversationSchema)
      .max(BACKUP_ENTITY_LIMITS.conversations),
    messages: z.array(messageNodeSchema).max(BACKUP_ENTITY_LIMITS.messages),
    branchSelections: z
      .array(branchSelectionSchema)
      .max(BACKUP_ENTITY_LIMITS.branchSelections),
    attachments: z
      .array(attachmentManifestSchema)
      .max(BACKUP_ENTITY_LIMITS.attachments),
    messageAttachments: z
      .array(messageAttachmentSchema)
      .max(BACKUP_ENTITY_LIMITS.messageAttachments),
    settings: z.array(keyValueSchema).max(BACKUP_ENTITY_LIMITS.settings),
    modelOverrides: z
      .array(modelOverrideSchema)
      .max(BACKUP_ENTITY_LIMITS.modelOverrides),
  })
  .strict();

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export interface PreparedBackup {
  manifest: BackupManifest;
  attachmentBytes: ReadonlyMap<string, Uint8Array>;
}

export interface BackupSummary {
  conversations: number;
  messages: number;
  attachments: number;
  attachmentBytes: number;
}

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

export async function exportBackupArchive(
  database: ChatDatabase,
  now: () => string = () => new Date().toISOString(),
): Promise<Blob> {
  const [
    assistants,
    conversations,
    messages,
    branchSelections,
    attachments,
    messageAttachments,
    settings,
    modelOverrides,
  ] = await Promise.all([
    database.assistants.toArray(),
    database.conversations.toArray(),
    database.messages.toArray(),
    database.branchSelections.toArray(),
    database.attachments.toArray(),
    database.messageAttachments.toArray(),
    database.settings.toArray(),
    database.modelOverrides.toArray(),
  ]);

  const archiveFiles: Record<string, Uint8Array> = {};
  const attachmentEntries: BackupManifest["attachments"] = [];
  for (const attachment of attachments) {
    const extension = extensionForMime(attachment.mimeType);
    const path = `attachments/${attachment.id}.${extension}`;
    const bytes = await readBlobBytes(attachment.blob);
    if (bytes.byteLength !== attachment.byteSize) {
      throw new BackupValidationError(
        `Attachment size does not match metadata: ${attachment.id}`,
      );
    }
    await assertAttachmentImageMetadata(
      attachment.blob,
      attachment.id,
      normalizeAttachmentMime(attachment.mimeType),
      attachment.width,
      attachment.height,
    );
    archiveFiles[path] = bytes;
    attachmentEntries.push({
      id: attachment.id,
      path,
      mimeType: normalizeAttachmentMime(attachment.mimeType),
      width: attachment.width,
      height: attachment.height,
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
      createdAt: attachment.createdAt,
    });
  }

  const manifest = backupManifestSchema.parse({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now(),
    assistants,
    conversations,
    messages,
    branchSelections,
    attachments: attachmentEntries,
    messageAttachments,
    settings,
    modelOverrides,
  });
  assertManifestIntegrity(manifest);
  const manifestBytes = strToU8(JSON.stringify(manifest));
  if (manifestBytes.byteLength > MAX_BACKUP_MANIFEST_BYTES) {
    throw new BackupValidationError("Backup manifest is too large");
  }
  const expandedBytes = attachmentEntries.reduce(
    (total, attachment) => total + attachment.byteSize,
    manifestBytes.byteLength,
  );
  if (expandedBytes > MAX_BACKUP_EXPANDED_BYTES) {
    throw new BackupValidationError("Backup expands beyond the size limit");
  }
  archiveFiles["backup.json"] = manifestBytes;
  const compressed = zipSync(archiveFiles, { level: 6 });
  if (compressed.byteLength > MAX_BACKUP_COMPRESSED_BYTES) {
    throw new BackupValidationError("Backup archive is too large");
  }
  return bytesToBlob(compressed, "application/zip");
}

export async function prepareBackupImport(
  input: Blob | Uint8Array,
): Promise<PreparedBackup> {
  const compressed = input instanceof Blob ? await readBlobBytes(input) : input;
  if (compressed.byteLength > MAX_BACKUP_COMPRESSED_BYTES) {
    throw new BackupValidationError("Backup archive is too large");
  }

  let fileCount = 0;
  let expandedBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(compressed, {
      filter: (file) => {
        fileCount += 1;
        expandedBytes += file.originalSize;
        assertSafeArchivePath(file.name);
        if (fileCount > MAX_BACKUP_FILES) {
          throw new BackupValidationError("Backup contains too many files");
        }
        if (expandedBytes > MAX_BACKUP_EXPANDED_BYTES) {
          throw new BackupValidationError(
            "Backup expands beyond the size limit",
          );
        }
        const perFileLimit =
          file.name === "backup.json"
            ? MAX_BACKUP_MANIFEST_BYTES
            : MAX_BACKUP_ATTACHMENT_BYTES;
        if (file.originalSize > perFileLimit) {
          throw new BackupValidationError(
            `Backup file is too large: ${file.name}`,
          );
        }
        return true;
      },
    });
  } catch (cause) {
    if (cause instanceof BackupValidationError) throw cause;
    throw new BackupValidationError(
      cause instanceof Error ? cause.message : "Unable to read backup archive",
    );
  }

  const manifestBytes = files["backup.json"];
  if (!manifestBytes) throw new BackupValidationError("backup.json is missing");
  let manifest: BackupManifest;
  try {
    const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(
      manifestBytes,
    );
    assertJsonTextDepth(manifestText, MAX_BACKUP_JSON_DEPTH);
    const value: unknown = JSON.parse(manifestText);
    assertManifestCollectionLimits(value);
    manifest = backupManifestSchema.parse(value);
  } catch (cause) {
    if (cause instanceof BackupValidationError) throw cause;
    throw new BackupValidationError(
      cause instanceof Error ? cause.message : "backup.json is invalid",
    );
  }
  assertManifestIntegrity(manifest);

  const expectedFiles = new Set([
    "backup.json",
    ...manifest.attachments.map(({ path }) => path),
  ]);
  for (const name of Object.keys(files)) {
    if (!expectedFiles.has(name)) {
      throw new BackupValidationError(`Unexpected file in backup: ${name}`);
    }
  }
  const attachmentBytes = new Map<string, Uint8Array>();
  for (const attachment of manifest.attachments) {
    const bytes = files[attachment.path];
    if (!bytes) {
      throw new BackupValidationError(
        `Attachment file is missing: ${attachment.path}`,
      );
    }
    if (bytes.byteLength !== attachment.byteSize) {
      throw new BackupValidationError(
        `Attachment size is invalid: ${attachment.id}`,
      );
    }
    if ((await sha256Bytes(bytes)) !== attachment.sha256) {
      throw new BackupValidationError(
        `Attachment hash is invalid: ${attachment.id}`,
      );
    }
    await assertAttachmentImageMetadata(
      bytesToBlob(bytes, attachment.mimeType),
      attachment.id,
      attachment.mimeType,
      attachment.width,
      attachment.height,
    );
    attachmentBytes.set(attachment.id, bytes);
  }
  return { manifest, attachmentBytes };
}

export function summarizeBackup(prepared: PreparedBackup): BackupSummary {
  return {
    conversations: prepared.manifest.conversations.length,
    messages: prepared.manifest.messages.length,
    attachments: prepared.manifest.attachments.length,
    attachmentBytes: prepared.manifest.attachments.reduce(
      (total, attachment) => total + attachment.byteSize,
      0,
    ),
  };
}

export async function importPreparedBackup(
  database: ChatDatabase,
  prepared: PreparedBackup,
  createId: () => string = () => crypto.randomUUID(),
): Promise<BackupSummary> {
  assertManifestIntegrity(prepared.manifest);
  const assistantSourceIds = Array.from(
    new Set([
      ...prepared.manifest.assistants.map(({ id }) => id),
      ...prepared.manifest.conversations.map(({ assistantId }) => assistantId),
    ]),
  ).filter((id) => id !== DEFAULT_ASSISTANT_ID);
  const assistantIds = remapIds(assistantSourceIds, createId);
  const conversationIds = remapIds(
    prepared.manifest.conversations.map(({ id }) => id),
    createId,
  );
  const messageIds = remapIds(
    prepared.manifest.messages.map(({ id }) => id),
    createId,
  );
  const attachmentIds = remapIds(
    prepared.manifest.attachments.map(({ id }) => id),
    createId,
  );

  const assistants: AssistantRecord[] = prepared.manifest.assistants
    .filter(({ id }) => id !== DEFAULT_ASSISTANT_ID)
    .map((assistant) =>
      assistantSchema.parse({
        ...structuredClone(assistant),
        id: requireRemapped(assistantIds, assistant.id),
      }),
    );
  const importedDefaultAssistant = assistantSchema.parse(
    prepared.manifest.assistants.find(({ id }) => id === DEFAULT_ASSISTANT_ID),
  );
  const conversations: ConversationRecord[] =
    prepared.manifest.conversations.map((conversation) => ({
      ...structuredClone(conversation),
      id: requireRemapped(conversationIds, conversation.id),
      assistantId:
        conversation.assistantId === DEFAULT_ASSISTANT_ID
          ? DEFAULT_ASSISTANT_ID
          : requireRemapped(assistantIds, conversation.assistantId),
      activeLeafId: remapNullable(messageIds, conversation.activeLeafId),
      contextCutoffId: remapNullable(messageIds, conversation.contextCutoffId),
    }));
  const messages: MessageNode[] = prepared.manifest.messages.map((message) => ({
    ...structuredClone(message),
    id: requireRemapped(messageIds, message.id),
    conversationId: requireRemapped(conversationIds, message.conversationId),
    parentId: remapNullable(messageIds, message.parentId),
    parts: message.parts.map((part) => {
      if (part.type === "image_ref") {
        return {
          ...part,
          attachmentId: requireRemapped(attachmentIds, part.attachmentId),
        };
      }
      if (part.type === "image_generation") {
        return {
          ...part,
          referenceAttachmentIds: part.referenceAttachmentIds.map((id) =>
            requireRemapped(attachmentIds, id),
          ),
        };
      }
      return structuredClone(part);
    }),
  }));
  const branchSelections: BranchSelectionRecord[] =
    prepared.manifest.branchSelections.map((selection) => ({
      conversationId: requireRemapped(
        conversationIds,
        selection.conversationId,
      ),
      parentKey:
        selection.parentKey === ROOT_PARENT_KEY
          ? ROOT_PARENT_KEY
          : requireRemapped(messageIds, selection.parentKey),
      selectedChildId: requireRemapped(messageIds, selection.selectedChildId),
    }));
  const attachments: AttachmentRecord[] = prepared.manifest.attachments.map(
    (attachment) => ({
      id: requireRemapped(attachmentIds, attachment.id),
      blob: bytesToBlob(
        requireAttachmentBytes(prepared.attachmentBytes, attachment.id),
        attachment.mimeType,
      ),
      mimeType: attachment.mimeType,
      width: attachment.width,
      height: attachment.height,
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
      createdAt: attachment.createdAt,
    }),
  );
  const messageAttachments: MessageAttachmentRecord[] =
    prepared.manifest.messageAttachments.map((link) => ({
      messageId: requireRemapped(messageIds, link.messageId),
      attachmentId: requireRemapped(attachmentIds, link.attachmentId),
      conversationId: requireRemapped(conversationIds, link.conversationId),
    }));
  const modelOverrides: ModelOverrideRecord[] =
    prepared.manifest.modelOverrides.map((record) => ({
      connectionScope: record.connectionScope,
      modelId: record.modelId,
      override: parseModelCapabilityOverride(record.override),
      ...(record.capabilityVersion
        ? { capabilityVersion: record.capabilityVersion }
        : {}),
      ...(record.preferences
        ? { preferences: modelPreferencesSchema.parse(record.preferences) }
        : {}),
      updatedAt: record.updatedAt,
    }));

  await database.transaction(
    "rw",
    [
      database.settings,
      database.assistants,
      database.conversations,
      database.messages,
      database.branchSelections,
      database.attachments,
      database.messageAttachments,
      database.modelOverrides,
    ],
    async () => {
      if (prepared.manifest.settings.length > 0) {
        const settings: KeyValueRecord[] = structuredClone(
          prepared.manifest.settings,
        );
        await database.settings.bulkPut(settings);
      }
      if (!(await database.assistants.get(DEFAULT_ASSISTANT_ID))) {
        await database.assistants.add(importedDefaultAssistant);
      }
      if (assistants.length > 0) await database.assistants.bulkAdd(assistants);
      if (conversations.length > 0)
        await database.conversations.bulkAdd(conversations);
      if (messages.length > 0) await database.messages.bulkAdd(messages);
      if (branchSelections.length > 0) {
        await database.branchSelections.bulkAdd(branchSelections);
      }
      if (attachments.length > 0)
        await database.attachments.bulkAdd(attachments);
      if (messageAttachments.length > 0) {
        await database.messageAttachments.bulkAdd(messageAttachments);
      }
      if (modelOverrides.length > 0)
        await database.modelOverrides.bulkPut(modelOverrides);
    },
  );
  return summarizeBackup(prepared);
}

function assertManifestIntegrity(manifest: BackupManifest): void {
  assertUnique(
    manifest.assistants.map(({ id }) => id),
    "assistant",
  );
  assertUnique(
    manifest.conversations.map(({ id }) => id),
    "conversation",
  );
  assertUnique(
    manifest.messages.map(({ id }) => id),
    "message",
  );
  assertUnique(
    manifest.attachments.map(({ id }) => id),
    "attachment",
  );
  assertUnique(
    manifest.attachments.map(({ path }) => path),
    "attachment path",
  );

  const conversations = new Map(
    manifest.conversations.map((item) => [item.id, item]),
  );
  const messages = new Map(manifest.messages.map((item) => [item.id, item]));
  const attachments = new Set(manifest.attachments.map(({ id }) => id));
  const links = new Set(
    manifest.messageAttachments.map(
      ({ messageId, attachmentId }) => `${messageId}\0${attachmentId}`,
    ),
  );

  const defaultAssistants = manifest.assistants.filter(
    ({ id, kind }) => id === DEFAULT_ASSISTANT_ID || kind === "default",
  );
  if (
    defaultAssistants.length !== 1 ||
    defaultAssistants[0]?.id !== DEFAULT_ASSISTANT_ID ||
    defaultAssistants[0].kind !== "default"
  ) {
    throw new BackupValidationError(
      "Backup must contain one Default Assistant",
    );
  }

  for (const conversation of manifest.conversations) {
    for (const messageId of [
      conversation.activeLeafId,
      conversation.contextCutoffId,
    ]) {
      if (
        messageId &&
        messages.get(messageId)?.conversationId !== conversation.id
      ) {
        throw new BackupValidationError(
          `Conversation references an invalid message: ${conversation.id}`,
        );
      }
    }
  }
  for (const message of manifest.messages) {
    if (!conversations.has(message.conversationId)) {
      throw new BackupValidationError(
        `Message has no conversation: ${message.id}`,
      );
    }
    if (message.parentId) {
      const parent = messages.get(message.parentId);
      if (!parent || parent.conversationId !== message.conversationId) {
        throw new BackupValidationError(
          `Message has an invalid parent: ${message.id}`,
        );
      }
    }
    for (const attachmentId of attachmentIdsFromParts(message.parts)) {
      if (!attachments.has(attachmentId)) {
        throw new BackupValidationError(
          `Message attachment is missing: ${attachmentId}`,
        );
      }
      if (!links.has(`${message.id}\0${attachmentId}`)) {
        throw new BackupValidationError(
          `Message attachment link is missing: ${message.id}`,
        );
      }
    }
  }
  assertAcyclicMessageTree(manifest.messages, messages);
  for (const link of manifest.messageAttachments) {
    const message = messages.get(link.messageId);
    if (
      !message ||
      message.conversationId !== link.conversationId ||
      !attachments.has(link.attachmentId)
    ) {
      throw new BackupValidationError(
        `Invalid message attachment link: ${link.messageId}`,
      );
    }
  }
  for (const selection of manifest.branchSelections) {
    const child = messages.get(selection.selectedChildId);
    const expectedParent =
      selection.parentKey === ROOT_PARENT_KEY ? null : selection.parentKey;
    if (
      !child ||
      child.conversationId !== selection.conversationId ||
      child.parentId !== expectedParent
    ) {
      throw new BackupValidationError(
        `Invalid branch selection: ${selection.selectedChildId}`,
      );
    }
  }
}

function assertJsonTextDepth(value: string, maximumDepth: number): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      if (depth > maximumDepth) {
        throw new BackupValidationError("Backup JSON is nested too deeply");
      }
    } else if (character === "}" || character === "]") {
      depth -= 1;
    }
  }
}

function assertManifestCollectionLimits(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [name, maximum] of Object.entries(BACKUP_ENTITY_LIMITS)) {
    const collection = record[name];
    if (Array.isArray(collection) && collection.length > maximum) {
      throw new BackupValidationError(
        `Backup contains too many ${collectionLabel(name)}`,
      );
    }
  }
}

function collectionLabel(name: string): string {
  return name.replace(/([a-z])([A-Z])/gu, "$1 $2").toLocaleLowerCase();
}

function assertAcyclicMessageTree(
  source: readonly MessageNode[],
  messages: ReadonlyMap<string, MessageNode>,
): void {
  const colors = new Map<string, 1 | 2>();
  for (const message of source) {
    if (colors.get(message.id) === 2) continue;
    const path: string[] = [];
    let current: MessageNode | undefined = message;
    while (current) {
      const color = colors.get(current.id);
      if (color === 2) break;
      if (color === 1) {
        throw new BackupValidationError(
          `Message cycle detected: ${current.id}`,
        );
      }
      colors.set(current.id, 1);
      path.push(current.id);
      current = current.parentId ? messages.get(current.parentId) : undefined;
    }
    for (const messageId of path) colors.set(messageId, 2);
  }
}

function assertSafeArchivePath(path: string): void {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new BackupValidationError(`Unsafe backup path: ${path}`);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new BackupValidationError(`Duplicate ${label} IDs detected`);
  }
}

function extensionForMime(mimeType: string): "png" | "jpg" | "webp" {
  const normalized = normalizeAttachmentMime(mimeType);
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  return "jpg";
}

function normalizeAttachmentMime(
  mimeType: string,
): "image/png" | "image/jpeg" | "image/webp" {
  if (mimeType === "image/png" || mimeType === "image/webp") return mimeType;
  if (mimeType === "image/jpeg" || mimeType === "image/jpg")
    return "image/jpeg";
  throw new BackupValidationError(`Unsupported attachment MIME: ${mimeType}`);
}

async function assertAttachmentImageMetadata(
  blob: Blob,
  id: string,
  expectedMime: "image/png" | "image/jpeg" | "image/webp",
  expectedWidth: number,
  expectedHeight: number,
): Promise<void> {
  let metadata: ImageMetadata;
  try {
    metadata = await inspectImageMetadata(blob);
  } catch {
    throw new BackupValidationError(
      `Attachment image metadata is invalid: ${id}`,
    );
  }
  if (metadata.mimeType !== expectedMime) {
    throw new BackupValidationError(`Attachment MIME is invalid: ${id}`);
  }
  if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
    throw new BackupValidationError(`Attachment dimensions are invalid: ${id}`);
  }
}

function remapIds(
  sourceIds: readonly string[],
  createId: () => string,
): ReadonlyMap<string, string> {
  const output = new Map<string, string>();
  const generated = new Set<string>();
  for (const sourceId of sourceIds) {
    const nextId = createId();
    if (!nextId || generated.has(nextId)) {
      throw new BackupValidationError(
        "ID generator returned an invalid duplicate",
      );
    }
    generated.add(nextId);
    output.set(sourceId, nextId);
  }
  return output;
}

function requireRemapped(
  mapping: ReadonlyMap<string, string>,
  id: string,
): string {
  const mapped = mapping.get(id);
  if (!mapped) throw new BackupValidationError(`Unable to remap ID: ${id}`);
  return mapped;
}

function remapNullable(
  mapping: ReadonlyMap<string, string>,
  id: string | null,
): string | null {
  return id ? requireRemapped(mapping, id) : null;
}

function requireAttachmentBytes(
  bytesById: ReadonlyMap<string, Uint8Array>,
  id: string,
): Uint8Array {
  const bytes = bytesById.get(id);
  if (!bytes)
    throw new BackupValidationError(`Attachment bytes are missing: ${id}`);
  return bytes;
}
