import {
  ImageProcessingError,
  ImageProcessor,
  type ProcessedImage,
} from "@/runtime/attachments/image-processor";
import type { AttachmentRecord } from "@/runtime/chat/types";
import { MAX_IMAGE_GENERATION_REFERENCES } from "@/runtime/image-generation/image-generation-contract";

export const TARGET_IMAGE_REFERENCE_BYTES = 1024 * 1024;
export const MAX_IMAGE_REFERENCE_DIMENSION = 3072;
export const DEFAULT_IMAGE_REFERENCE_MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const MULTIPART_BUDGET_BYTES = 64 * 1024;

export class ImageReferenceProcessor {
  private readonly processor: ImageProcessor;

  constructor(
    processor = new ImageProcessor({
      targetBytes: TARGET_IMAGE_REFERENCE_BYTES,
      maximumDimension: MAX_IMAGE_REFERENCE_DIMENSION,
    }),
  ) {
    this.processor = processor;
  }

  async add(
    selected: readonly AttachmentRecord[],
    incoming: readonly Blob[],
    maximumRequestBytes = DEFAULT_IMAGE_REFERENCE_MAX_REQUEST_BYTES,
  ): Promise<ProcessedImage[]> {
    const knownHashes = new Set(selected.map(({ sha256 }) => sha256));
    let totalBytes = selected.reduce(
      (sum, attachment) => sum + attachment.byteSize,
      MULTIPART_BUDGET_BYTES,
    );
    const processed: ProcessedImage[] = [];
    for (const image of incoming) {
      const candidate = await this.processor.process(image);
      if (knownHashes.has(candidate.sha256)) continue;
      if (
        selected.length + processed.length >=
        MAX_IMAGE_GENERATION_REFERENCES
      ) {
        throw new ImageProcessingError(
          "TOO_MANY_IMAGES",
          `Image generation accepts at most ${MAX_IMAGE_GENERATION_REFERENCES} reference images`,
        );
      }
      totalBytes += candidate.byteSize;
      if (totalBytes > maximumRequestBytes) {
        throw new ImageProcessingError(
          "SOURCE_TOO_LARGE",
          "Reference images exceed the image generation request limit",
        );
      }
      knownHashes.add(candidate.sha256);
      processed.push(candidate);
    }
    return processed;
  }

  assertRequestBudget(
    references: readonly AttachmentRecord[],
    maximumRequestBytes = DEFAULT_IMAGE_REFERENCE_MAX_REQUEST_BYTES,
  ): void {
    if (references.length > MAX_IMAGE_GENERATION_REFERENCES) {
      throw new ImageProcessingError(
        "TOO_MANY_IMAGES",
        `Image generation accepts at most ${MAX_IMAGE_GENERATION_REFERENCES} reference images`,
      );
    }
    const totalBytes = references.reduce(
      (sum, attachment) => sum + attachment.byteSize,
      MULTIPART_BUDGET_BYTES,
    );
    if (totalBytes > maximumRequestBytes) {
      throw new ImageProcessingError(
        "SOURCE_TOO_LARGE",
        "Reference images exceed the image generation request limit",
      );
    }
  }
}
