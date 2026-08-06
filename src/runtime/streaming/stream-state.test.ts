import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ThrottledStreamPersistence,
  type StreamPersistencePort,
  type StreamSnapshot,
} from "@/runtime/streaming/stream-state";
import { ChatTransportError } from "@/runtime/transport/chat-errors";

describe("ThrottledStreamPersistence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles drafts and performs one terminal persistence call", async () => {
    vi.useFakeTimers();
    const saveDraft = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => undefined);
    const port: StreamPersistencePort = { saveDraft, finalize };
    const persistence = new ThrottledStreamPersistence(port, 250, Date.now);
    persistence.record(snapshot("answering", "a"));
    persistence.record(snapshot("answering", "ab"));
    persistence.record(snapshot("answering", "abc"));
    await Promise.resolve();

    expect(saveDraft).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(saveDraft).toHaveBeenCalledTimes(2);

    await persistence.finish({
      ...snapshot("completed", "abc"),
      state: "completed",
      error: null,
    });
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("keeps only the latest pending draft while persistence is slow", async () => {
    vi.useFakeTimers();
    let releaseFirst: () => void = () => undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const saved: string[] = [];
    const persistence = new ThrottledStreamPersistence(
      {
        saveDraft: vi.fn(async (value) => {
          saved.push(value.finalText);
          if (saved.length === 1) await firstWrite;
        }),
        finalize: vi.fn(async () => undefined),
      },
      100,
      Date.now,
    );

    persistence.record(snapshot("answering", "a"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    persistence.record(snapshot("answering", "ab"));
    await vi.advanceTimersByTimeAsync(100);
    persistence.record(snapshot("answering", "abc"));
    await vi.advanceTimersByTimeAsync(100);

    expect(saved).toEqual(["a"]);
    releaseFirst();
    await vi.runAllTimersAsync();
    await persistence.finish({
      ...snapshot("completed", "abc"),
      state: "completed",
      error: null,
    });

    expect(saved).toEqual(["a", "abc"]);
  });

  it("waits for a durability checkpoint to finish", async () => {
    let release: () => void = () => undefined;
    const write = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saveDraft = vi.fn(async () => write);
    const persistence = new ThrottledStreamPersistence({
      saveDraft,
      finalize: vi.fn(async () => undefined),
    });

    let completed = false;
    const checkpoint = persistence
      .checkpoint(snapshot("connecting", "before tool"))
      .then(() => {
        completed = true;
      });
    await Promise.resolve();

    expect(saveDraft).toHaveBeenCalledOnce();
    expect(completed).toBe(false);
    release();
    await checkpoint;
    expect(completed).toBe(true);
  });

  it("preserves a typed transport error across the terminal clone boundary", async () => {
    const finalize = vi
      .fn<StreamPersistencePort["finalize"]>()
      .mockResolvedValue(undefined);
    const persistence = new ThrottledStreamPersistence({
      saveDraft: vi.fn(async () => undefined),
      finalize,
    });
    const error = new ChatTransportError(
      "RATE_LIMITED",
      "Provider detail must not replace the typed fields",
      429,
      "sensitive detail",
    );

    await persistence.finish({
      ...snapshot("error", "partial answer"),
      state: "error",
      error,
    });

    const finalized = finalize.mock.calls[0]?.[0];
    expect(finalized?.error).toBe(error);
    expect(finalized?.error).toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      detail: "sensitive detail",
    });
  });
});

function snapshot(
  state: StreamSnapshot["state"],
  finalText: string,
): StreamSnapshot {
  return {
    state,
    reasoningText: "",
    finalText,
    reasoningSource: null,
    tagState: "final",
    usage: null,
    toolCalls: [],
    contentParts: finalText ? [{ type: "text", text: finalText }] : [],
    providerContextParts: [],
    reasoningDurationMs: null,
    startedAt: 0,
    updatedAt: 0,
  };
}
