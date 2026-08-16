import { z } from "zod";

import { inspectImageMetadata } from "@/runtime/attachments/image-metadata";
import { sha256Blob } from "@/runtime/attachments/blob-utils";
import type { ProcessedImage } from "@/runtime/attachments/image-processor";
import {
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_SIZES,
  type AttachmentRecord,
  type ImageGenerationQuality,
  type ImageGenerationSize,
} from "@/runtime/chat/types";
import { ChatTransportError } from "@/runtime/transport/chat-errors";

export const MAX_IMAGE_GENERATION_REFERENCES = 16;
export const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_GENERATION_RESPONSE_BYTES = 32 * 1024 * 1024;
export const DEFAULT_IMAGE_GENERATION_URL =
  "https://api.openai.com/v1/images/generations";
export const DEFAULT_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";
export const DEFAULT_IMAGE_GENERATION_MODEL = "gpt-image-1.5";

export interface ImageGenerationRequest {
  modelId: string;
  prompt: string;
  size: ImageGenerationSize;
  quality: ImageGenerationQuality;
  references: readonly AttachmentRecord[];
}

export interface ImageGenerationResult {
  images: ProcessedImage[];
  revisedPrompt: string | null;
}

export interface ImageGenerationEndpoint {
  generationUrl: string;
  editUrl: string;
  apiKey: string;
  mode: "byok" | "hosted";
}

export const imageGenerationRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(512),
    prompt: z.string().trim().min(1).max(32_000),
    size: z.enum(IMAGE_GENERATION_SIZES),
    quality: z.enum(IMAGE_GENERATION_QUALITIES),
    n: z.literal(1),
  })
  .strict();

export const imageGenerationResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            b64_json: z.string().min(1).optional(),
            url: z.string().url().optional(),
            revised_prompt: z.string().optional(),
          })
          .passthrough(),
      )
      .length(1),
    output_format: z.enum(["png", "jpeg", "webp"]).optional(),
  })
  .passthrough();

export function normalizeImageEndpointUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Image API URL must be absolute",
      null,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Image API URL must use HTTP or HTTPS",
      null,
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Image API URL cannot contain credentials, query parameters or fragments",
      null,
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

export async function generatedBlobToProcessedImage(
  blob: Blob,
): Promise<ProcessedImage> {
  if (blob.size === 0 || blob.size > MAX_GENERATED_IMAGE_BYTES) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Generated image has an invalid size",
      null,
    );
  }
  let metadata: Awaited<ReturnType<typeof inspectImageMetadata>>;
  try {
    metadata = await inspectImageMetadata(blob);
  } catch {
    throw new ChatTransportError(
      "STREAM_PROTOCOL_ERROR",
      "Generated image has an unsupported format",
      null,
    );
  }
  if (
    metadata.mimeType !== "image/png" &&
    metadata.mimeType !== "image/jpeg" &&
    metadata.mimeType !== "image/webp"
  ) {
    throw new ChatTransportError(
      "STREAM_PROTOCOL_ERROR",
      "Generated image has an unsupported format",
      null,
    );
  }
  const normalized =
    blob.type === metadata.mimeType
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: metadata.mimeType });
  return {
    blob: normalized,
    mimeType: metadata.mimeType,
    width: metadata.width,
    height: metadata.height,
    byteSize: normalized.size,
    sha256: await sha256Blob(normalized),
  };
}
