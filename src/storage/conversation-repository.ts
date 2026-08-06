import type {
  AssistantSnapshot,
  BranchSelectionRecord,
  ConversationRecord,
  MessageNode,
  MessagePart,
  MessageRole,
  MessageStatus,
  ModelSnapshot,
  TokenUsage,
} from "@/runtime/chat/types";
import {
  buildSelectedPath,
  MessageTreeIntegrityError,
  parentKey,
} from "@/runtime/chat/message-tree";
import { textFromMessage } from "@/runtime/chat/projections";
import {
  createDefaultAssistantSnapshot,
  DEFAULT_ASSISTANT_ID,
} from "@/runtime/chat/types";
import type { ChatDatabase } from "@/storage/database";

export class ConversationNotFoundError extends Error {
  constructor(conversationId: string) {
    super(`Conversation does not exist: ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

export class MessageNotFoundError extends Error {
  constructor(messageId: string) {
    super(`Message does not exist: ${messageId}`);
    this.name = "MessageNotFoundError";
  }
}

interface RepositoryDependencies {
  createId: () => string;
  now: () => string;
}

interface CreateConversationInput {
  title?: string;
  activeModelId?: string | null;
  assistant?: {
    id: string;
    snapshot: AssistantSnapshot;
  };
  webSearchEnabled?: boolean;
}

interface CreateMessageInput {
  role: MessageRole;
  parts: MessagePart[];
  status?: MessageStatus;
  modelSnapshot?: ModelSnapshot | null;
  usage?: TokenUsage | null;
}

export interface ConversationSearchResult {
  conversationId: string;
  messageId: string | null;
  title: string;
  snippet: string;
}

const defaultDependencies: RepositoryDependencies = {
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

export class ConversationRepository {
  private readonly dependencies: RepositoryDependencies;

  constructor(
    private readonly database: ChatDatabase,
    dependencies: Partial<RepositoryDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async createConversation(
    input: CreateConversationInput = {},
  ): Promise<ConversationRecord> {
    const timestamp = this.dependencies.now();
    const assistant = input.assistant ?? {
      id: DEFAULT_ASSISTANT_ID,
      snapshot: createDefaultAssistantSnapshot(),
    };
    const conversation: ConversationRecord = {
      id: this.dependencies.createId(),
      title: input.title ?? "New chat",
      titleSource: "local",
      archived: false,
      activeLeafId: null,
      activeModelId: input.activeModelId?.trim() || null,
      contextCutoffId: null,
      assistantId: assistant.id,
      assistantSnapshot: structuredClone(assistant.snapshot),
      autoTitle: true,
      webSearchEnabled: input.webSearchEnabled ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.database.conversations.add(conversation);
    return conversation;
  }

  async appendMessage(
    conversationId: string,
    input: CreateMessageInput,
  ): Promise<MessageNode> {
    return this.database.transaction(
      "rw",
      this.database.conversations,
      this.database.messages,
      this.database.branchSelections,
      this.database.messageAttachments,
      async () => {
        const conversation = await this.requireConversation(conversationId);
        const timestamp = this.dependencies.now();
        const message = this.createMessage(
          conversationId,
          conversation.activeLeafId,
          input,
          timestamp,
        );
        await this.database.messages.add(message);
        await this.linkMessageAttachments(message);
        await this.database.branchSelections.put({
          conversationId,
          parentKey: parentKey(conversation.activeLeafId),
          selectedChildId: message.id,
        });
        await this.database.conversations.update(conversationId, {
          activeLeafId: message.id,
          updatedAt: timestamp,
        });
        return message;
      },
    );
  }

  async createVersion(
    messageId: string,
    input: CreateMessageInput,
  ): Promise<MessageNode> {
    return this.database.transaction(
      "rw",
      this.database.conversations,
      this.database.messages,
      this.database.branchSelections,
      this.database.messageAttachments,
      async () => {
        const original = await this.database.messages.get(messageId);
        if (!original) throw new MessageNotFoundError(messageId);
        await this.requireConversation(original.conversationId);

        const timestamp = this.dependencies.now();
        const version = this.createMessage(
          original.conversationId,
          original.parentId,
          input,
          timestamp,
        );
        await this.database.messages.add(version);
        await this.linkMessageAttachments(version);
        await this.database.branchSelections.put({
          conversationId: original.conversationId,
          parentKey: parentKey(original.parentId),
          selectedChildId: version.id,
        });
        await this.database.conversations.update(original.conversationId, {
          activeLeafId: version.id,
          updatedAt: timestamp,
        });
        return version;
      },
    );
  }

  async editUserMessage(
    messageId: string,
    text: string,
    attachmentIds?: readonly string[],
  ): Promise<MessageNode> {
    const original = await this.database.messages.get(messageId);
    if (!original) throw new MessageNotFoundError(messageId);
    if (original.role !== "user") {
      throw new TypeError("Only user messages can be edited");
    }
    const originalAttachmentIds = original.parts
      .filter((part) => part.type === "image_ref")
      .map((part) => part.attachmentId);
    const selectedAttachmentIds = attachmentIds
      ? [...new Set(attachmentIds)]
      : originalAttachmentIds;
    if (
      selectedAttachmentIds.some(
        (attachmentId) => !originalAttachmentIds.includes(attachmentId),
      )
    ) {
      throw new TypeError(
        "Edited messages can only reuse original attachments",
      );
    }
    if (!text && selectedAttachmentIds.length === 0) {
      throw new TypeError("Edited user message cannot be empty");
    }

    return this.createVersion(messageId, {
      role: "user",
      parts: [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...selectedAttachmentIds.map((attachmentId) => ({
          type: "image_ref" as const,
          attachmentId,
          alt: null,
        })),
      ],
    });
  }

  async selectVersion(messageId: string): Promise<MessageNode[]> {
    return this.database.transaction(
      "rw",
      this.database.conversations,
      this.database.messages,
      this.database.branchSelections,
      async () => {
        const selected = await this.database.messages.get(messageId);
        if (!selected) throw new MessageNotFoundError(messageId);

        const [messages, currentSelections] = await Promise.all([
          this.database.messages
            .where("conversationId")
            .equals(selected.conversationId)
            .toArray(),
          this.database.branchSelections
            .where("conversationId")
            .equals(selected.conversationId)
            .toArray(),
        ]);
        const replacement: BranchSelectionRecord = {
          conversationId: selected.conversationId,
          parentKey: parentKey(selected.parentId),
          selectedChildId: selected.id,
        };
        const selections = currentSelections.filter(
          (selection) => selection.parentKey !== replacement.parentKey,
        );
        selections.push(replacement);
        const path = buildSelectedPath(messages, selections);
        const activeLeafId = path.at(-1)?.id ?? null;

        await this.database.branchSelections.put(replacement);
        await this.database.conversations.update(selected.conversationId, {
          activeLeafId,
          updatedAt: this.dependencies.now(),
        });
        return path;
      },
    );
  }

  async getCurrentPath(conversationId: string): Promise<MessageNode[]> {
    await this.requireConversation(conversationId);
    const [messages, selections] = await Promise.all([
      this.database.messages
        .where("conversationId")
        .equals(conversationId)
        .toArray(),
      this.database.branchSelections
        .where("conversationId")
        .equals(conversationId)
        .toArray(),
    ]);
    return buildSelectedPath(messages, selections);
  }

  async listMessages(conversationId: string): Promise<MessageNode[]> {
    await this.requireConversation(conversationId);
    return this.database.messages
      .where("conversationId")
      .equals(conversationId)
      .sortBy("createdAt");
  }

  async recoverInterruptedMessages(): Promise<number> {
    return this.database.transaction("rw", this.database.messages, async () => {
      const interrupted = (await this.database.messages.toArray()).filter(
        (message) =>
          message.role === "assistant" &&
          (message.status === "pending" || message.status === "streaming"),
      );
      if (interrupted.length === 0) return 0;
      const updatedAt = this.dependencies.now();
      await this.database.messages.bulkPut(
        interrupted.map((message) => ({
          ...message,
          parts: message.parts.map((part) =>
            part.type === "tool_call" && part.status === "running"
              ? {
                  ...part,
                  status: "error" as const,
                  errorCode: "TOOL_REQUEST_ABORTED",
                  errorStatus: null,
                  retryable: true,
                }
              : part,
          ),
          status: "stopped" as const,
          error: null,
          updatedAt,
        })),
      );
      return interrupted.length;
    });
  }

  async listConversations(archived: boolean): Promise<ConversationRecord[]> {
    const conversations = await this.database.conversations.toArray();
    return conversations
      .filter((conversation) => conversation.archived === archived)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getConversation(conversationId: string): Promise<ConversationRecord> {
    return this.requireConversation(conversationId);
  }

  async setWebSearchEnabled(
    conversationId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.requireConversation(conversationId);
    await this.database.conversations.update(conversationId, {
      webSearchEnabled: enabled,
      updatedAt: this.dependencies.now(),
    });
  }

  async rebindAssistantIfEmpty(
    conversationId: string,
    assistant: { id: string; snapshot: AssistantSnapshot },
  ): Promise<boolean> {
    return this.database.transaction(
      "rw",
      this.database.conversations,
      this.database.messages,
      async () => {
        await this.requireConversation(conversationId);
        const messageCount = await this.database.messages
          .where("conversationId")
          .equals(conversationId)
          .count();
        if (messageCount > 0) return false;
        await this.database.conversations.update(conversationId, {
          assistantId: assistant.id,
          assistantSnapshot: structuredClone(assistant.snapshot),
          updatedAt: this.dependencies.now(),
        });
        return true;
      },
    );
  }

  async setLocalTitle(conversationId: string, title: string): Promise<void> {
    const conversation = await this.requireConversation(conversationId);
    if (conversation.titleSource !== "local") return;
    await this.database.conversations.update(conversationId, {
      title,
      updatedAt: this.dependencies.now(),
    });
  }

  async setAiTitle(conversationId: string, title: string): Promise<void> {
    const conversation = await this.requireConversation(conversationId);
    if (conversation.titleSource !== "local" || !conversation.autoTitle) return;
    await this.database.conversations.update(conversationId, {
      title,
      titleSource: "ai",
      updatedAt: this.dependencies.now(),
    });
  }

  async setContextCutoff(
    conversationId: string,
    messageId: string | null,
  ): Promise<void> {
    await this.requireConversation(conversationId);
    if (messageId) {
      const message = await this.database.messages.get(messageId);
      if (!message || message.conversationId !== conversationId) {
        throw new MessageNotFoundError(messageId);
      }
    }
    await this.database.conversations.update(conversationId, {
      contextCutoffId: messageId,
      updatedAt: this.dependencies.now(),
    });
  }

  async setActiveModel(conversationId: string, modelId: string): Promise<void> {
    const normalized = modelId.normalize("NFKC").trim();
    if (!normalized) throw new TypeError("Active model ID cannot be empty");
    await this.requireConversation(conversationId);
    await this.database.conversations.update(conversationId, {
      activeModelId: normalized,
      updatedAt: this.dependencies.now(),
    });
  }

  async search(query: string): Promise<ConversationSearchResult[]> {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return [];

    const [conversations, messages] = await Promise.all([
      this.database.conversations.toArray(),
      this.database.messages.toArray(),
    ]);
    const messagesByConversation = new Map<string, MessageNode[]>();
    for (const message of messages) {
      const bucket = messagesByConversation.get(message.conversationId) ?? [];
      bucket.push(message);
      messagesByConversation.set(message.conversationId, bucket);
    }

    const results: ConversationSearchResult[] = [];
    for (const conversation of conversations) {
      if (normalizeSearchText(conversation.title).includes(normalizedQuery)) {
        results.push({
          conversationId: conversation.id,
          messageId: null,
          title: conversation.title,
          snippet: conversation.title,
        });
        continue;
      }

      const match = messagesByConversation
        .get(conversation.id)
        ?.find((message) =>
          normalizeSearchText(textFromMessage(message)).includes(
            normalizedQuery,
          ),
        );
      if (match) {
        results.push({
          conversationId: conversation.id,
          messageId: match.id,
          title: conversation.title,
          snippet: createSearchSnippet(textFromMessage(match), normalizedQuery),
        });
      }
    }

    return results.sort((left, right) => left.title.localeCompare(right.title));
  }

  async selectPathToMessage(messageId: string): Promise<MessageNode[]> {
    return this.database.transaction(
      "rw",
      this.database.conversations,
      this.database.messages,
      this.database.branchSelections,
      async () => {
        const target = await this.database.messages.get(messageId);
        if (!target) throw new MessageNotFoundError(messageId);
        const messages = await this.database.messages
          .where("conversationId")
          .equals(target.conversationId)
          .toArray();
        const byId = new Map(messages.map((message) => [message.id, message]));
        const reversedPath: MessageNode[] = [];
        const visited = new Set<string>();
        let current: MessageNode | undefined = target;

        while (current) {
          if (visited.has(current.id)) {
            throw new MessageTreeIntegrityError(
              `Message cycle detected: ${current.id}`,
            );
          }
          visited.add(current.id);
          reversedPath.push(current);
          if (!current.parentId) break;
          const parent = byId.get(current.parentId);
          if (!parent) {
            throw new MessageTreeIntegrityError(
              `Message parent does not exist: ${current.parentId}`,
            );
          }
          current = parent;
        }

        const path = reversedPath.reverse();
        await this.database.branchSelections.bulkPut(
          path.map((message) => ({
            conversationId: target.conversationId,
            parentKey: parentKey(message.parentId),
            selectedChildId: message.id,
          })),
        );
        await this.database.conversations.update(target.conversationId, {
          activeLeafId: target.id,
          updatedAt: this.dependencies.now(),
        });
        return path;
      },
    );
  }

  async rename(conversationId: string, title: string): Promise<void> {
    await this.requireConversation(conversationId);
    await this.database.conversations.update(conversationId, {
      title,
      titleSource: "user",
      updatedAt: this.dependencies.now(),
    });
  }

  async setArchived(conversationId: string, archived: boolean): Promise<void> {
    await this.requireConversation(conversationId);
    await this.database.conversations.update(conversationId, {
      archived,
      updatedAt: this.dependencies.now(),
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.conversations,
      this.database.messages,
      this.database.branchSelections,
      this.database.messageAttachments,
      this.database.attachments,
      async () => {
        await this.requireConversation(conversationId);
        const links = await this.database.messageAttachments
          .where("conversationId")
          .equals(conversationId)
          .toArray();
        const attachmentIds = [
          ...new Set(links.map((link) => link.attachmentId)),
        ];

        await Promise.all([
          this.database.messages
            .where("conversationId")
            .equals(conversationId)
            .delete(),
          this.database.branchSelections
            .where("conversationId")
            .equals(conversationId)
            .delete(),
          this.database.messageAttachments
            .where("conversationId")
            .equals(conversationId)
            .delete(),
          this.database.conversations.delete(conversationId),
        ]);

        for (const attachmentId of attachmentIds) {
          const remainingReferences = await this.database.messageAttachments
            .where("attachmentId")
            .equals(attachmentId)
            .count();
          if (remainingReferences === 0) {
            await this.database.attachments.delete(attachmentId);
          }
        }
      },
    );
  }

  async clearConversations(): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.conversations,
      this.database.messages,
      this.database.branchSelections,
      this.database.messageAttachments,
      this.database.attachments,
      async () => {
        await Promise.all([
          this.database.conversations.clear(),
          this.database.messages.clear(),
          this.database.branchSelections.clear(),
          this.database.messageAttachments.clear(),
          this.database.attachments.clear(),
        ]);
      },
    );
  }

  private async requireConversation(
    conversationId: string,
  ): Promise<ConversationRecord> {
    const conversation = await this.database.conversations.get(conversationId);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    return conversation;
  }

  private createMessage(
    conversationId: string,
    parentId: string | null,
    input: CreateMessageInput,
    timestamp: string,
  ): MessageNode {
    return {
      id: this.dependencies.createId(),
      conversationId,
      parentId,
      role: input.role,
      parts: structuredClone(input.parts),
      status: input.status ?? "completed",
      modelSnapshot: input.modelSnapshot ?? null,
      usage: input.usage ?? null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private async linkMessageAttachments(message: MessageNode): Promise<void> {
    const attachmentIds = [
      ...new Set(
        message.parts
          .filter((part) => part.type === "image_ref")
          .map((part) => part.attachmentId),
      ),
    ];
    if (attachmentIds.length === 0) return;
    await this.database.messageAttachments.bulkPut(
      attachmentIds.map((attachmentId) => ({
        messageId: message.id,
        attachmentId,
        conversationId: message.conversationId,
      })),
    );
  }
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function createSearchSnippet(text: string, normalizedQuery: string): string {
  const normalizedText = normalizeSearchText(text);
  const matchIndex = normalizedText.indexOf(normalizedQuery);
  if (matchIndex < 0) return text.slice(0, 120);
  const start = Math.max(0, matchIndex - 40);
  const end = Math.min(text.length, matchIndex + normalizedQuery.length + 80);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}
