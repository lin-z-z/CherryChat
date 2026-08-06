import { describe, expect, it, vi } from "vitest";

import {
  detectImageMime,
  ImageProcessingError,
  ImageProcessor,
  ImageSelectionProcessor,
  type DecodedImage,
  type ImageCodec,
} from "@/runtime/attachments/image-processor";

const decoded: DecodedImage = {
  width: 4000,
  height: 2000,
  source: {} as CanvasImageSource,
  close: vi.fn(),
};

describe("image processing", () => {
  it("detects content signatures instead of trusting the declared MIME", async () => {
    expect(await detectImageMime(pngBlob("image/jpeg"))).toBe("image/png");
    expect(
      await detectImageMime(new Blob(["not an image"], { type: "image/png" })),
    ).toBeNull();
  });

  it("iterates dimensions and quality until the encoded image fits", async () => {
    const encode = vi.fn(
      async (
        _image: DecodedImage,
        options: { width: number; height: number; quality: number },
      ) => {
        const size = Math.ceil(
          options.width * options.height * options.quality * 0.2,
        );
        return new Blob([new Uint8Array(size)], { type: "image/webp" });
      },
    );
    const codec: ImageCodec = {
      decode: async () => decoded,
      encode,
    };
    const result = await new ImageProcessor({ codec }).process(pngBlob());

    expect(result.mimeType).toBe("image/webp");
    expect(result.byteSize).toBeLessThanOrEqual(256 * 1024);
    expect(result.width).toBeLessThanOrEqual(2048);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(encode).toHaveBeenCalled();
  });

  it("dynamically converts HEIC content before decoding", async () => {
    const convertHeic = vi.fn(async () => jpegBlob());
    const codec: ImageCodec = {
      decode: async () => ({ ...decoded, width: 100, height: 100 }),
      encode: async () =>
        new Blob([new Uint8Array(100)], { type: "image/jpeg" }),
    };
    const result = await new ImageProcessor({ codec, convertHeic }).process(
      heicBlob(),
    );

    expect(convertHeic).toHaveBeenCalledOnce();
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("rejects a fourth image before doing any processing", async () => {
    const processor = new ImageProcessor();
    const selection = new ImageSelectionProcessor(processor);
    const existing = [1, 2, 3].map((index) => ({
      blob: new Blob(),
      mimeType: "image/webp" as const,
      width: index,
      height: index,
      byteSize: 0,
      sha256: String(index),
    }));

    await expect(selection.add(existing, [pngBlob()])).rejects.toMatchObject({
      code: "TOO_MANY_IMAGES",
    } satisfies Partial<ImageProcessingError>);
  });

  it("rejects undecodable content and inconsistent HEIC conversion output", async () => {
    const brokenCodec: ImageCodec = {
      decode: async () => {
        throw new Error("decode failed");
      },
      encode: async () => new Blob(),
    };
    await expect(
      new ImageProcessor({ codec: brokenCodec }).process(pngBlob()),
    ).rejects.toMatchObject({ code: "DECODE_FAILED" });

    await expect(
      new ImageProcessor({
        codec: brokenCodec,
        convertHeic: async () => pngBlob(),
      }).process(heicBlob()),
    ).rejects.toMatchObject({ code: "DECODE_FAILED" });
  });

  it("rejects unsafe dimensions before decode or HEIC conversion", async () => {
    const decode = vi.fn(async () => decoded);
    const convertHeic = vi.fn(async () => jpegBlob());
    const processor = new ImageProcessor({
      codec: { decode, encode: async () => new Blob() },
      convertHeic,
    });

    await expect(
      processor.process(pngBlob("image/png", 10_000, 5_000)),
    ).rejects.toMatchObject({
      code: "SOURCE_DIMENSIONS_TOO_LARGE",
    });
    await expect(
      processor.process(heicBlob(10_000, 5_000)),
    ).rejects.toMatchObject({
      code: "SOURCE_DIMENSIONS_TOO_LARGE",
    });
    expect(decode).not.toHaveBeenCalled();
    expect(convertHeic).not.toHaveBeenCalled();
  });

  it("checks converted HEIC dimensions before codec decoding", async () => {
    const decode = vi.fn(async () => decoded);
    const convertHeic = vi.fn(async () => jpegBlob(10_000, 5_000));
    const processor = new ImageProcessor({
      codec: { decode, encode: async () => new Blob() },
      convertHeic,
    });

    await expect(processor.process(heicBlob())).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });
    expect(convertHeic).toHaveBeenCalledOnce();
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects a decoder result that disagrees with the bounded header", async () => {
    const close = vi.fn();
    const processor = new ImageProcessor({
      codec: {
        decode: async () => ({ ...decoded, width: 10, height: 10, close }),
        encode: async () => new Blob(),
      },
    });

    await expect(processor.process(pngBlob())).rejects.toMatchObject({
      code: "DECODE_FAILED",
    });
    expect(close).toHaveBeenCalledOnce();
  });
});

function pngBlob(type = "image/png", width = 4_000, height = 2_000): Blob {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(8, 13, false);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return new Blob([bytes], { type });
}

function jpegBlob(width = 100, height = 100): Blob {
  const bytes = new Uint8Array(23);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  new DataView(bytes.buffer).setUint16(7, height, false);
  new DataView(bytes.buffer).setUint16(9, width, false);
  bytes[11] = 3;
  return new Blob([bytes], { type: "image/jpeg" });
}

function heicBlob(width = 100, height = 100): Blob {
  const ispePayload = new Uint8Array(12);
  new DataView(ispePayload.buffer).setUint32(4, width, false);
  new DataView(ispePayload.buffer).setUint32(8, height, false);
  const bytes = joinBytes(
    box("ftyp", joinBytes(ascii("heic"), new Uint8Array(4))),
    box(
      "meta",
      joinBytes(
        new Uint8Array(4),
        box("iprp", box("ipco", box("ispe", ispePayload))),
      ),
    ),
  );
  return bytesToBlob(bytes, "image/heic");
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(payload.byteLength + 8);
  new DataView(output.buffer).setUint32(0, output.byteLength, false);
  output.set(ascii(type), 4);
  output.set(payload, 8);
  return output;
}

function joinBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type });
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
