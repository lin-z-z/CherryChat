import { describe, expect, it } from "vitest";

import type { WebSearchConfiguration } from "@/runtime/chat/types";
import {
  createWebSearchProviderExecutor,
  resolveHostedWebSearchProvider,
  resolveWebSearchExecutionSource,
} from "@/runtime/tools/web-search-provider";

const configuration: WebSearchConfiguration = {
  enabled: true,
  maxResults: 5,
  provider: "grok",
  hostedProvider: "exa",
  providers: {
    tavily: {
      apiKey: "tvly-browser-secret",
      baseUrl: "https://api.tavily.com",
      hasApiKey: true,
    },
    exa: {
      apiKey: "exa-browser-secret",
      baseUrl: "https://api.exa.ai",
      hasApiKey: true,
    },
    grok: {
      apiKey: "grok-browser-secret",
      responsesUrl: "https://proxy.example/responses",
      model: "grok-4.5",
      xSearch: false,
      hasApiKey: true,
    },
  },
  hasApiKey: true,
};

describe("web search provider registry", () => {
  it("uses an allowed Hosted preference and otherwise falls back to the server default", () => {
    expect(
      resolveHostedWebSearchProvider({
        preferredProvider: "grok",
        defaultProvider: "tavily",
        allowedProviders: ["grok", "tavily"],
      }),
    ).toBe("grok");
    expect(
      resolveHostedWebSearchProvider({
        preferredProvider: "grok",
        defaultProvider: "tavily",
        allowedProviders: ["exa", "tavily"],
      }),
    ).toBe("tavily");
    expect(
      resolveHostedWebSearchProvider({
        preferredProvider: null,
        defaultProvider: "tavily",
        allowedProviders: ["grok", "tavily"],
      }),
    ).toBe("tavily");
  });

  it("binds BYOK to the selected provider and Hosted to the public provider", () => {
    expect(
      resolveWebSearchExecutionSource({
        connectionMode: "byok",
        webSearch: configuration,
        hostedWebSearchEnabled: true,
        hostedWebSearchProvider: "exa",
        hostedWebSearchProviders: ["exa", "tavily"],
        authenticated: true,
      }),
    ).toEqual({
      kind: "browser",
      provider: "grok",
      apiKey: "grok-browser-secret",
      responsesUrl: "https://proxy.example/responses",
      model: "grok-4.5",
      xSearch: false,
    });

    expect(
      resolveWebSearchExecutionSource({
        connectionMode: "hosted",
        webSearch: configuration,
        hostedWebSearchEnabled: true,
        hostedWebSearchProvider: "exa",
        hostedWebSearchProviders: ["exa", "tavily"],
        authenticated: true,
      }),
    ).toEqual({ kind: "hosted", provider: "exa" });
  });

  it("does not fall back to another credential when the selected provider is empty", () => {
    expect(
      resolveWebSearchExecutionSource({
        connectionMode: "byok",
        webSearch: {
          ...configuration,
          provider: "exa",
          providers: {
            ...configuration.providers,
            exa: {
              ...configuration.providers.exa,
              apiKey: "",
              hasApiKey: false,
            },
          },
        },
        hostedWebSearchEnabled: true,
        hostedWebSearchProvider: "tavily",
        hostedWebSearchProviders: ["tavily"],
        authenticated: true,
      }),
    ).toBeNull();
  });

  it("creates a Hosted executor without exposing browser credentials", async () => {
    let request: RequestInit | undefined;
    const executor = createWebSearchProviderExecutor({
      source: { kind: "hosted", provider: "exa" },
      maxResults: 5,
      fetchImplementation: async (_input, init) => {
        request = init;
        return Response.json({ query: "hosted", results: [] });
      },
    });
    await executor.execute({ query: "hosted" }, new AbortController().signal);
    expect(new Headers(request?.headers).has("authorization")).toBe(false);
    expect(request?.credentials).toBe("same-origin");
    expect(JSON.parse(String(request?.body))).toEqual({
      query: "hosted",
      maxResults: 5,
      provider: "exa",
    });
  });
});
