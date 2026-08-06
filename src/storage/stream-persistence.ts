import type { MessagePart, MessageStatus } from "@/runtime/chat/types";
import { toMessageError } from "@/runtime/transport/chat-errors";
import type {
  StreamPersistencePort,
  StreamResult,
  StreamSnapshot,
} from "@/runtime/streaming/stream-state";
import type { ChatDatabase } from "@/storage/database";

export class MessageStreamPersistence implements StreamPersistencePort {
  constructor(
    private readonly database: ChatDatabase,
    private readonly messageId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async saveDraft(snapshot: StreamSnapshot): Promise<void> {
    const updated = await this.database.messages.update(this.messageId, {
      parts: partsFromSnapshot(snapshot),
      status: "streaming",
      error: null,
      updatedAt: this.now(),
    });
    if (updated === 0)
      throw new Error(`Message does not exist: ${this.messageId}`);
  }

  async finalize(result: StreamResult): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.messages,
      this.database.conversations,
      async () => {
        const message = await this.database.messages.get(this.messageId);
        if (!message)
          throw new Error(`Message does not exist: ${this.messageId}`);
        const updatedAt = this.now();
        await this.database.messages.update(this.messageId, {
          parts: partsFromSnapshot(result),
          status: statusFromResult(result),
          usage: result.usage,
          error: result.error ? toMessageError(result.error) : null,
          updatedAt,
        });
        await this.database.conversations.update(message.conversationId, {
          updatedAt,
        });
      },
    );
  }
}

function partsFromSnapshot(snapshot: StreamSnapshot): MessagePart[] {
  const parts: MessagePart[] = [];
  if (snapshot.reasoningText && snapshot.reasoningSource) {
    parts.push({
      type: "reasoning",
      text: snapshot.reasoningText,
      source: snapshot.reasoningSource,
      durationMs: snapshot.reasoningDurationMs,
    });
  }
  parts.push(...structuredClone(snapshot.providerContextParts));
  parts.push(...structuredClone(snapshot.contentParts));
  return parts;
}

function statusFromResult(result: StreamResult): MessageStatus {
  if (result.state === "completed") return "completed";
  if (result.state === "stopped") return "stopped";
  return "error";
}
