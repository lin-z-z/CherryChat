import { readBlobBytes } from "@/runtime/attachments/blob-utils";

export const MAX_IMAGE_HEADER_BYTES = 1024 * 1024;
export const MAX_SOURCE_IMAGE_DIMENSION = 16_384;
export const MAX_SOURCE_IMAGE_PIXELS = 40_000_000;

export type SupportedImageMime =
  "image/png" | "image/jpeg" | "image/webp" | "image/heic" | "image/heif";

export interface ImageMetadata {
  mimeType: SupportedImageMime;
  width: number;
  height: number;
}

export type ImageMetadataErrorCode =
  "UNSUPPORTED_FORMAT" | "DIMENSIONS_UNAVAILABLE" | "DIMENSIONS_TOO_LARGE";

export class ImageMetadataError extends Error {
  constructor(
    readonly code: ImageMetadataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageMetadataError";
  }
}

export async function inspectImageMetadata(blob: Blob): Promise<ImageMetadata> {
  const bytes = await readBlobBytes(blob.slice(0, MAX_IMAGE_HEADER_BYTES));
  const mimeType = detectImageMimeBytes(bytes);
  if (!mimeType) {
    throw new ImageMetadataError(
      "UNSUPPORTED_FORMAT",
      "Image content is not PNG, JPEG, WebP, HEIC or HEIF",
    );
  }
  const dimensions = readDimensions(bytes, mimeType);
  if (!dimensions) {
    throw new ImageMetadataError(
      "DIMENSIONS_UNAVAILABLE",
      "Image dimensions could not be read from the bounded header",
    );
  }
  assertSafeImageDimensions(dimensions.width, dimensions.height);
  return { mimeType, ...dimensions };
}

export async function detectImageMime(
  blob: Blob,
): Promise<SupportedImageMime | null> {
  return detectImageMimeBytes(await readBlobBytes(blob.slice(0, 64)));
}

export function assertSafeImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    return invalidDimensions();
  }
  if (width <= 0 || height <= 0) return invalidDimensions();
  if (
    width > MAX_SOURCE_IMAGE_DIMENSION ||
    height > MAX_SOURCE_IMAGE_DIMENSION ||
    width * height > MAX_SOURCE_IMAGE_PIXELS
  ) {
    throw new ImageMetadataError(
      "DIMENSIONS_TOO_LARGE",
      "Image dimensions exceed the safe decode limit",
    );
  }
}

function invalidDimensions(): never {
  throw new ImageMetadataError(
    "DIMENSIONS_UNAVAILABLE",
    "Image dimensions are invalid",
  );
}

function detectImageMimeBytes(bytes: Uint8Array): SupportedImageMime | null {
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    )
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brands = new Set<string>();
    const declaredSize = readUint32(bytes, 0, false);
    const brandEnd = Math.min(
      bytes.length,
      declaredSize !== null && declaredSize >= 16 ? declaredSize : 16,
      64,
    );
    brands.add(ascii(bytes, 8, 12).toLowerCase());
    for (let offset = 16; offset + 4 <= brandEnd; offset += 4) {
      brands.add(ascii(bytes, offset, offset + 4).toLowerCase());
    }
    if (["heic", "heix", "hevc", "hevx"].some((brand) => brands.has(brand))) {
      return "image/heic";
    }
    if (["heif", "mif1", "msf1"].some((brand) => brands.has(brand))) {
      return "image/heif";
    }
  }
  return null;
}

function readDimensions(
  bytes: Uint8Array,
  mimeType: SupportedImageMime,
): { width: number; height: number } | null {
  if (mimeType === "image/png") return readPngDimensions(bytes);
  if (mimeType === "image/jpeg") return readJpegDimensions(bytes);
  if (mimeType === "image/webp") return readWebpDimensions(bytes);
  return readHeifDimensions(bytes);
}

function readPngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 24 || ascii(bytes, 12, 16) !== "IHDR") return null;
  const width = readUint32(bytes, 16, false);
  const height = readUint32(bytes, 20, false);
  return width === null || height === null ? null : { width, height };
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readJpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = readUint16(bytes, offset, false);
    if (segmentLength === null || segmentLength < 2) return null;
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 7 || offset + 7 > bytes.length) return null;
      const height = readUint16(bytes, offset + 3, false);
      const width = readUint16(bytes, offset + 5, false);
      return width === null || height === null ? null : { width, height };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, offset + 4);
    const chunkSize = readUint32(bytes, offset + 4, true);
    if (chunkSize === null) return null;
    const dataOffset = offset + 8;
    if (type === "VP8X" && chunkSize >= 10 && dataOffset + 10 <= bytes.length) {
      const width = readUint24(bytes, dataOffset + 4) + 1;
      const height = readUint24(bytes, dataOffset + 7) + 1;
      return { width, height };
    }
    if (
      type === "VP8 " &&
      chunkSize >= 10 &&
      dataOffset + 10 <= bytes.length &&
      bytes[dataOffset + 3] === 0x9d &&
      bytes[dataOffset + 4] === 0x01 &&
      bytes[dataOffset + 5] === 0x2a
    ) {
      const width = readUint16(bytes, dataOffset + 6, true);
      const height = readUint16(bytes, dataOffset + 8, true);
      return width === null || height === null
        ? null
        : { width: width & 0x3fff, height: height & 0x3fff };
    }
    if (
      type === "VP8L" &&
      chunkSize >= 5 &&
      dataOffset + 5 <= bytes.length &&
      bytes[dataOffset] === 0x2f
    ) {
      const first = bytes[dataOffset + 1] ?? 0;
      const second = bytes[dataOffset + 2] ?? 0;
      const third = bytes[dataOffset + 3] ?? 0;
      const fourth = bytes[dataOffset + 4] ?? 0;
      return {
        width: 1 + ((first | (second << 8)) & 0x3fff),
        height: 1 + (((second >> 6) | (third << 2) | (fourth << 10)) & 0x3fff),
      };
    }
    const nextOffset = dataOffset + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset || nextOffset > bytes.length) return null;
    offset = nextOffset;
  }
  return null;
}

const heifContainerBoxes = new Set([
  "meta",
  "iprp",
  "ipco",
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
]);

function readHeifDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let largest: { width: number; height: number } | null = null;
  const visit = (start: number, end: number, depth: number): void => {
    if (depth > 8) return;
    let offset = start;
    while (offset + 8 <= end) {
      const size32 = readUint32(bytes, offset, false);
      if (size32 === null) return;
      const type = ascii(bytes, offset + 4, offset + 8);
      let headerBytes = 8;
      let boxSize = size32;
      if (size32 === 1) {
        const extended = readUint64(bytes, offset + 8);
        if (extended === null) return;
        headerBytes = 16;
        boxSize = extended;
      } else if (size32 === 0) {
        boxSize = end - offset;
      }
      if (boxSize < headerBytes) return;
      const declaredEnd = offset + boxSize;
      if (!Number.isSafeInteger(declaredEnd) || declaredEnd <= offset) return;
      const availableEnd = Math.min(declaredEnd, end);
      const payloadStart = offset + headerBytes;
      if (type === "ispe" && payloadStart + 12 <= availableEnd) {
        const width = readUint32(bytes, payloadStart + 4, false);
        const height = readUint32(bytes, payloadStart + 8, false);
        if (width !== null && height !== null) {
          if (!largest || width * height > largest.width * largest.height) {
            largest = { width, height };
          }
        }
      } else if (heifContainerBoxes.has(type)) {
        const childStart = payloadStart + (type === "meta" ? 4 : 0);
        if (childStart < availableEnd)
          visit(childStart, availableEnd, depth + 1);
      }
      if (declaredEnd > end) return;
      offset = declaredEnd;
    }
  };
  visit(0, bytes.length, 0);
  return largest;
}

function readUint16(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): number | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint16(offset, littleEndian);
}

function readUint24(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function readUint32(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, littleEndian);
}

function readUint64(bytes: Uint8Array, offset: number): number | null {
  const high = readUint32(bytes, offset, false);
  const low = readUint32(bytes, offset + 4, false);
  if (high === null || low === null || high !== 0) return null;
  return low;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
