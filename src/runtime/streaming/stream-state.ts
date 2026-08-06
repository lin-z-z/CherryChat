import type {
  ProviderContextPart,
  TextPart,
  TokenUsage,
  ToolCallPart,
} from "@/runtime/chat/types";
import type { ReasoningSnapshot } from "@/runtime/streaming/reasoning-parser";
import type { ChatTransportError } from "@/runtime/transport/chat-errors";
import type { NormalizedToolCall } from "@/runtime/tools/tool-registry";

export type GenerationState =
  | "idle"
  | "connecting"
  | "reasoning"
  | "answering"
  | "completed"
  | "stopped"
  | "error";

export interface StreamSnapshot extends ReasoningSnapshot {
  state: GenerationState;
  usage: TokenUsage | null;
  reasoningDurationMs: number | null;
  startedAt: number;
  updatedAt: number;
  toolCalls: NormalizedToolCall[];
  contentParts: Array<TextPart | ToolCallPart>;
  providerContextParts: ProviderContextPart[];
}

export interface StreamResult extends StreamSnapshot {
  state: "completed" | "stopped" | "error";
  error: ChatTransportError | null;
}

export interface StreamPersistencePort {
  saveDraft(snapshot: StreamSnapshot): Promise<void>;
  finalize(result: StreamResult): Promise<void>;
}

export class ThrottledStreamPersistence {
  private latest: StreamSnapshot | null = null;
  private pendingDraft: StreamSnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writes = Promise.resolve();
  private writing = false;
  private lastFlushAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly port: StreamPersistencePort,
    private readonly intervalMs = 250,
    private readonly now: () => number = Date.now,
  ) {}

  record(snapshot: StreamSnapshot): void {
    if (
      snapshot.state === "completed" ||
      snapshot.state === "stopped" ||
      snapshot.state === "error"
    ) {
      return;
    }
    this.latest = snapshot;
    const elapsed = this.now() - this.lastFlushAt;
    if (elapsed >= this.intervalMs) {
      this.flushDraft();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushDraft();
      }, this.intervalMs - elapsed);
    }
  }

  async finish(result: StreamResult): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.latest = null;
    await this.writes;
    await this.port.finalize({
      ...structuredClone(result),
      error: result.error,
    });
  }

  async checkpoint(snapshot: StreamSnapshot): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.latest = snapshot;
    this.flushDraft();
    await this.writes;
  }

  private flushDraft(): void {
    if (!this.latest) return;
    const snapshot = structuredClone(this.latest);
    this.latest = null;
    this.lastFlushAt = this.now();
    if (this.writing) {
      this.pendingDraft = snapshot;
      return;
    }
    this.writing = true;
    this.writes = this.writeDrafts(snapshot);
  }

  private async writeDrafts(first: StreamSnapshot): Promise<void> {
    let snapshot: StreamSnapshot | null = first;
    try {
      while (snapshot) {
        await this.port.saveDraft(snapshot);
        snapshot = this.pendingDraft;
        this.pendingDraft = null;
      }
    } finally {
      this.writing = false;
      this.pendingDraft = null;
    }
  }
}
