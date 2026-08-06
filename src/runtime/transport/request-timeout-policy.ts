export const DEFAULT_REQUEST_TIMEOUT_POLICY = Object.freeze({
  modelListMs: 30_000,
  chatFirstByteMs: 300_000,
  chatIdleMs: 300_000,
  chatTotalMs: 1_800_000,
}) satisfies RequestTimeoutPolicy;

export const MAX_REQUEST_TIMEOUT_MS = 86_400_000;

export interface RequestTimeoutPolicy {
  modelListMs: number;
  chatFirstByteMs: number;
  chatIdleMs: number;
  chatTotalMs: number;
}

export type RequestTimeoutPhase =
  "model-list" | "first-byte" | "idle" | "total";

export interface OperationTimeouts {
  firstByteMs: number;
  idleMs: number;
  totalMs: number;
  firstBytePhase: RequestTimeoutPhase;
  totalPhase: RequestTimeoutPhase;
}

export class RequestTimeoutError extends Error {
  constructor(readonly phase: RequestTimeoutPhase) {
    super(`Request timed out during ${phase}`);
    this.name = "RequestTimeoutError";
  }
}

export function modelListTimeouts(
  policy: RequestTimeoutPolicy,
): OperationTimeouts {
  return {
    firstByteMs: policy.modelListMs,
    idleMs: 0,
    totalMs: policy.modelListMs,
    firstBytePhase: "model-list",
    totalPhase: "model-list",
  };
}

export function chatTimeouts(policy: RequestTimeoutPolicy): OperationTimeouts {
  return {
    firstByteMs: policy.chatFirstByteMs,
    idleMs: policy.chatIdleMs,
    totalMs: policy.chatTotalMs,
    firstBytePhase: "first-byte",
    totalPhase: "total",
  };
}

export function isRequestTimeoutPolicy(
  value: unknown,
): value is RequestTimeoutPolicy {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [
    record.modelListMs,
    record.chatFirstByteMs,
    record.chatIdleMs,
    record.chatTotalMs,
  ].every(
    (milliseconds) =>
      typeof milliseconds === "number" &&
      Number.isInteger(milliseconds) &&
      milliseconds >= 0 &&
      milliseconds <= MAX_REQUEST_TIMEOUT_MS,
  );
}

export async function fetchWithRequestTimeouts(
  input: RequestInfo | URL,
  init: RequestInit,
  timeouts: OperationTimeouts,
  fetchImplementation: typeof fetch = fetch,
  mapTimeoutError: (phase: RequestTimeoutPhase) => Error = (phase) =>
    new RequestTimeoutError(phase),
): Promise<Response> {
  const callerSignal = init.signal;
  const controller = new AbortController();
  let timeoutPhase: RequestTimeoutPhase | null = null;
  let firstByteTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let totalTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer !== null) clearTimeout(timer);
  };
  const clearAllTimers = () => {
    clearTimer(firstByteTimer);
    clearTimer(idleTimer);
    clearTimer(totalTimer);
    firstByteTimer = null;
    idleTimer = null;
    totalTimer = null;
  };
  const removeCallerListener = () =>
    callerSignal?.removeEventListener("abort", abortFromCaller);
  const cleanup = () => {
    clearAllTimers();
    removeCallerListener();
  };
  const abortForTimeout = (phase: RequestTimeoutPhase) => {
    if (controller.signal.aborted) return;
    timeoutPhase = phase;
    clearAllTimers();
    removeCallerListener();
    controller.abort(new RequestTimeoutError(phase));
  };
  function abortFromCaller() {
    if (controller.signal.aborted) return;
    clearAllTimers();
    removeCallerListener();
    controller.abort(callerSignal?.reason);
  }
  const schedule = (
    milliseconds: number,
    phase: RequestTimeoutPhase,
  ): ReturnType<typeof setTimeout> | null =>
    milliseconds > 0
      ? setTimeout(() => abortForTimeout(phase), milliseconds)
      : null;
  const resetIdleTimer = () => {
    clearTimer(idleTimer);
    idleTimer = schedule(timeouts.idleMs, "idle");
  };

  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  if (!controller.signal.aborted) {
    firstByteTimer = schedule(timeouts.firstByteMs, timeouts.firstBytePhase);
    totalTimer = schedule(timeouts.totalMs, timeouts.totalPhase);
  }

  let response: Response;
  try {
    response = await fetchImplementation(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    cleanup();
    if (timeoutPhase) throw mapTimeoutError(timeoutPhase);
    throw error;
  }

  if (controller.signal.aborted) {
    cleanup();
    await response.body?.cancel().catch(() => undefined);
    if (timeoutPhase) throw mapTimeoutError(timeoutPhase);
    throw controller.signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  clearTimer(firstByteTimer);
  firstByteTimer = null;
  if (!response.body) {
    cleanup();
    return response;
  }

  const reader = response.body.getReader();
  resetIdleTimer();
  const body = new ReadableStream<Uint8Array>({
    async pull(destination) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          cleanup();
          destination.close();
          return;
        }
        resetIdleTimer();
        destination.enqueue(value);
      } catch (error) {
        cleanup();
        destination.error(timeoutPhase ? mapTimeoutError(timeoutPhase) : error);
      }
    },
    async cancel(reason) {
      cleanup();
      if (!controller.signal.aborted) controller.abort(reason);
      await reader.cancel(reason).catch(() => undefined);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
