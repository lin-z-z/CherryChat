import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_REQUEST_TIMEOUT_POLICY,
  fetchWithRequestTimeouts,
  isRequestTimeoutPolicy,
  modelListTimeouts,
  RequestTimeoutError,
  type OperationTimeouts,
} from "@/runtime/transport/request-timeout-policy";

const encoder = new TextEncoder();

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchWithRequestTimeouts", () => {
  it("aborts while waiting for response headers", async () => {
    vi.useFakeTimers();
    let upstreamAborted = false;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            upstreamAborted = true;
            reject(init.signal?.reason);
          });
        }),
    );

    const pending = fetchWithRequestTimeouts(
      "https://example.test/chat",
      {},
      operationTimeouts({ firstByteMs: 100 }),
      fetchMock,
    );
    const rejection = expect(pending).rejects.toMatchObject({
      name: "RequestTimeoutError",
      phase: "first-byte",
    });

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(upstreamAborted).toBe(true);
  });

  it("resets idle timeout for each received chunk", async () => {
    vi.useFakeTimers();
    const upstream = controlledResponse();
    const response = await fetchWithRequestTimeouts(
      "https://example.test/chat",
      {},
      operationTimeouts({ idleMs: 100, totalMs: 1_000 }),
      upstream.fetch,
    );
    const reader = response.body?.getReader();

    const first = reader?.read();
    await vi.advanceTimersByTimeAsync(80);
    upstream.enqueue("one");
    await expect(first).resolves.toMatchObject({ done: false });

    const second = reader?.read();
    await vi.advanceTimersByTimeAsync(80);
    upstream.enqueue("two");
    await expect(second).resolves.toMatchObject({ done: false });

    const timedOut = reader?.read();
    const rejection = expect(timedOut).rejects.toMatchObject({
      name: "RequestTimeoutError",
      phase: "idle",
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });

  it("does not reset the total timer when chunks arrive", async () => {
    vi.useFakeTimers();
    const upstream = controlledResponse();
    const response = await fetchWithRequestTimeouts(
      "https://example.test/chat",
      {},
      operationTimeouts({ idleMs: 100, totalMs: 250 }),
      upstream.fetch,
    );
    const reader = response.body?.getReader();

    for (const value of ["one", "two"] as const) {
      const chunk = reader?.read();
      await vi.advanceTimersByTimeAsync(90);
      upstream.enqueue(value);
      await expect(chunk).resolves.toMatchObject({ done: false });
    }

    const timedOut = reader?.read();
    const rejection = expect(timedOut).rejects.toMatchObject({
      name: "RequestTimeoutError",
      phase: "total",
    });
    await vi.advanceTimersByTimeAsync(70);
    await rejection;
  });

  it("allows every timer to be disabled", async () => {
    vi.useFakeTimers();
    const upstream = controlledResponse();
    const response = await fetchWithRequestTimeouts(
      "https://example.test/chat",
      {},
      operationTimeouts({ firstByteMs: 0, idleMs: 0, totalMs: 0 }),
      upstream.fetch,
    );
    const reader = response.body?.getReader();
    const chunk = reader?.read();

    await vi.advanceTimersByTimeAsync(86_400_000);
    upstream.enqueue("still-open");
    await expect(chunk).resolves.toMatchObject({ done: false });
    const done = reader?.read();
    upstream.close();
    await expect(done).resolves.toEqual({ done: true, value: undefined });
  });

  it("preserves caller cancellation instead of labeling it a timeout", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const pending = fetchWithRequestTimeouts(
      "https://example.test/chat",
      { signal: caller.signal },
      operationTimeouts(),
      fetchMock,
    );
    const rejection = expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof DOMException &&
        error.name === "AbortError" &&
        !(error instanceof RequestTimeoutError),
    );

    caller.abort();
    await rejection;
  });

  it("cleans timers after a normal response body closes", async () => {
    vi.useFakeTimers();
    const upstream = controlledResponse();
    const response = await fetchWithRequestTimeouts(
      "https://example.test/chat",
      {},
      operationTimeouts({ firstByteMs: 10, idleMs: 10, totalMs: 10 }),
      upstream.fetch,
    );
    const reader = response.body?.getReader();
    const done = reader?.read();
    upstream.close();

    await expect(done).resolves.toEqual({ done: true, value: undefined });
    await vi.advanceTimersByTimeAsync(100);
    expect(upstream.aborted()).toBe(false);
  });

  it("keeps a model-list body timeout in the model-list phase", async () => {
    vi.useFakeTimers();
    const upstream = controlledResponse();
    const response = await fetchWithRequestTimeouts(
      "https://example.test/models",
      {},
      modelListTimeouts({
        ...DEFAULT_REQUEST_TIMEOUT_POLICY,
        modelListMs: 100,
      }),
      upstream.fetch,
    );
    const timedOut = response.body?.getReader().read();
    const rejection = expect(timedOut).rejects.toMatchObject({
      phase: "model-list",
    });

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });
});

describe("request timeout policy validation", () => {
  it("accepts bounded whole milliseconds only", () => {
    expect(isRequestTimeoutPolicy(DEFAULT_REQUEST_TIMEOUT_POLICY)).toBe(true);
    expect(
      isRequestTimeoutPolicy({
        ...DEFAULT_REQUEST_TIMEOUT_POLICY,
        chatIdleMs: 0,
      }),
    ).toBe(true);
    expect(
      isRequestTimeoutPolicy({
        ...DEFAULT_REQUEST_TIMEOUT_POLICY,
        chatIdleMs: 1.5,
      }),
    ).toBe(false);
    expect(
      isRequestTimeoutPolicy({
        ...DEFAULT_REQUEST_TIMEOUT_POLICY,
        chatTotalMs: 86_400_001,
      }),
    ).toBe(false);
  });
});

function operationTimeouts(
  overrides: Partial<OperationTimeouts> = {},
): OperationTimeouts {
  return {
    firstByteMs: 1_000,
    idleMs: 1_000,
    totalMs: 10_000,
    firstBytePhase: "first-byte",
    totalPhase: "total",
    ...overrides,
  };
}

function controlledResponse() {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null;
  let requestAborted = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.addEventListener("abort", () => {
      requestAborted = true;
      streamController?.error(init.signal?.reason);
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  return {
    fetch,
    enqueue(value: string) {
      streamController?.enqueue(encoder.encode(value));
    },
    close() {
      streamController?.close();
    },
    aborted: () => requestAborted,
  };
}
