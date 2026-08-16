import { sha256Blob } from "@/runtime/attachments/blob-utils";
import {
  ImageMetadataError,
  inspectImageMetadata,
} from "@/runtime/attachments/image-metadata";

export { detectImageMime } from "@/runtime/attachments/image-metadata";
export type { SupportedImageMime } from "@/runtime/attachments/image-metadata";

export const MAX_IMAGES_PER_MESSAGE = 3;
export const TARGET_IMAGE_BYTES = 256 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;

export type OutputImageMime = "image/jpeg" | "image/webp";
export type PersistedImageMime = "image/png" | OutputImageMime;

export interface DecodedImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
}

export interface ImageCodec {
  decode(blob: Blob): Promise<DecodedImage>;
  encode(
    image: DecodedImage,
    options: {
      width: number;
      height: number;
      mimeType: OutputImageMime;
      quality: number;
    },
  ): Promise<Blob>;
}

export interface ProcessedImage {
  blob: Blob;
  mimeType: PersistedImageMime;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
}

export type ImageProcessingErrorCode =
  | "TOO_MANY_IMAGES"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_DIMENSIONS_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "DECODE_FAILED"
  | "COMPRESSION_FAILED";

export class ImageProcessingError extends Error {
  constructor(
    readonly code: ImageProcessingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ImageProcessingError";
  }
}

export interface ImageProcessorOptions {
  codec?: ImageCodec;
  convertHeic?: (blob: Blob) => Promise<Blob>;
  targetBytes?: number;
  maximumDimension?: number;
}

const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35] as const;

export class ImageProcessor {
  private readonly codec: ImageCodec;
  private readonly convertHeic: (blob: Blob) => Promise<Blob>;
  private readonly targetBytes: number;
  private readonly maximumDimension: number;

  constructor(options: ImageProcessorOptions = {}) {
    this.codec = options.codec ?? new BrowserImageCodec();
    this.convertHeic = options.convertHeic ?? convertHeicToJpeg;
    this.targetBytes = options.targetBytes ?? TARGET_IMAGE_BYTES;
    this.maximumDimension = options.maximumDimension ?? 2048;
  }

  async process(source: Blob): Promise<ProcessedImage> {
    if (source.size > MAX_SOURCE_IMAGE_BYTES) {
      throw new ImageProcessingError(
        "SOURCE_TOO_LARGE",
        `Image cannot exceed ${MAX_SOURCE_IMAGE_BYTES} bytes`,
      );
    }
    const sourceMetadata = await readSourceMetadata(source);
    const detectedMime = sourceMetadata.mimeType;

    let decodableBlob = source;
    let expectedWidth = sourceMetadata.width;
    let expectedHeight = sourceMetadata.height;
    let outputMime: OutputImageMime =
      detectedMime === "image/jpeg" ||
      detectedMime === "image/heic" ||
      detectedMime === "image/heif"
        ? "image/jpeg"
        : "image/webp";
    if (detectedMime === "image/heic" || detectedMime === "image/heif") {
      try {
        decodableBlob = await this.convertHeic(source);
        const convertedMetadata = await inspectImageMetadata(decodableBlob);
        if (convertedMetadata.mimeType !== "image/jpeg") {
          throw new Error("HEIC converter did not return JPEG content");
        }
        expectedWidth = convertedMetadata.width;
        expectedHeight = convertedMetadata.height;
        outputMime = "image/jpeg";
      } catch (error) {
        throw new ImageProcessingError(
          "DECODE_FAILED",
          "HEIC/HEIF conversion failed",
          { cause: error },
        );
      }
    }

    let decoded: DecodedImage;
    try {
      decoded = await this.codec.decode(decodableBlob);
    } catch (error) {
      throw new ImageProcessingError("DECODE_FAILED", "Image decoding failed", {
        cause: error,
      });
    }

    try {
      if (
        decoded.width !== expectedWidth ||
        decoded.height !== expectedHeight
      ) {
        throw new ImageProcessingError(
          "DECODE_FAILED",
          "Decoded image dimensions do not match the image header",
        );
      }
      let { width, height } = fitWithin(
        decoded.width,
        decoded.height,
        this.maximumDimension,
      );
      for (let scaleAttempt = 0; scaleAttempt < 12; scaleAttempt += 1) {
        for (const quality of QUALITY_STEPS) {
          const blob = await this.codec.encode(decoded, {
            width,
            height,
            mimeType: outputMime,
            quality,
          });
          if (blob.size <= this.targetBytes) {
            return {
              blob,
              mimeType: outputMime,
              width,
              height,
              byteSize: blob.size,
              sha256: await sha256Blob(blob),
            };
          }
        }
        if (Math.max(width, height) <= 256) break;
        width = Math.floor(width * 0.8);
        height = Math.floor(height * 0.8);
        width = Math.max(1, width);
        height = Math.max(1, height);
      }
    } finally {
      decoded.close();
    }

    throw new ImageProcessingError(
      "COMPRESSION_FAILED",
      "Image could not be compressed to the request size limit",
    );
  }
}

export class ImageSelectionProcessor {
  constructor(private readonly processor: ImageProcessor) {}

  async add(
    selected: readonly ProcessedImage[],
    incoming: readonly Blob[],
  ): Promise<ProcessedImage[]> {
    if (selected.length + incoming.length > MAX_IMAGES_PER_MESSAGE) {
      throw new ImageProcessingError(
        "TOO_MANY_IMAGES",
        `A message can contain at most ${MAX_IMAGES_PER_MESSAGE} images`,
      );
    }
    const processed: ProcessedImage[] = [];
    for (const image of incoming)
      processed.push(await this.processor.process(image));
    return [...selected, ...processed];
  }
}

class BrowserImageCodec implements ImageCodec {
  async decode(blob: Blob): Promise<DecodedImage> {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  }

  async encode(
    image: DecodedImage,
    options: {
      width: number;
      height: number;
      mimeType: OutputImageMime;
      quality: number;
    },
  ): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = options.width;
    canvas.height = options.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.drawImage(image.source, 0, 0, options.width, options.height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Canvas encoding failed")),
        options.mimeType,
        options.quality,
      );
    });
  }
}

async function convertHeicToJpeg(blob: Blob): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({
    blob,
    toType: "image/jpeg",
    quality: 0.9,
  });
  return Array.isArray(converted)
    ? (converted[0] ?? Promise.reject(new Error("Empty HEIC conversion")))
    : converted;
}

function fitWithin(
  width: number,
  height: number,
  maximumDimension: number,
): { width: number; height: number } {
  const scale = Math.min(1, maximumDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function readSourceMetadata(blob: Blob) {
  try {
    return await inspectImageMetadata(blob);
  } catch (error) {
    if (error instanceof ImageMetadataError) {
      if (error.code === "UNSUPPORTED_FORMAT") {
        throw new ImageProcessingError("UNSUPPORTED_FORMAT", error.message, {
          cause: error,
        });
      }
      if (error.code === "DIMENSIONS_TOO_LARGE") {
        throw new ImageProcessingError(
          "SOURCE_DIMENSIONS_TOO_LARGE",
          error.message,
          { cause: error },
        );
      }
    }
    throw new ImageProcessingError(
      "DECODE_FAILED",
      "Image dimensions could not be validated before decoding",
      { cause: error },
    );
  }
}
