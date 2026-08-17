import { describe, expect, it } from "vitest";

import type { ImageGenerationProfile } from "@/runtime/chat/types";
import {
  isValidImageGenerationSize,
  normalizeImageGenerationParameters,
  normalizeImageGenerationSize,
  parametersFromLegacySize,
  resolveImageGenerationCapabilities,
} from "@/runtime/image-generation/image-generation-options";

describe("image generation options", () => {
  it.each([
    ["2K", "1440x2560"],
    ["4K", "2160x3840"],
  ] as const)("resolves gpt-image-2 %s portrait sizes", (tier, size) => {
    const parameters = normalizeImageGenerationParameters(
      {
        resolutionTier: tier,
        aspectRatio: "9:16",
        outputFormat: "webp",
        outputCompression: 82,
      },
      profile("gpt-image-2", "auto"),
    );

    expect(parameters).toMatchObject({
      resolutionTier: tier,
      aspectRatio: "9:16",
      size,
      outputFormat: "webp",
      outputCompression: 82,
    });
    expect(isValidImageGenerationSize(size)).toBe(true);
  });

  it("falls back to conservative fixed options for legacy models", () => {
    const legacyProfile = profile("gpt-image-1.5", "auto");

    expect(resolveImageGenerationCapabilities(legacyProfile)).toMatchObject({
      customSizes: false,
      resolutionTiers: ["auto", "1K"],
      aspectRatios: ["1:1", "3:2", "2:3"],
    });
    expect(
      normalizeImageGenerationParameters(
        { resolutionTier: "4K", aspectRatio: "9:16" },
        legacyProfile,
      ),
    ).toMatchObject({
      resolutionTier: "1K",
      aspectRatio: "1:1",
      size: "1024x1024",
    });
  });

  it("restores legacy fixed sizes and normalizes format compression", () => {
    expect(parametersFromLegacySize("1536x1024", "high")).toMatchObject({
      resolutionTier: "1K",
      aspectRatio: "3:2",
      size: "1536x1024",
      quality: "high",
    });
    expect(
      normalizeImageGenerationParameters(
        { outputFormat: "png", outputCompression: 75 },
        profile("gpt-image-2", "auto"),
      ).outputCompression,
    ).toBeNull();
    expect(
      normalizeImageGenerationParameters(
        { outputFormat: "jpeg", outputCompression: 150 },
        profile("gpt-image-2", "auto"),
      ).outputCompression,
    ).toBe(100);
  });

  it("normalizes and preserves custom GPT Image sizes", () => {
    expect(normalizeImageGenerationSize("1300x700")).toBe("1296x704");
    expect(
      normalizeImageGenerationParameters(
        {
          size: "1300x700",
          resolutionTier: "auto",
          quality: "high",
        },
        profile("gpt-image-2", "auto"),
      ),
    ).toMatchObject({
      size: "1296x704",
      resolutionTier: "auto",
      quality: "high",
    });
    expect(parametersFromLegacySize("1300x700", "medium")).toMatchObject({
      size: "1296x704",
      resolutionTier: "auto",
      quality: "medium",
    });
  });

  it("does not expose arbitrary custom sizes to fixed-size profiles", () => {
    expect(
      normalizeImageGenerationParameters(
        { size: "1296x704", resolutionTier: "1K", aspectRatio: "1:1" },
        profile("gpt-image-1.5", "fixed"),
      ).size,
    ).toBe("1024x1024");
  });
});

function profile(
  modelId: string,
  sizeMode: ImageGenerationProfile["sizeMode"],
): ImageGenerationProfile {
  return {
    id: "profile",
    name: modelId,
    mode: "byok",
    baseUrl: "https://images.example.test",
    apiKey: "",
    modelId,
    sizeMode,
    hasApiKey: false,
  };
}
