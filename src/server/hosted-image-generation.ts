import { inspectImageMetadata } from "@/runtime/attachments/image-metadata";
import { bytesToBlob } from "@/runtime/attachments/blob-utils";
import {
  hostedImageGenerationRequestSchema,
  imageGenerationResponseSchema,
  MAX_GENERATED_IMAGE_BYTES,
  MAX_IMAGE_GENERATION_REFERENCES,
  MAX_IMAGE_GENERATION_RESPONSE_BYTES,
} from "@/runtime/image-generation/image-generation-contract";
import { isImageGenerationSizeSupported } from "@/runtime/image-generation/image-generation-options";
import { redactSensitiveText } from "@/runtime/transport/chat-errors";
import {
  ERROR_RESPONSE_MAX_BYTES,
  readLimitedResponseBytes,
  readLimitedResponseJson,
  readLimitedResponseText,
  ResponseLimitError,
} from "@/runtime/transport/response-reader";
import type { FetchLike } from "@/runtime/transport/transport-http";
import {
  fetchWithRequestTimeouts,
  RequestTimeoutError,
} from "@/runtime/transport/request-timeout-policy";
import type { ServerConfig } from "@/server/config";
import {
  hostedRateLimitResponse,
  hostedRequestGuard,
  type HostedRequestGuard,
  type HostedRequestLease,
} from "@/server/hosted-request-guard";
import { requireHostedSession } from "@/server/hosted-session";
import {
  errorResponse,
  jsonResponse,
  securityErrorResponse,
} from "@/server/http";
import {
  assertSameOrigin,
  readRequestBytes,
  readRequestText,
  RequestSecurityError,
} from "@/server/security";

export async function handleHostedImageGeneration(
  request: Request,
  config: ServerConfig,
  fetchImplementation: FetchLike = fetch,
  requestGuard: HostedRequestGuard = hostedRequestGuard,
): Promise<Response> {
  let lease: HostedRequestLease | null = null;
  try {
    assertSameOrigin(request);
    const hosted = requireHostedSession(request, config.hosted);
    const imageConfig = hosted.imageGeneration;
    if (!imageConfig) {
      throw new RequestSecurityError(
        404,
        "UPSTREAM_NOT_FOUND",
        "Hosted image generation is unavailable",
      );
    }
    const profiles = imageConfig.profiles ?? [
      {
        id: "hosted-default",
        name: imageConfig.model,
        apiKey: imageConfig.apiKey,
        generationUrl: imageConfig.generationUrl,
        editUrl: imageConfig.editUrl,
        model: imageConfig.model,
        sizeMode: "auto" as const,
      },
    ];
    const declaredLength = Number(request.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > imageConfig.maximumRequestBytes
    ) {
      return errorResponse(413, "INVALID_REQUEST", "Request body is too large");
    }

    const contentType = request.headers.get("content-type") ?? "";
    let upstreamUrl: string;
    let upstreamBody: BodyInit;
    let selectedProfile: (typeof profiles)[number];
    const upstreamHeaders = new Headers({ Accept: "application/json" });
    if (contentType.startsWith("application/json")) {
      const text = await readRequestText(
        request,
        imageConfig.maximumRequestBytes,
      );
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return errorResponse(
          400,
          "INVALID_REQUEST",
          "Request body must be valid JSON",
        );
      }
      const parsed = hostedImageGenerationRequestSchema.safeParse(value);
      if (!parsed.success) {
        return errorResponse(
          400,
          "INVALID_REQUEST",
          "Invalid image generation request",
        );
      }
      const profile = profiles.find(
        ({ id }) =>
          id ===
          (parsed.data.profileId ??
            imageConfig.defaultProfileId ??
            profiles[0]?.id),
      );
      if (
        !profile ||
        !isImageGenerationSizeSupported(
          { modelId: profile.model, sizeMode: profile.sizeMode },
          parsed.data.size,
        )
      ) {
        return errorResponse(
          400,
          "INVALID_REQUEST",
          "Image generation profile or parameters are unavailable",
        );
      }
      selectedProfile = profile;
      upstreamUrl = profile.generationUrl;
      upstreamHeaders.set("Content-Type", "application/json");
      upstreamBody = JSON.stringify({
        model: profile.model,
        prompt: parsed.data.prompt,
        size: parsed.data.size,
        quality: parsed.data.quality,
        output_format: parsed.data.output_format,
        ...(parsed.data.output_compression === undefined
          ? {}
          : { output_compression: parsed.data.output_compression }),
        n: 1,
      });
    } else if (contentType.startsWith("multipart/form-data")) {
      const body = await readRequestBytes(
        request,
        imageConfig.maximumRequestBytes,
      );
      const form = await new Response(bytesToBlob(body, contentType), {
        headers: { "Content-Type": contentType },
      }).formData();
      const compressionValue = form.get("output_compression");
      const profileIdValue = form.get("profileId");
      const outputFormatValue = form.get("output_format");
      const parsed = hostedImageGenerationRequestSchema.safeParse({
        profileId: profileIdValue ?? undefined,
        model: form.get("model"),
        prompt: form.get("prompt"),
        size: form.get("size"),
        quality: form.get("quality"),
        output_format: outputFormatValue ?? undefined,
        ...(compressionValue === null
          ? {}
          : { output_compression: Number(compressionValue) }),
        n: form.get("n") === "1" ? 1 : form.get("n"),
      });
      const values = form.getAll("image[]");
      if (
        !parsed.success ||
        values.length === 0 ||
        values.length > MAX_IMAGE_GENERATION_REFERENCES ||
        values.some((value) => !(value instanceof File))
      ) {
        return errorResponse(
          400,
          "INVALID_REQUEST",
          "Invalid image edit request",
        );
      }
      const profile = profiles.find(
        ({ id }) =>
          id ===
          (parsed.data.profileId ??
            imageConfig.defaultProfileId ??
            profiles[0]?.id),
      );
      if (
        !profile ||
        !isImageGenerationSizeSupported(
          { modelId: profile.model, sizeMode: profile.sizeMode },
          parsed.data.size,
        )
      ) {
        return errorResponse(
          400,
          "INVALID_REQUEST",
          "Image generation profile or parameters are unavailable",
        );
      }
      selectedProfile = profile;
      const images = values as File[];
      for (const image of images) {
        try {
          const metadata = await inspectImageMetadata(image);
          if (
            metadata.mimeType !== "image/png" &&
            metadata.mimeType !== "image/jpeg" &&
            metadata.mimeType !== "image/webp"
          ) {
            return errorResponse(
              400,
              "INVALID_REQUEST",
              "Unsupported reference image",
            );
          }
        } catch {
          return errorResponse(
            400,
            "INVALID_REQUEST",
            "Unsupported reference image",
          );
        }
      }
      const rebuilt = new FormData();
      rebuilt.set("model", profile.model);
      rebuilt.set("prompt", parsed.data.prompt);
      rebuilt.set("size", parsed.data.size);
      rebuilt.set("quality", parsed.data.quality);
      rebuilt.set("output_format", parsed.data.output_format);
      if (parsed.data.output_compression !== undefined) {
        rebuilt.set(
          "output_compression",
          String(parsed.data.output_compression),
        );
      }
      rebuilt.set("n", "1");
      for (const image of images) {
        rebuilt.append("image[]", image, image.name);
      }
      upstreamUrl = profile.editUrl;
      upstreamBody = rebuilt;
    } else {
      return errorResponse(
        415,
        "INVALID_REQUEST",
        "Unsupported request content type",
      );
    }

    lease = requestGuard.tryAcquire("image-generation");
    if (!lease) {
      return hostedRateLimitResponse(
        "HOSTED_CONCURRENCY_LIMIT",
        "Hosted image generation capacity is temporarily unavailable",
      );
    }
    upstreamHeaders.set("Authorization", `Bearer ${selectedProfile.apiKey}`);

    const upstream = await fetchWithRequestTimeouts(
      upstreamUrl,
      {
        method: "POST",
        headers: upstreamHeaders,
        body: upstreamBody,
        cache: "no-store",
        signal: request.signal,
      },
      {
        firstByteMs: imageConfig.timeoutMs,
        firstBytePhase: "first-byte",
        idleMs: imageConfig.timeoutMs,
        totalMs: imageConfig.timeoutMs,
        totalPhase: "total",
      },
      fetchImplementation,
    );
    if (!upstream.ok) {
      const detail = redactSensitiveText(
        await readLimitedResponseText(upstream, ERROR_RESPONSE_MAX_BYTES),
      ).replaceAll(selectedProfile.apiKey, "[REDACTED]");
      return errorResponse(
        mapStatus(upstream.status),
        mapCode(upstream.status),
        "Upstream image generation failed",
        detail.slice(0, 4096) || undefined,
      );
    }
    const normalized = await normalizeHostedImageResponse(
      upstream,
      upstreamUrl,
      imageConfig.timeoutMs,
      request.signal,
      fetchImplementation,
    );
    return jsonResponse(normalized);
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      return errorResponse(
        504,
        "REQUEST_TIMEOUT",
        "Image generation timed out",
      );
    }
    if (request.signal.aborted) {
      return errorResponse(499, "ABORTED", "Image generation was cancelled");
    }
    if (error instanceof ResponseLimitError) {
      return errorResponse(
        502,
        "UPSTREAM_ERROR",
        "Image generation response is too large",
      );
    }
    return (
      securityErrorResponse(error) ??
      errorResponse(502, "UPSTREAM_ERROR", "Image generation failed")
    );
  } finally {
    lease?.release();
  }
}

async function normalizeHostedImageResponse(
  response: Response,
  upstreamUrl: string,
  timeoutMs: number,
  signal: AbortSignal,
  fetchImplementation: FetchLike,
): Promise<unknown> {
  let value: unknown;
  try {
    value = await readLimitedResponseJson(
      response,
      MAX_IMAGE_GENERATION_RESPONSE_BYTES,
      signal,
    );
  } catch (error) {
    if (error instanceof ResponseLimitError) throw error;
    throw new RequestSecurityError(
      502,
      "UPSTREAM_ERROR",
      "Image generation returned invalid JSON",
    );
  }
  const parsed = imageGenerationResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new RequestSecurityError(
      502,
      "UPSTREAM_ERROR",
      "Image generation returned an invalid response",
    );
  }
  const [item] = parsed.data.data;
  if (!item) {
    throw new RequestSecurityError(
      502,
      "UPSTREAM_ERROR",
      "Image generation returned an empty response",
    );
  }
  let b64Json = item.b64_json;
  if (!b64Json && item.url) {
    b64Json = await downloadHostedImage(
      item.url,
      upstreamUrl,
      timeoutMs,
      signal,
      fetchImplementation,
    );
  }
  if (!b64Json) {
    throw new RequestSecurityError(
      502,
      "UPSTREAM_ERROR",
      "Image generation returned an empty response",
    );
  }
  return {
    data: [
      {
        b64_json: b64Json,
        ...(item.revised_prompt ? { revised_prompt: item.revised_prompt } : {}),
      },
    ],
    ...(parsed.data.output_format
      ? { output_format: parsed.data.output_format }
      : {}),
  };
}

async function downloadHostedImage(
  value: string,
  upstreamUrl: string,
  timeoutMs: number,
  signal: AbortSignal,
  fetchImplementation: FetchLike,
): Promise<string> {
  let imageUrl: URL;
  try {
    imageUrl = new URL(value);
  } catch {
    throw new RequestSecurityError(
      502,
      "UPSTREAM_ERROR",
      "Image generation returned an invalid image URL",
    );
  }
  const trustedUpstream = new URL(upstreamUrl);
  if (
    imageUrl.protocol !== trustedUpstream.protocol ||
    imageUrl.username ||
    imageUrl.password ||
    imageUrl.hash ||
    imageUrl.origin !== trustedUpstream.origin
  ) {
    throw new RequestSecurityError(
      502,
      "UPSTREAM_ERROR",
      "Image generation returned an untrusted image URL",
    );
  }
  const imageResponse = await fetchWithRequestTimeouts(
    imageUrl,
    {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal,
    },
    {
      firstByteMs: timeoutMs,
      firstBytePhase: "first-byte",
      idleMs: timeoutMs,
      totalMs: timeoutMs,
      totalPhase: "total",
    },
    fetchImplementation,
  );
  if (!imageResponse.ok) {
    throw new RequestSecurityError(
      502,
      "UPSTREAM_ERROR",
      "Generated image could not be downloaded",
    );
  }
  const bytes = await readLimitedResponseBytes(
    imageResponse,
    MAX_GENERATED_IMAGE_BYTES,
    signal,
  );
  const blob = bytesToBlob(
    bytes,
    imageResponse.headers.get("content-type") ?? "",
  );
  try {
    const metadata = await inspectImageMetadata(blob);
    if (
      metadata.mimeType !== "image/png" &&
      metadata.mimeType !== "image/jpeg" &&
      metadata.mimeType !== "image/webp"
    ) {
      throw new TypeError("Unsupported image type");
    }
  } catch {
    throw new RequestSecurityError(
      502,
      "UPSTREAM_ERROR",
      "Generated image has an unsupported format",
    );
  }
  return Buffer.from(bytes).toString("base64");
}

function mapStatus(status: number): number {
  if ([400, 401, 403, 404, 413, 429].includes(status)) return status;
  return status >= 400 && status < 500 ? 400 : 502;
}

function mapCode(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "UPSTREAM_NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 400 && status < 500) return "INVALID_REQUEST";
  return "UPSTREAM_ERROR";
}
