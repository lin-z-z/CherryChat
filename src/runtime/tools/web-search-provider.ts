import type {
  WebSearchConfiguration,
  WebSearchProviderId,
} from "@/runtime/chat/types";
import { createExaToolExecutor } from "@/runtime/tools/exa-client";
import { createGrokToolExecutor } from "@/runtime/tools/grok-client";
import { createTavilyToolExecutor } from "@/runtime/tools/tavily-client";
import { createHostedWebSearchToolExecutor } from "@/runtime/tools/web-search-client";
import type { ToolExecutor } from "@/runtime/tools/tool-registry";
import type { FetchLike } from "@/runtime/transport/transport-http";

export type WebSearchExecutionSource =
  | {
      kind: "browser";
      provider: "tavily";
      apiKey: string;
      baseUrl: string;
    }
  | {
      kind: "browser";
      provider: "exa";
      apiKey: string;
      baseUrl: string;
    }
  | {
      kind: "browser";
      provider: "grok";
      apiKey: string;
      responsesUrl: string;
      model: string;
      xSearch: boolean;
    }
  | { kind: "hosted"; provider: WebSearchProviderId };

export interface WebSearchSourceContext {
  connectionMode: "hosted" | "byok";
  webSearch: WebSearchConfiguration;
  hostedWebSearchEnabled: boolean;
  hostedWebSearchProvider: WebSearchProviderId | null;
  authenticated: boolean;
}

export function resolveWebSearchExecutionSource(
  context: WebSearchSourceContext,
): WebSearchExecutionSource | null {
  if (context.connectionMode === "hosted") {
    return context.hostedWebSearchEnabled &&
      context.authenticated &&
      context.hostedWebSearchProvider
      ? {
          kind: "hosted",
          provider: context.hostedWebSearchProvider,
        }
      : null;
  }
  const provider = context.webSearch.provider;
  if (provider === "grok") {
    const configuration = context.webSearch.providers.grok;
    if (!configuration.hasApiKey) return null;
    return {
      kind: "browser",
      provider,
      apiKey: configuration.apiKey,
      responsesUrl: configuration.responsesUrl,
      model: configuration.model,
      xSearch: configuration.xSearch,
    };
  }
  const configuration = context.webSearch.providers[provider];
  if (!configuration.hasApiKey) return null;
  return {
    kind: "browser",
    provider,
    apiKey: configuration.apiKey,
    baseUrl: configuration.baseUrl,
  };
}

export function createWebSearchProviderExecutor(options: {
  source: WebSearchExecutionSource;
  maxResults: number;
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
  onUnauthorized?: () => void;
}): ToolExecutor {
  if (options.source.kind === "hosted") {
    return createHostedWebSearchToolExecutor({
      maxResults: options.maxResults,
      ...(options.fetchImplementation
        ? { fetchImplementation: options.fetchImplementation }
        : {}),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.onUnauthorized
        ? { onUnauthorized: options.onUnauthorized }
        : {}),
    });
  }
  if (options.source.provider === "tavily") {
    return createTavilyToolExecutor({
      apiKey: options.source.apiKey,
      baseUrl: options.source.baseUrl,
      maxResults: options.maxResults,
      ...(options.fetchImplementation
        ? { fetchImplementation: options.fetchImplementation }
        : {}),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });
  }
  if (options.source.provider === "exa") {
    return createExaToolExecutor({
      apiKey: options.source.apiKey,
      baseUrl: options.source.baseUrl,
      maxResults: options.maxResults,
      ...(options.fetchImplementation
        ? { fetchImplementation: options.fetchImplementation }
        : {}),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });
  }
  return createGrokToolExecutor({
    apiKey: options.source.apiKey,
    responsesUrl: options.source.responsesUrl,
    model: options.source.model,
    xSearch: options.source.xSearch,
    maxResults: options.maxResults,
    ...(options.fetchImplementation
      ? { fetchImplementation: options.fetchImplementation }
      : {}),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  });
}

export function providerHasConfiguration(
  configuration: WebSearchConfiguration,
  provider: WebSearchProviderId,
): boolean {
  return configuration.providers[provider].hasApiKey;
}
