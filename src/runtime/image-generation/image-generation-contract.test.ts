import { describe, expect, it } from "vitest";

import {
  imageEditUrl,
  imageGenerationUrl,
  normalizeImageBaseUrl,
} from "@/runtime/image-generation/image-generation-contract";

describe("image generation endpoint contract", () => {
  it.each([
    ["https://images.example", "https://images.example"],
    ["https://images.example/", "https://images.example"],
    ["https://images.example/v1", "https://images.example/v1"],
    ["https://images.example/v1/images/generations/", "https://images.example"],
    ["https://images.example/v1/images/edits", "https://images.example"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeImageBaseUrl(input)).toBe(expected);
  });

  it("derives one standard endpoint from root and /v1 base URLs", () => {
    expect(imageGenerationUrl("https://images.example")).toBe(
      "https://images.example/v1/images/generations",
    );
    expect(imageEditUrl("https://images.example/v1/")).toBe(
      "https://images.example/v1/images/edits",
    );
  });

  it.each([
    "",
    "not a URL",
    "https://user:pass@images.example",
    "https://images.example?secret=1",
    "https://images.example#fragment",
  ])("rejects unsafe base URL %s", (value) => {
    expect(() => normalizeImageBaseUrl(value)).toThrow();
  });
});
