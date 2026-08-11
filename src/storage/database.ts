import Dexie, { type DexieOptions, type EntityTable, type Table } from "dexie";

import type {
  AssistantRecord,
  AttachmentRecord,
  BranchSelectionRecord,
  ConnectionRecord,
  ConversationRecord,
  CredentialRecord,
  JsonValue,
  MessageAttachmentRecord,
  MessageNode,
  ModelOverrideRecord,
  WebSearchCredentialRecord,
} from "@/runtime/chat/types";
import {
  createDefaultAssistantSnapshot,
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_ID,
  DEFAULT_ASSISTANT_NAME,
} from "@/runtime/chat/types";
import {
  LEGACY_WEB_SEARCH_SETTINGS_KEY,
  WEB_SEARCH_RESULT_COUNT,
  WEB_SEARCH_SETTINGS_KEY,
} from "@/runtime/tools/web-search-settings";

export const DATABASE_NAME = "cherrychat";

export interface KeyValueRecord {
  key: string;
  value: JsonValue;
  updatedAt: string;
}

export const LEGACY_CHAT_DATABASE_STORES = {
  meta: "&key, updatedAt",
  settings: "&key, updatedAt",
  connections: "&id, updatedAt",
  credentials: "&id, updatedAt",
  conversations: "&id, updatedAt",
  messages: "&id, conversationId, parentId, createdAt",
  branchSelections:
    "&[conversationId+parentKey], conversationId, parentKey, selectedChildId",
  attachments: "&id, sha256, createdAt",
  messageAttachments:
    "&[messageId+attachmentId], messageId, attachmentId, conversationId",
  modelOverrides:
    "&[connectionScope+modelId], connectionScope, modelId, updatedAt",
} as const;

export const CHAT_DATABASE_STORES = {
  ...LEGACY_CHAT_DATABASE_STORES,
  assistants: "&id, kind, updatedAt",
  webSearchCredentials: "&id, updatedAt",
} as const;

export class ChatDatabase extends Dexie {
  declare meta: EntityTable<KeyValueRecord, "key">;
  declare settings: EntityTable<KeyValueRecord, "key">;
  declare connections: EntityTable<ConnectionRecord, "id">;
  declare credentials: EntityTable<CredentialRecord, "id">;
  declare assistants: EntityTable<AssistantRecord, "id">;
  declare conversations: EntityTable<ConversationRecord, "id">;
  declare messages: EntityTable<MessageNode, "id">;
  declare branchSelections: Table<BranchSelectionRecord, [string, string]>;
  declare attachments: EntityTable<AttachmentRecord, "id">;
  declare messageAttachments: Table<MessageAttachmentRecord, [string, string]>;
  declare modelOverrides: Table<ModelOverrideRecord, [string, string]>;
  declare webSearchCredentials: EntityTable<WebSearchCredentialRecord, "id">;

  constructor(name = DATABASE_NAME, options?: DexieOptions) {
    super(name, options);

    this.version(1).stores(LEGACY_CHAT_DATABASE_STORES);
    this.version(2)
      .stores(LEGACY_CHAT_DATABASE_STORES)
      .upgrade(async (transaction) => {
        await transaction
          .table<Partial<ConversationRecord> & { systemPrompt?: string }>(
            "conversations",
          )
          .toCollection()
          .modify((conversation) => {
            if (conversation.titleSource === undefined) {
              conversation.titleSource = "local";
            }
            if (conversation.archived === undefined)
              conversation.archived = false;
            if (conversation.contextCutoffId === undefined) {
              conversation.contextCutoffId = null;
            }
            if (conversation.systemPrompt === undefined)
              conversation.systemPrompt = "";
            if (conversation.autoTitle === undefined)
              conversation.autoTitle = true;
          });
      });
    this.version(3)
      .stores(CHAT_DATABASE_STORES)
      .upgrade(async (transaction) => {
        const timestamp = new Date().toISOString();
        await transaction.table<AssistantRecord>("assistants").put({
          id: DEFAULT_ASSISTANT_ID,
          kind: "default",
          name: DEFAULT_ASSISTANT_NAME,
          icon: DEFAULT_ASSISTANT_ICON,
          systemPrompt: "",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await transaction
          .table<Partial<ConversationRecord> & { systemPrompt?: string }>(
            "conversations",
          )
          .toCollection()
          .modify((conversation) => {
            conversation.assistantId = DEFAULT_ASSISTANT_ID;
            conversation.assistantSnapshot = createDefaultAssistantSnapshot();
            delete conversation.systemPrompt;
          });
      });
    this.version(4)
      .stores(CHAT_DATABASE_STORES)
      .upgrade(async (transaction) => {
        await transaction
          .table<Partial<ConversationRecord>>("conversations")
          .toCollection()
          .modify((conversation) => {
            if (conversation.activeModelId === undefined) {
              conversation.activeModelId = null;
            }
          });
      });
    this.version(5)
      .stores(CHAT_DATABASE_STORES)
      .upgrade(async (transaction) => {
        await transaction
          .table<Partial<MessageNode>>("messages")
          .toCollection()
          .modify((message) => {
            if (message.error === undefined) message.error = null;
          });
      });
    this.version(6)
      .stores(CHAT_DATABASE_STORES)
      .upgrade(async (transaction) => {
        await transaction
          .table<Partial<ConversationRecord>>("conversations")
          .toCollection()
          .modify((conversation) => {
            if (conversation.webSearchEnabled === undefined) {
              conversation.webSearchEnabled = false;
            }
          });
      });
    this.version(7)
      .stores(CHAT_DATABASE_STORES)
      .upgrade(async (transaction) => {
        await transaction
          .table<
            Partial<ConversationRecord> & {
              contextMessageLimit?: number;
              advancedSettings?: unknown;
            }
          >("conversations")
          .toCollection()
          .modify((conversation) => {
            delete conversation.contextMessageLimit;
            delete conversation.advancedSettings;
          });
      });
    this.version(8)
      .stores(CHAT_DATABASE_STORES)
      .upgrade(async (transaction) => {
        const settings = transaction.table<KeyValueRecord>("settings");
        const legacy = await settings.get(LEGACY_WEB_SEARCH_SETTINGS_KEY);
        const value = legacy?.value;
        if (!isLegacyWebSearchSettings(value) || !legacy) return;
        await settings.put({
          key: WEB_SEARCH_SETTINGS_KEY,
          value: { ...value, provider: "tavily" },
          updatedAt: legacy.updatedAt,
        });
        await settings.delete(LEGACY_WEB_SEARCH_SETTINGS_KEY);
      });
  }
}

function isLegacyWebSearchSettings(
  value: JsonValue | undefined,
): value is { enabled: boolean; maxResults: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const enabled = value.enabled;
  const maxResults = value.maxResults;
  return (
    typeof enabled === "boolean" &&
    typeof maxResults === "number" &&
    Number.isInteger(maxResults) &&
    maxResults >= WEB_SEARCH_RESULT_COUNT.min &&
    maxResults <= WEB_SEARCH_RESULT_COUNT.max
  );
}
