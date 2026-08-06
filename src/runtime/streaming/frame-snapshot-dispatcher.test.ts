import { afterEach, describe, expect, it, vi } from "vitest";

import { FrameSnapshotDispatcher } from "@/runtime/streaming/frame-snapshot-dispatcher";
import type { StreamSnapshot } from "@/runtime/streaming/stream-state";

describe("FrameSnapshotDispatcher", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders only the latest snapshot in one animation frame", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const dispatch = vi.fn();
    const dispatcher = new FrameSnapshotDispatcher(
      dispatch,
      (callback) => {
        frameCallbacks.push(callback);
        return 1;
      },
      vi.fn(),
    );

    dispatcher.schedule(snapshot("a"));
    dispatcher.schedule(snapshot("ab"));
    dispatcher.schedule(snapshot("abc"));

    expect(dispatch).not.toHaveBeenCalled();
    frameCallbacks[0]?.(16);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ finalText: "abc" }),
    );
  });

  it("flushes a terminal snapshot without waiting for another frame", () => {
    const dispatch = vi.fn();
    const cancel = vi.fn();
    const dispatcher = new FrameSnapshotDispatcher(dispatch, () => 7, cancel);
    dispatcher.schedule(snapshot("partial"));
    dispatcher.schedule({ ...snapshot("done"), state: "completed" });

    expect(cancel).toHaveBeenCalledWith(7);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ state: "completed", finalText: "done" }),
    );
  });

  it("calls the browser frame APIs with the global receiver", () => {
    const receivers: unknown[] = [];
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      function (this: unknown, callback: FrameRequestCallback) {
        receivers.push(this);
        callbacks.push(callback);
        return 9;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", function (this: unknown) {
      receivers.push(this);
    });
    const dispatcher = new FrameSnapshotDispatcher(vi.fn());

    dispatcher.schedule(snapshot("pending"));
    dispatcher.flush();

    expect(receivers).toEqual([globalThis, globalThis]);
    expect(callbacks).toHaveLength(1);
  });
});

function snapshot(finalText: string): StreamSnapshot {
  return {
    state: "answering",
    reasoningText: "",
    finalText,
    reasoningSource: null,
    tagState: "final",
    usage: null,
    reasoningDurationMs: null,
    startedAt: 0,
    updatedAt: 0,
    toolCalls: [],
    contentParts: [],
    providerContextParts: [],
  };
}
