import { describe, expect, it, vi } from "vitest";

import type { AttachmentRecord } from "@/runtime/chat/types";
import { OpenAICompatibleImageTransport } from "@/runtime/image-generation/openai-compatible-image-transport";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("OpenAICompatibleImageTransport", () => {
  it("sends JSON to the generation URL without references", async () => {
    const { calls, fetchMock } = createFetchMock();
    const transport = createTransport(fetchMock);

    const result = await transport.generate(request([]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = calls[0] ?? [];
    expect(url).toBe("https://images.example.test/v1/images/generations");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-image-test",
      prompt: "Draw a cherry",
      size: "1024x1024",
      quality: "auto",
      n: 1,
    });
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mimeType).toBe("image/png");
  });

  it("preserves reference order in repeated multipart image fields", async () => {
    const { calls, fetchMock } = createFetchMock();
    const first = attachment("first", "image/png");
    const second = attachment("second", "image/jpeg");

    await createTransport(fetchMock).generate(request([first, second]));

    const [url, init] = calls[0] ?? [];
    expect(url).toBe("https://images.example.test/v1/images/edits");
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    const form = init?.body as FormData;
    expect(form.getAll("image[]").map((value) => (value as File).name)).toEqual(
      ["reference-1.png", "reference-2.jpg"],
    );
    expect(form.get("model")).toBe("gpt-image-test");
  });

  it("uses only the fixed same-origin route in Hosted mode", async () => {
    const { calls, fetchMock } = createFetchMock();
    const transport = new OpenAICompatibleImageTransport({
      endpoint: {
        mode: "hosted",
        apiKey: "",
        generationUrl: "https://should-not-leak.example/generations",
        editUrl: "https://should-not-leak.example/edits",
      },
      fetchImplementation: fetchMock,
    });

    await transport.generate(request([]));

    const [url, init] = calls[0] ?? [];
    expect(url).toBe("/api/image-generation");
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
    expect(new Headers(init?.headers).get("x-cherrychat-mode")).toBe("hosted");
  });

  it("keeps the browser receiver when using the default fetch", async () => {
    const browserFetch = vi.fn(async function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Response.json({ data: [{ b64_json: PNG_BASE64 }] });
    }) as typeof fetch;
    vi.stubGlobal("fetch", browserFetch);

    try {
      const transport = new OpenAICompatibleImageTransport({
        endpoint: {
          mode: "byok",
          apiKey: "sk-test-image-key",
          generationUrl: "https://images.example.test/v1/images/generations",
          editUrl: "https://images.example.test/v1/images/edits",
        },
      });

      await expect(transport.generate(request([]))).resolves.toMatchObject({
        images: [{ mimeType: "image/png" }],
      });
      expect(browserFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function createTransport(fetchImplementation: typeof fetch) {
  return new OpenAICompatibleImageTransport({
    endpoint: {
      mode: "byok",
      apiKey: "sk-test-image-key",
      generationUrl: "https://images.example.test/v1/images/generations",
      editUrl: "https://images.example.test/v1/images/edits",
    },
    fetchImplementation,
  });
}

function createFetchMock() {
  const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    calls.push([input, init]);
    return Response.json({ data: [{ b64_json: PNG_BASE64 }] });
  });
  return { calls, fetchMock };
}

function request(references: AttachmentRecord[]) {
  return {
    modelId: "gpt-image-test",
    prompt: "Draw a cherry",
    size: "1024x1024" as const,
    quality: "auto" as const,
    references,
  };
}

function attachment(id: string, mimeType: string): AttachmentRecord {
  return {
    id,
    blob: new Blob([id], { type: mimeType }),
    mimeType,
    width: 1,
    height: 1,
    byteSize: id.length,
    sha256: id.padEnd(64, "0"),
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}
