import { describe, expect, it } from "vitest";

import {
  readLimitedResponseBytes,
  readLimitedResponseJson,
  readLimitedResponseText,
  ResponseLimitError,
} from "@/runtime/transport/response-reader";

describe("bounded response readers", () => {
  it("reads bytes, strict UTF-8 text, and JSON within the limit", async () => {
    await expect(
      readLimitedResponseBytes(new Response("hello"), 5).then((bytes) => [
        ...bytes,
      ]),
    ).resolves.toEqual([...new TextEncoder().encode("hello")]);
    await expect(
      readLimitedResponseText(new Response("你好"), 6),
    ).resolves.toBe("你好");
    await expect(
      readLimitedResponseJson(new Response('{"ok":true}'), 16),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects an oversized Content-Length before reading and cancels the body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, {
      headers: { "Content-Length": "9" },
    });

    await expect(readLimitedResponseBytes(response, 8)).rejects.toBeInstanceOf(
      ResponseLimitError,
    );
    expect(cancelled).toBe(true);
  });

  it("cancels the underlying reader when streamed bytes exceed the limit", async () => {
    let cancelled = false;
    let index = 0;
    const chunks = [
      new TextEncoder().encode("1234"),
      new TextEncoder().encode("56789"),
    ];
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[index];
          index += 1;
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await expect(readLimitedResponseBytes(response, 8)).rejects.toMatchObject({
      maximumBytes: 8,
    });
    expect(cancelled).toBe(true);
  });

  it("rejects invalid UTF-8 and malformed JSON without returning partial data", async () => {
    await expect(
      readLimitedResponseText(new Response(new Uint8Array([0xc3, 0x28])), 2),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      readLimitedResponseJson(new Response("{"), 1),
    ).rejects.toBeInstanceOf(SyntaxError);
  });
});
