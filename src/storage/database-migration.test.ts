import Dexie from "dexie";
import { describe, expect, it } from "vitest";

import type {
  ConversationRecord,
  MessageAttachmentRecord,
  MessageNode,
  WebSearchCredentialRecord,
} from "@/runtime/chat/types";
import {
  createDefaultAssistantSnapshot,
  DEFAULT_ASSISTANT_ID,
} from "@/runtime/chat/types";
import {
  CHAT_DATABASE_STORES,
  ChatDatabase,
  LEGACY_CHAT_DATABASE_STORES,
} from "@/storage/database";
import {
  LEGACY_WEB_SEARCH_SETTINGS_KEY,
  WEB_SEARCH_SETTINGS_KEY,
} from "@/runtime/tools/web-search-settings";

type LegacyConversationRecord = Pick<
  ConversationRecord,
  "id" | "title" | "activeLeafId" | "createdAt" | "updatedAt"
>;
type LegacyMessageNode = Omit<MessageNode, "error">;
interface LegacyConversationSettings {
  contextMessageLimit: number;
  advancedSettings: {
    temperature: { enabled: boolean; value: number };
    topP: { enabled: boolean; value: number };
    maxTokens: { enabled: boolean; value: number };
    customParameters: Record<string, unknown>;
  };
}

const legacyAdvancedSettings: LegacyConversationSettings["advancedSettings"] = {
  temperature: { enabled: false, value: 1 },
  topP: { enabled: false, value: 1 },
  maxTokens: { enabled: false, value: 4096 },
  customParameters: {},
};

describe("ChatDatabase migrations", () => {
  it("upgrades v1 conversations without losing message parts or attachment links", async () => {
    const name = `migration-test-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores(LEGACY_CHAT_DATABASE_STORES);
    await legacy.open();

    const timestamp = "2026-07-16T00:00:00.000Z";
    const conversation: LegacyConversationRecord = {
      id: "conversation-1",
      title: "Legacy conversation",
      activeLeafId: "message-1",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const message: LegacyMessageNode = {
      id: "message-1",
      conversationId: conversation.id,
      parentId: null,
      role: "user",
      parts: [
        { type: "text", text: "Legacy text" },
        { type: "image_ref", attachmentId: "attachment-1", alt: null },
      ],
      status: "completed",
      modelSnapshot: null,
      usage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const link: MessageAttachmentRecord = {
      messageId: message.id,
      attachmentId: "attachment-1",
      conversationId: conversation.id,
    };

    await legacy
      .table<LegacyConversationRecord>("conversations")
      .add(conversation);
    await legacy.table<LegacyMessageNode>("messages").add(message);
    await legacy.table<MessageAttachmentRecord>("messageAttachments").add(link);
    legacy.close();

    const upgraded = new ChatDatabase(name);
    try {
      await upgraded.open();

      const upgradedConversation = await upgraded.conversations.get(
        conversation.id,
      );
      expect(upgradedConversation).toMatchObject({
        ...conversation,
        titleSource: "local",
        archived: false,
        activeModelId: null,
        contextCutoffId: null,
        assistantId: DEFAULT_ASSISTANT_ID,
        assistantSnapshot: createDefaultAssistantSnapshot(),
        autoTitle: true,
        webSearchEnabled: false,
      });
      expect(upgradedConversation).not.toHaveProperty("contextMessageLimit");
      expect(upgradedConversation).not.toHaveProperty("advancedSettings");
      expect(await upgraded.assistants.get(DEFAULT_ASSISTANT_ID)).toMatchObject(
        {
          id: DEFAULT_ASSISTANT_ID,
          kind: "default",
          systemPrompt: "",
        },
      );
      expect(await upgraded.messages.get(message.id)).toMatchObject({
        parts: message.parts,
        error: null,
      });
      expect(
        await upgraded.messageAttachments.get([message.id, link.attachmentId]),
      ).toEqual(link);
    } finally {
      await upgraded.delete();
    }
  });

  it("upgrades v3 conversations with a null active model", async () => {
    const name = `migration-v3-test-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(3).stores(CHAT_DATABASE_STORES);
    await legacy.open();

    const timestamp = "2026-07-21T00:00:00.000Z";
    type Version3ConversationRecord = Omit<
      ConversationRecord,
      "activeModelId" | "webSearchEnabled"
    > &
      LegacyConversationSettings;
    const conversation: Version3ConversationRecord = {
      id: "conversation-v3",
      title: "Version 3 conversation",
      titleSource: "user",
      archived: true,
      activeLeafId: null,
      contextCutoffId: null,
      contextMessageLimit: 5,
      assistantId: DEFAULT_ASSISTANT_ID,
      assistantSnapshot: createDefaultAssistantSnapshot(),
      autoTitle: false,
      advancedSettings: legacyAdvancedSettings,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await legacy
      .table<Version3ConversationRecord>("conversations")
      .add(conversation);
    legacy.close();

    const upgraded = new ChatDatabase(name);
    try {
      await upgraded.open();

      await expect(
        upgraded.conversations.get(conversation.id),
      ).resolves.toEqual({
        id: conversation.id,
        title: conversation.title,
        titleSource: conversation.titleSource,
        archived: conversation.archived,
        activeLeafId: conversation.activeLeafId,
        contextCutoffId: conversation.contextCutoffId,
        assistantId: conversation.assistantId,
        assistantSnapshot: conversation.assistantSnapshot,
        autoTitle: conversation.autoTitle,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        activeModelId: null,
        webSearchEnabled: false,
      });
    } finally {
      await upgraded.delete();
    }
  });

  it("upgrades v6 conversations by removing unused settings fields", async () => {
    const name = `migration-v6-test-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(6).stores(CHAT_DATABASE_STORES);
    await legacy.open();

    const timestamp = "2026-08-01T00:00:00.000Z";
    const currentConversation: ConversationRecord = {
      id: "conversation-v6",
      title: "Version 6 conversation",
      titleSource: "user",
      archived: false,
      activeLeafId: null,
      activeModelId: "gpt-4.1-mini",
      contextCutoffId: null,
      assistantId: DEFAULT_ASSISTANT_ID,
      assistantSnapshot: createDefaultAssistantSnapshot(),
      autoTitle: true,
      webSearchEnabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const conversation: ConversationRecord & LegacyConversationSettings = {
      ...currentConversation,
      contextMessageLimit: 12,
      advancedSettings: {
        ...legacyAdvancedSettings,
        customParameters: { legacy: true },
      },
    };
    await legacy
      .table<ConversationRecord & LegacyConversationSettings>("conversations")
      .add(conversation);
    legacy.close();

    const upgraded = new ChatDatabase(name);
    try {
      await upgraded.open();

      await expect(
        upgraded.conversations.get(conversation.id),
      ).resolves.toEqual(currentConversation);
    } finally {
      await upgraded.delete();
    }
  });

  it("upgrades v7 Tavily settings to webSearch.v2 without losing the credential", async () => {
    const name = `migration-v7-search-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(7).stores(CHAT_DATABASE_STORES);
    await legacy.open();

    const timestamp = "2026-08-10T00:00:00.000Z";
    await legacy.table("settings").put({
      key: LEGACY_WEB_SEARCH_SETTINGS_KEY,
      value: { enabled: true, maxResults: 9 },
      updatedAt: timestamp,
    });
    const credential: WebSearchCredentialRecord = {
      id: "tavily",
      apiKey: "tvly-migration-secret",
      baseUrl: "https://search.example/tavily",
      encrypted: false,
      updatedAt: timestamp,
    };
    await legacy
      .table<WebSearchCredentialRecord>("webSearchCredentials")
      .put(credential);
    legacy.close();

    const upgraded = new ChatDatabase(name);
    try {
      await upgraded.open();
      await expect(
        upgraded.settings.get(WEB_SEARCH_SETTINGS_KEY),
      ).resolves.toEqual({
        key: WEB_SEARCH_SETTINGS_KEY,
        value: { enabled: true, maxResults: 9, provider: "tavily" },
        updatedAt: timestamp,
      });
      await expect(
        upgraded.settings.get(LEGACY_WEB_SEARCH_SETTINGS_KEY),
      ).resolves.toBeUndefined();
      await expect(
        upgraded.webSearchCredentials.get("tavily"),
      ).resolves.toEqual(credential);
    } finally {
      await upgraded.delete();
    }
  });
});
