import {
  IMAGE_GENERATION_ASPECT_RATIOS,
  IMAGE_GENERATION_OUTPUT_FORMATS,
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_RESOLUTION_TIERS,
  type ImageGenerationAspectRatio,
  type ImageGenerationOutputFormat,
  type ImageGenerationParameters,
  type ImageGenerationProfile,
  type ImageGenerationQuality,
  type ImageGenerationResolutionTier,
} from "@/runtime/chat/types";

export interface EffectiveImageGenerationCapabilities {
  customSizes: boolean;
  resolutionTiers: readonly ImageGenerationResolutionTier[];
  aspectRatios: readonly ImageGenerationAspectRatio[];
  qualities: readonly ImageGenerationQuality[];
  outputFormats: readonly ImageGenerationOutputFormat[];
  outputCompression: boolean;
  references: boolean;
}

const SIZE_PATTERN = /^(\d+)x(\d+)$/u;
const MAX_EDGE = 3_840;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_ASPECT_RATIO = 3;

const COMMON_SIZE_PRESETS: Record<
  Exclude<ImageGenerationResolutionTier, "auto">,
  Record<ImageGenerationAspectRatio, string>
> = {
  "1K": {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "16:9": "1280x720",
    "9:16": "720x1280",
    "4:3": "1024x768",
    "3:4": "768x1024",
    "21:9": "1280x544",
  },
  "2K": {
    "1:1": "2048x2048",
    "3:2": "2160x1440",
    "2:3": "1440x2160",
    "16:9": "2560x1440",
    "9:16": "1440x2560",
    "4:3": "2048x1536",
    "3:4": "1536x2048",
    "21:9": "2560x1088",
  },
  "4K": {
    "1:1": "2880x2880",
    "3:2": "3456x2304",
    "2:3": "2304x3456",
    "16:9": "3840x2160",
    "9:16": "2160x3840",
    "4:3": "3200x2400",
    "3:4": "2400x3200",
    "21:9": "3840x1600",
  },
};

const LEGACY_RATIOS = ["1:1", "3:2", "2:3"] as const;

export const DEFAULT_IMAGE_GENERATION_PARAMETERS: ImageGenerationParameters = {
  resolutionTier: "1K",
  aspectRatio: "1:1",
  size: "1024x1024",
  quality: "auto",
  outputFormat: "png",
  outputCompression: null,
};

/**
 * 将自定义尺寸规整到图片接口可接受的边界。
 * GPT Image 要求 16px 倍数、最大边长和总像素数都在固定范围内。
 */
export function normalizeImageGenerationSize(value: string): string {
  if (value === "auto") return value;
  const match = SIZE_PATTERN.exec(value.trim());
  if (!match) return value.trim();

  let width = roundToMultiple(Number(match[1]), 16);
  let height = roundToMultiple(Number(match[2]), 16);
  const scaleToFit = (scale: number) => {
    width = Math.max(16, Math.floor((width * scale) / 16) * 16);
    height = Math.max(16, Math.floor((height * scale) / 16) * 16);
  };
  const scaleToFill = (scale: number) => {
    width = Math.max(16, Math.ceil((width * scale) / 16) * 16);
    height = Math.max(16, Math.ceil((height * scale) / 16) * 16);
  };

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const maxEdge = Math.max(width, height);
    if (maxEdge > MAX_EDGE) scaleToFit(MAX_EDGE / maxEdge);

    if (width / height > MAX_ASPECT_RATIO) {
      width = Math.max(16, Math.floor((height * MAX_ASPECT_RATIO) / 16) * 16);
    } else if (height / width > MAX_ASPECT_RATIO) {
      height = Math.max(16, Math.floor((width * MAX_ASPECT_RATIO) / 16) * 16);
    }

    const pixels = width * height;
    if (pixels > MAX_PIXELS) {
      scaleToFit(Math.sqrt(MAX_PIXELS / pixels));
    } else if (pixels < MIN_PIXELS) {
      scaleToFill(Math.sqrt(MIN_PIXELS / pixels));
    }
  }

  return `${width}x${height}`;
}

export function resolveImageGenerationCapabilities(
  profile: Pick<ImageGenerationProfile, "modelId" | "sizeMode">,
): EffectiveImageGenerationCapabilities {
  const customSizes =
    profile.sizeMode === "custom" ||
    (profile.sizeMode === "auto" && isGptImage2(profile.modelId));
  return {
    customSizes,
    resolutionTiers: customSizes
      ? IMAGE_GENERATION_RESOLUTION_TIERS
      : ["auto", "1K"],
    aspectRatios: customSizes ? IMAGE_GENERATION_ASPECT_RATIOS : LEGACY_RATIOS,
    qualities: IMAGE_GENERATION_QUALITIES,
    outputFormats: IMAGE_GENERATION_OUTPUT_FORMATS,
    outputCompression: true,
    references: true,
  };
}

export function calculateImageGenerationSize(
  tier: ImageGenerationResolutionTier,
  ratio: ImageGenerationAspectRatio,
): string {
  return tier === "auto" ? "auto" : COMMON_SIZE_PRESETS[tier][ratio];
}

export function normalizeImageGenerationParameters(
  value: Partial<ImageGenerationParameters> | null | undefined,
  profile: Pick<ImageGenerationProfile, "modelId" | "sizeMode">,
): ImageGenerationParameters {
  const capabilities = resolveImageGenerationCapabilities(profile);
  const requestedTier = isResolutionTier(value?.resolutionTier)
    ? value.resolutionTier
    : DEFAULT_IMAGE_GENERATION_PARAMETERS.resolutionTier;
  const resolutionTier = capabilities.resolutionTiers.includes(requestedTier)
    ? requestedTier
    : "1K";
  const requestedRatio = isAspectRatio(value?.aspectRatio)
    ? value.aspectRatio
    : DEFAULT_IMAGE_GENERATION_PARAMETERS.aspectRatio;
  const aspectRatio = capabilities.aspectRatios.includes(requestedRatio)
    ? requestedRatio
    : "1:1";
  const quality = isQuality(value?.quality)
    ? value.quality
    : DEFAULT_IMAGE_GENERATION_PARAMETERS.quality;
  const outputFormat = isOutputFormat(value?.outputFormat)
    ? value.outputFormat
    : DEFAULT_IMAGE_GENERATION_PARAMETERS.outputFormat;
  const requestedSize =
    typeof value?.size === "string" && value.size !== "auto"
      ? normalizeImageGenerationSize(value.size)
      : value?.size;
  const customSize =
    capabilities.customSizes &&
    typeof requestedSize === "string" &&
    requestedSize !== "auto" &&
    isValidImageGenerationSize(requestedSize)
      ? requestedSize
      : null;
  return {
    resolutionTier,
    aspectRatio,
    size:
      customSize ??
      (resolutionTier === "auto"
        ? "auto"
        : calculateImageGenerationSize(resolutionTier, aspectRatio)),
    quality,
    outputFormat,
    outputCompression:
      outputFormat === "png"
        ? null
        : normalizeOutputCompression(value?.outputCompression),
  };
}

export function parametersFromLegacySize(
  size: string,
  quality: ImageGenerationQuality,
): ImageGenerationParameters {
  if (size === "auto") {
    return {
      ...DEFAULT_IMAGE_GENERATION_PARAMETERS,
      resolutionTier: "auto",
      size,
      quality,
    };
  }
  for (const tier of ["1K", "2K", "4K"] as const) {
    for (const ratio of IMAGE_GENERATION_ASPECT_RATIOS) {
      if (COMMON_SIZE_PRESETS[tier][ratio] === size) {
        return {
          ...DEFAULT_IMAGE_GENERATION_PARAMETERS,
          resolutionTier: tier,
          aspectRatio: ratio,
          size,
          quality,
        };
      }
    }
  }
  const normalized = normalizeImageGenerationSize(size);
  return isValidImageGenerationSize(normalized)
    ? {
        ...DEFAULT_IMAGE_GENERATION_PARAMETERS,
        resolutionTier: "auto",
        size: normalized,
        quality,
      }
    : { ...DEFAULT_IMAGE_GENERATION_PARAMETERS, quality };
}

function roundToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

export function isValidImageGenerationSize(value: unknown): value is string {
  if (value === "auto") return true;
  if (typeof value !== "string") return false;
  const match = SIZE_PATTERN.exec(value);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_EDGE ||
    height > MAX_EDGE ||
    width % 16 !== 0 ||
    height % 16 !== 0
  ) {
    return false;
  }
  const pixels = width * height;
  return (
    pixels >= MIN_PIXELS &&
    pixels <= MAX_PIXELS &&
    Math.max(width / height, height / width) <= MAX_ASPECT_RATIO
  );
}

export function isImageGenerationSizeSupported(
  profile: Pick<ImageGenerationProfile, "modelId" | "sizeMode">,
  size: string,
): boolean {
  if (!isValidImageGenerationSize(size)) return false;
  if (size === "auto") return true;
  if (resolveImageGenerationCapabilities(profile).customSizes) return true;
  return ["1024x1024", "1536x1024", "1024x1536"].includes(size);
}

function isGptImage2(modelId: string): boolean {
  const normalized = modelId.normalize("NFKC").trim().toLowerCase();
  const bare = normalized.split("/").at(-1) ?? normalized;
  return /^gpt-image-2(?:-\d{4}-\d{2}-\d{2})?$/u.test(bare);
}

function isResolutionTier(
  value: unknown,
): value is ImageGenerationResolutionTier {
  return (
    typeof value === "string" &&
    (IMAGE_GENERATION_RESOLUTION_TIERS as readonly string[]).includes(value)
  );
}

function isAspectRatio(value: unknown): value is ImageGenerationAspectRatio {
  return (
    typeof value === "string" &&
    (IMAGE_GENERATION_ASPECT_RATIOS as readonly string[]).includes(value)
  );
}

function isQuality(value: unknown): value is ImageGenerationQuality {
  return (
    typeof value === "string" &&
    (IMAGE_GENERATION_QUALITIES as readonly string[]).includes(value)
  );
}

function isOutputFormat(value: unknown): value is ImageGenerationOutputFormat {
  return (
    typeof value === "string" &&
    (IMAGE_GENERATION_OUTPUT_FORMATS as readonly string[]).includes(value)
  );
}

function normalizeOutputCompression(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(100, Math.max(0, value))
    : 100;
}
