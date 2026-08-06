import { describe, expect, it } from "vitest";

import { resolveTavilyExecutionSource } from "@/runtime/tools/tavily-source";

describe("Tavily execution source", () => {
  it("uses only a browser key for Custom API connections", () => {
    expect(
      resolveTavilyExecutionSource({
        connectionMode: "byok",
        browserApiKey: "  tvly-browser-key  ",
        browserBaseUrl: "  https://search.example/tavily  ",
        hostedWebSearchEnabled: true,
        authenticated: true,
      }),
    ).toEqual({
      kind: "browser",
      apiKey: "tvly-browser-key",
      baseUrl: "https://search.example/tavily",
    });
    expect(
      resolveTavilyExecutionSource({
        connectionMode: "byok",
        browserApiKey: "",
        browserBaseUrl: "https://api.tavily.com",
        hostedWebSearchEnabled: true,
        authenticated: true,
      }),
    ).toBeNull();
  });

  it("uses only hosted search for access-code connections", () => {
    expect(
      resolveTavilyExecutionSource({
        connectionMode: "hosted",
        browserApiKey: "tvly-browser-key",
        browserBaseUrl: "https://search.example/tavily",
        hostedWebSearchEnabled: true,
        authenticated: true,
      }),
    ).toEqual({ kind: "hosted" });
    expect(
      resolveTavilyExecutionSource({
        connectionMode: "hosted",
        browserApiKey: "tvly-browser-key",
        browserBaseUrl: "https://api.tavily.com",
        hostedWebSearchEnabled: true,
        authenticated: false,
      }),
    ).toBeNull();
  });
});
