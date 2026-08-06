import { describe, expect, it } from "vitest";

import {
  detectImageMime,
  inspectImageMetadata,
  MAX_SOURCE_IMAGE_PIXELS,
} from "@/runtime/attachments/image-metadata";

describe("bounded image metadata", () => {
  it("reads dimensions from PNG, JPEG, WebP, and HEIC headers", async () => {
    await expect(inspectImageMetadata(pngBlob(640, 480))).resolves.toEqual({
      mimeType: "image/png",
      width: 640,
      height: 480,
    });
    await expect(inspectImageMetadata(jpegBlob(800, 600))).resolves.toEqual({
      mimeType: "image/jpeg",
      width: 800,
      height: 600,
    });
    await expect(inspectImageMetadata(webpBlob(1_024, 768))).resolves.toEqual({
      mimeType: "image/webp",
      width: 1_024,
      height: 768,
    });
    await expect(inspectImageMetadata(heicBlob(4_032, 3_024))).resolves.toEqual(
      {
        mimeType: "image/heic",
        width: 4_032,
        height: 3_024,
      },
    );
    await expect(
      inspectImageMetadata(heicBlob(1_920, 1_080, "mif1", "image/heif")),
    ).resolves.toEqual({
      mimeType: "image/heif",
      width: 1_920,
      height: 1_080,
    });
  });

  it("reads lossy and lossless WebP dimensions", async () => {
    await expect(
      inspectImageMetadata(lossyWebpBlob(320, 240)),
    ).resolves.toEqual({
      mimeType: "image/webp",
      width: 320,
      height: 240,
    });
    await expect(
      inspectImageMetadata(losslessWebpBlob(1_280, 720)),
    ).resolves.toEqual({
      mimeType: "image/webp",
      width: 1_280,
      height: 720,
    });
  });

  it("detects content rather than trusting the declared Blob type", async () => {
    await expect(detectImageMime(pngBlob(1, 1, "image/jpeg"))).resolves.toBe(
      "image/png",
    );
  });

  it("rejects missing dimensions and decompression-bomb pixel counts", async () => {
    await expect(
      inspectImageMetadata(
        new Blob(
          [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
          { type: "image/png" },
        ),
      ),
    ).rejects.toMatchObject({ code: "DIMENSIONS_UNAVAILABLE" });
    await expect(
      inspectImageMetadata(
        pngBlob(10_000, MAX_SOURCE_IMAGE_PIXELS / 10_000 + 1),
      ),
    ).rejects.toMatchObject({ code: "DIMENSIONS_TOO_LARGE" });
    await expect(
      inspectImageMetadata(pngBlob(16_385, 1)),
    ).rejects.toMatchObject({ code: "DIMENSIONS_TOO_LARGE" });
  });
});

function pngBlob(width: number, height: number, type = "image/png"): Blob {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeUint32(bytes, 8, 13);
  bytes.set(ascii("IHDR"), 12);
  writeUint32(bytes, 16, width);
  writeUint32(bytes, 20, height);
  return new Blob([bytes], { type });
}

function jpegBlob(width: number, height: number): Blob {
  const app0 = new Uint8Array(18);
  app0.set([0xff, 0xe0, 0x00, 0x10]);
  const startOfFrame = new Uint8Array(19);
  startOfFrame.set([0xff, 0xc0, 0x00, 0x11, 0x08]);
  writeUint16(startOfFrame, 5, height);
  writeUint16(startOfFrame, 7, width);
  startOfFrame[9] = 3;
  return bytesToBlob(
    joinBytes(new Uint8Array([0xff, 0xd8]), app0, startOfFrame),
    "image/jpeg",
  );
}

function webpBlob(width: number, height: number): Blob {
  const bytes = new Uint8Array(30);
  bytes.set(ascii("RIFF"), 0);
  writeUint32(bytes, 4, 22, true);
  bytes.set(ascii("WEBPVP8X"), 8);
  writeUint32(bytes, 16, 10, true);
  writeUint24(bytes, 24, width - 1);
  writeUint24(bytes, 27, height - 1);
  return new Blob([bytes], { type: "image/webp" });
}

function lossyWebpBlob(width: number, height: number): Blob {
  const bytes = new Uint8Array(30);
  bytes.set(ascii("RIFF"), 0);
  writeUint32(bytes, 4, 22, true);
  bytes.set(ascii("WEBPVP8 "), 8);
  writeUint32(bytes, 16, 10, true);
  bytes.set([0x9d, 0x01, 0x2a], 23);
  writeUint16(bytes, 26, width, true);
  writeUint16(bytes, 28, height, true);
  return new Blob([bytes], { type: "image/webp" });
}

function losslessWebpBlob(width: number, height: number): Blob {
  const widthBits = width - 1;
  const heightBits = height - 1;
  const bytes = new Uint8Array(26);
  bytes.set(ascii("RIFF"), 0);
  writeUint32(bytes, 4, 18, true);
  bytes.set(ascii("WEBPVP8L"), 8);
  writeUint32(bytes, 16, 5, true);
  bytes[20] = 0x2f;
  bytes[21] = widthBits & 0xff;
  bytes[22] = ((widthBits >> 8) & 0x3f) | ((heightBits & 0x03) << 6);
  bytes[23] = (heightBits >> 2) & 0xff;
  bytes[24] = (heightBits >> 10) & 0x0f;
  return new Blob([bytes], { type: "image/webp" });
}

function heicBlob(
  width: number,
  height: number,
  brand = "heic",
  type = "image/heic",
): Blob {
  const ispePayload = new Uint8Array(12);
  writeUint32(ispePayload, 4, width);
  writeUint32(ispePayload, 8, height);
  const metadata = box(
    "meta",
    joinBytes(
      new Uint8Array(4),
      box("iprp", box("ipco", box("ispe", ispePayload))),
    ),
  );
  return bytesToBlob(
    joinBytes(
      box("ftyp", joinBytes(ascii(brand), new Uint8Array(4), ascii("mif1"))),
      metadata,
    ),
    type,
  );
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(payload.byteLength + 8);
  writeUint32(output, 0, output.byteLength);
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

function writeUint16(
  bytes: Uint8Array,
  offset: number,
  value: number,
  littleEndian = false,
): void {
  new DataView(bytes.buffer).setUint16(offset, value, littleEndian);
}

function writeUint24(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
}

function writeUint32(
  bytes: Uint8Array,
  offset: number,
  value: number,
  littleEndian = false,
): void {
  new DataView(bytes.buffer).setUint32(offset, value, littleEndian);
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
