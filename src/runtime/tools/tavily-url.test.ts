import { describe, expect, it } from "vitest";

import {
  buildTavilySearchUrl,
  normalizeTavilyBaseUrl,
} from "@/runtime/tools/tavily-url";

describe("Tavily URL", () => {
  it("accepts a base URL or a full search URL without duplicating the path", () => {
    expect(normalizeTavilyBaseUrl("https://api.tavily.com/search/")).toBe(
      "https://api.tavily.com",
    );
    expect(buildTavilySearchUrl("https://proxy.example/tavily/")).toBe(
      "https://proxy.example/tavily/search",
    );
  });

  it.each([
    "file:///tmp/tavily",
    "https://user:pass@example.com",
    "https://example.com?target=internal",
    "https://example.com#fragment",
    `https://example.com/${"a".repeat(2_048)}`,
  ])("rejects an unsafe Tavily URL: %s", (value) => {
    expect(() => normalizeTavilyBaseUrl(value)).toThrow();
  });
});
