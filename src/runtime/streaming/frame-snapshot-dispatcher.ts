import type { StreamSnapshot } from "@/runtime/streaming/stream-state";

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export class FrameSnapshotDispatcher {
  private pending: StreamSnapshot | null = null;
  private frame: number | null = null;

  constructor(
    private readonly dispatch: (snapshot: StreamSnapshot) => void,
    private readonly requestFrame: RequestFrame = (callback) =>
      globalThis.requestAnimationFrame(callback),
    private readonly cancelFrame: CancelFrame = (handle) =>
      globalThis.cancelAnimationFrame(handle),
  ) {}

  schedule(snapshot: StreamSnapshot): void {
    this.pending = snapshot;
    if (isTerminal(snapshot)) {
      this.flush();
      return;
    }
    if (this.frame !== null) return;
    this.frame = this.requestFrame(() => {
      this.frame = null;
      this.flush();
    });
  }

  flush(): void {
    if (this.frame !== null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }
    const snapshot = this.pending;
    this.pending = null;
    if (snapshot) this.dispatch(snapshot);
  }

  cancel(): void {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.pending = null;
  }
}

function isTerminal(snapshot: StreamSnapshot): boolean {
  return (
    snapshot.state === "completed" ||
    snapshot.state === "stopped" ||
    snapshot.state === "error"
  );
}
