import {
  generatedBlobToProcessedImage,
  imageGenerationRequestSchema,
  imageGenerationResponseSchema,
  imageEditUrl,
  imageGenerationUrl,
  MAX_GENERATED_IMAGE_BYTES,
  MAX_IMAGE_GENERATION_REFERENCES,
  MAX_IMAGE_GENERATION_RESPONSE_BYTES,
  type ImageGenerationEndpoint,
  type ImageGenerationRequest,
  type ImageGenerationResult,
} from "@/runtime/image-generation/image-generation-contract";
import { bytesToBlob } from "@/runtime/attachments/blob-utils";
import {
  ChatTransportError,
  errorCodeForStatus,
  redactSensitiveText,
} from "@/runtime/transport/chat-errors";
import {
  ERROR_RESPONSE_MAX_BYTES,
  readLimitedResponseBytes,
  readLimitedResponseJson,
  readLimitedResponseText,
  ResponseLimitError,
} from "@/runtime/transport/response-reader";
import type { FetchLike } from "@/runtime/transport/transport-http";

export interface ImageGenerationTransportOptions {
  endpoint: ImageGenerationEndpoint;
  fetchImplementation?: FetchLike;
}

export class OpenAICompatibleImageTransport {
  private readonly fetchImplementation: FetchLike;

  constructor(private readonly options: ImageGenerationTransportOptions) {
    this.fetchImplementation =
      options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
  }

  async generate(
    request: ImageGenerationRequest,
    signal?: AbortSignal,
  ): Promise<ImageGenerationResult> {
    if (request.references.length > MAX_IMAGE_GENERATION_REFERENCES) {
      throw new ChatTransportError(
        "INVALID_REQUEST",
        `At most ${MAX_IMAGE_GENERATION_REFERENCES} reference images are allowed`,
        null,
      );
    }
    const body = imageGenerationRequestSchema.parse({
      model: request.modelId,
      prompt: request.prompt,
      size: request.size,
      quality: request.quality,
      output_format: request.outputFormat ?? "png",
      ...(request.outputCompression == null
        ? {}
        : { output_compression: request.outputCompression }),
      n: 1,
    });
    const hasReferences = request.references.length > 0;
    const url =
      this.options.endpoint.mode === "hosted"
        ? "/api/image-generation"
        : hasReferences
          ? imageEditUrl(this.options.endpoint.baseUrl)
          : imageGenerationUrl(this.options.endpoint.baseUrl);
    const headers = new Headers({ Accept: "application/json" });
    const outputFormat = body.output_format ?? "png";
    if (this.options.endpoint.mode === "hosted") {
      headers.set("x-cherrychat-mode", "hosted");
    } else {
      headers.set("Authorization", `Bearer ${this.options.endpoint.apiKey}`);
    }

    let requestBody: BodyInit;
    if (hasReferences) {
      const formData = new FormData();
      formData.set("model", body.model);
      formData.set("prompt", body.prompt);
      formData.set("size", body.size);
      formData.set("quality", body.quality);
      formData.set("output_format", outputFormat);
      if (body.output_compression !== undefined) {
        formData.set("output_compression", String(body.output_compression));
      }
      if (this.options.endpoint.mode === "hosted" && request.profileId) {
        formData.set("profileId", request.profileId);
      }
      formData.set("n", "1");
      for (const [index, reference] of request.references.entries()) {
        formData.append(
          "image[]",
          reference.blob,
          `reference-${index + 1}.${extensionForMime(reference.mimeType)}`,
        );
      }
      requestBody = formData;
    } else {
      headers.set("Content-Type", "application/json");
      requestBody = JSON.stringify(
        this.options.endpoint.mode === "hosted"
          ? { ...body, profileId: request.profileId }
          : body,
      );
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "POST",
        headers,
        body: requestBody,
        cache: "no-store",
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      if (signal?.aborted) {
        throw new ChatTransportError("ABORTED", "Request was cancelled", null);
      }
      throw new ChatTransportError(
        "CORS_OR_NETWORK",
        "The browser could not reach the image service",
        null,
        cause instanceof Error ? redactSensitiveText(cause.message) : undefined,
      );
    }
    if (!response.ok) {
      const detail = redactSensitiveText(
        await readLimitedResponseText(response, ERROR_RESPONSE_MAX_BYTES),
      ).slice(0, 4096);
      throw new ChatTransportError(
        errorCodeForStatus(response.status),
        "Image generation request failed",
        response.status,
        detail || undefined,
      );
    }

    let value: unknown;
    try {
      value = await readLimitedResponseJson(
        response,
        MAX_IMAGE_GENERATION_RESPONSE_BYTES,
        signal,
      );
    } catch (cause) {
      if (signal?.aborted) {
        throw new ChatTransportError("ABORTED", "Request was cancelled", null);
      }
      throw new ChatTransportError(
        "STREAM_PROTOCOL_ERROR",
        cause instanceof ResponseLimitError
          ? "Image service response is too large"
          : "Image service returned invalid JSON",
        response.status,
      );
    }
    const parsed = imageGenerationResponseSchema.safeParse(value);
    if (!parsed.success) {
      throw new ChatTransportError(
        "STREAM_PROTOCOL_ERROR",
        "Image service returned an invalid response",
        response.status,
      );
    }
    const images = await Promise.all(
      parsed.data.data.map(async (item) => {
        const blob = item.b64_json
          ? decodeBase64Image(
              item.b64_json,
              parsed.data.output_format ?? request.outputFormat,
            )
          : item.url
            ? await this.downloadImage(item.url, signal)
            : null;
        if (!blob) {
          throw new ChatTransportError(
            "STREAM_PROTOCOL_ERROR",
            "Image service returned an empty result",
            response.status,
          );
        }
        return generatedBlobToProcessedImage(blob);
      }),
    );
    return {
      images,
      revisedPrompt:
        parsed.data.data.find(({ revised_prompt }) => revised_prompt)
          ?.revised_prompt ?? null,
    };
  }

  private async downloadImage(
    url: string,
    signal?: AbortSignal,
  ): Promise<Blob> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      if (signal?.aborted) {
        throw new ChatTransportError("ABORTED", "Request was cancelled", null);
      }
      throw new ChatTransportError(
        "CORS_OR_NETWORK",
        "Generated image could not be downloaded",
        null,
        cause instanceof Error ? redactSensitiveText(cause.message) : undefined,
      );
    }
    if (!response.ok) {
      throw new ChatTransportError(
        errorCodeForStatus(response.status),
        "Generated image could not be downloaded",
        response.status,
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_GENERATED_IMAGE_BYTES
    ) {
      throw new ChatTransportError(
        "INVALID_REQUEST",
        "Generated image is too large",
        response.status,
      );
    }
    try {
      const bytes = await readLimitedResponseBytes(
        response,
        MAX_GENERATED_IMAGE_BYTES,
        signal,
      );
      return bytesToBlob(bytes, response.headers.get("content-type") ?? "");
    } catch (cause) {
      if (signal?.aborted) {
        throw new ChatTransportError("ABORTED", "Request was cancelled", null);
      }
      throw new ChatTransportError(
        cause instanceof ResponseLimitError
          ? "INVALID_REQUEST"
          : "CORS_OR_NETWORK",
        cause instanceof ResponseLimitError
          ? "Generated image is too large"
          : "Generated image could not be downloaded",
        response.status,
      );
    }
  }
}

function decodeBase64Image(value: string, format?: string): Blob {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new ChatTransportError(
      "STREAM_PROTOCOL_ERROR",
      "Image service returned invalid Base64 data",
      null,
    );
  }
  if (binary.length > MAX_GENERATED_IMAGE_BYTES) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "Generated image is too large",
      null,
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeForFormat(format) });
}

function mimeForFormat(format?: string): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function extensionForMime(mimeType: string): "png" | "jpg" | "webp" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}
