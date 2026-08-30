import { z } from "zod";

import { inspectImageMetadata } from "@/runtime/attachments/image-metadata";
import { sha256Blob } from "@/runtime/attachments/blob-utils";
import type { ProcessedImage } from "@/runtime/attachments/image-processor";
import {
  IMAGE_GENERATION_OUTPUT_FORMATS,
  IMAGE_GENERATION_QUALITIES,
  type AttachmentRecord,
  type ImageGenerationOutputFormat,
  type ImageGenerationQuality,
  type ImageGenerationSize,
} from "@/runtime/chat/types";
import { isValidImageGenerationSize } from "@/runtime/image-generation/image-generation-options";
import { ChatTransportError } from "@/runtime/transport/chat-errors";

export const MAX_IMAGE_GENERATION_REFERENCES = 16;
export const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_GENERATION_RESPONSE_BYTES = 32 * 1024 * 1024;
export const DEFAULT_IMAGE_GENERATION_BASE_URL = "https://api.openai.com";
export const IMAGE_GENERATION_PATH = "/v1/images/generations";
export const IMAGE_EDIT_PATH = "/v1/images/edits";
export const DEFAULT_IMAGE_GENERATION_MODEL = "gpt-image-2";

export interface ImageGenerationRequest {
  profileId?: string;
  modelId: string;
  prompt: string;
  size: ImageGenerationSize;
  quality: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
  outputCompression?: number | null;
  references: readonly AttachmentRecord[];
}

export interface ImageGenerationResult {
  images: ProcessedImage[];
  revisedPrompt: string | null;
}

export interface ImageGenerationEndpoint {
  baseUrl: string;
  apiKey: string;
  mode: "byok" | "hosted";
  /** Hosted credential sent only to the same-origin image route. */
  accessCode?: string | undefined;
}

const imageGenerationRequestShape = {
  model: z.string().trim().min(1).max(512),
  prompt: z.string().trim().min(1).max(32_000),
  size: z.string().refine(isValidImageGenerationSize),
  quality: z.enum(IMAGE_GENERATION_QUALITIES),
  output_format: z.enum(IMAGE_GENERATION_OUTPUT_FORMATS).default("png"),
  output_compression: z.number().int().min(0).max(100).optional(),
  n: z.literal(1),
};

export const imageGenerationRequestSchema = z
  .object(imageGenerationRequestShape)
  .strict()
  .superRefine(validateOutputCompression);

export const hostedImageGenerationRequestSchema = z
  .object({
    ...imageGenerationRequestShape,
    profileId: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .superRefine(validateOutputCompression);

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

export function normalizeImageBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Image API base URL must be absolute",
      null,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Image API base URL must use HTTP or HTTPS",
      null,
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Image API base URL cannot contain credentials, query parameters or fragments",
      null,
    );
  }
  let pathname = url.pathname.replace(/\/+$/u, "");
  for (const suffix of [
    "/v1/images/generations",
    "/v1/images/edits",
    "/images/generations",
    "/images/edits",
  ]) {
    if (pathname.endsWith(suffix)) {
      pathname = pathname.slice(0, -suffix.length).replace(/\/+$/u, "");
      break;
    }
  }
  url.pathname = pathname || "/";
  return url.toString().replace(/\/$/u, "");
}

export function imageGenerationUrl(baseUrl: string): string {
  return deriveImageEndpoint(baseUrl, IMAGE_GENERATION_PATH);
}

export function imageEditUrl(baseUrl: string): string {
  return deriveImageEndpoint(baseUrl, IMAGE_EDIT_PATH);
}

function deriveImageEndpoint(baseUrl: string, path: string): string {
  const normalized = normalizeImageBaseUrl(baseUrl);
  const url = new URL(normalized);
  const basePath = url.pathname.replace(/\/+$/u, "");
  const versionedPath = basePath.endsWith("/v1")
    ? `${basePath}${path.slice(3)}`
    : `${basePath}${path}`;
  url.pathname = versionedPath || "/";
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

function validateOutputCompression(
  value: {
    output_format: ImageGenerationOutputFormat;
    output_compression?: number | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (value.output_format === "png" && value.output_compression !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["output_compression"],
      message: "PNG output does not support output compression",
    });
  }
}
