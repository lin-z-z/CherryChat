import type { ConnectionMode } from "@/runtime/chat/types";

export type TavilyExecutionSource =
  { kind: "browser"; apiKey: string; baseUrl: string } | { kind: "hosted" };

export interface TavilyExecutionContext {
  connectionMode: ConnectionMode;
  browserApiKey: string;
  browserBaseUrl: string;
  hostedWebSearchEnabled: boolean;
  authenticated: boolean;
}

export function resolveTavilyExecutionSource(
  context: TavilyExecutionContext,
): TavilyExecutionSource | null {
  if (context.connectionMode === "hosted") {
    return context.hostedWebSearchEnabled && context.authenticated
      ? { kind: "hosted" }
      : null;
  }
  const apiKey = context.browserApiKey.trim();
  if (apiKey) {
    return {
      kind: "browser",
      apiKey,
      baseUrl: context.browserBaseUrl.trim(),
    };
  }
  return null;
}
