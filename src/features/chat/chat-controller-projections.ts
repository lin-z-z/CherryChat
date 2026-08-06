import {
  connectionScope,
  type ConnectionDraft,
  type PublicConfig,
} from "@/features/chat/connection-controller";
import type { ChatEndpointType, ModelDescriptor } from "@/runtime/chat/types";
import { createTavilyToolExecutor } from "@/runtime/tools/tavily-client";
import {
  resolveTavilyExecutionSource,
  type TavilyExecutionSource,
} from "@/runtime/tools/tavily-source";
import type { ToolExecutor } from "@/runtime/tools/tool-registry";

export interface GenerationPreparation {
  controller: AbortController;
  conversationId: string | null;
  ready: Promise<void>;
  resolveReady: () => void;
}

export function createGenerationPreparation(
  conversationId: string | null,
): GenerationPreparation {
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  return {
    controller: new AbortController(),
    conversationId,
    ready,
    resolveReady,
  };
}

export function modelCapabilityIdentity(
  value: Pick<ConnectionDraft, "mode" | "baseUrl" | "modelId" | "apiType">,
  endpointType?: ChatEndpointType | undefined,
): string {
  return `${connectionScope(value)}:${value.modelId.normalize("NFKC").trim()}:${endpointType ?? "default"}`;
}

export function descriptorsFromIds(
  modelIds: readonly string[],
): ModelDescriptor[] {
  return Array.from(new Set(modelIds)).map((id) => ({
    id,
    ownedBy: null,
    endpointTypes: [],
  }));
}

export function resolveVisibleModelIds(
  currentModelId: string,
  modelIds: readonly string[],
): string[] {
  const discovered = Array.from(
    new Set(modelIds.filter((modelId) => modelId.trim().length > 0)),
  );
  if (discovered.length > 0) return discovered;
  return currentModelId.trim() ? [currentModelId] : [];
}

export function resolveEnabledModelIds(
  currentModelId: string,
  modelIds: readonly string[] | null,
  requiredModelIds: readonly string[] = [],
): string[] {
  const enabled = Array.from(
    new Set(
      [...(modelIds ?? []), currentModelId, ...requiredModelIds].filter(
        (modelId) => modelId.trim().length > 0,
      ),
    ),
  );
  return enabled;
}

export function resolvePersistedEnabledModelIds(
  currentModelId: string,
  modelIds: readonly string[] | null,
): string[] {
  const normalized = Array.from(
    new Set(
      (modelIds ?? [])
        .map((modelId) => modelId.normalize("NFKC").trim())
        .filter(Boolean),
    ),
  );
  return normalized.length > 0
    ? normalized
    : currentModelId.normalize("NFKC").trim()
      ? [currentModelId.normalize("NFKC").trim()]
      : [];
}

export function resolveWebSearchSource(
  connectionMode: ConnectionDraft["mode"],
  browserApiKey: string,
  browserBaseUrl: string,
  publicConfig: PublicConfig | null,
): TavilyExecutionSource | null {
  return resolveTavilyExecutionSource({
    connectionMode,
    browserApiKey,
    browserBaseUrl,
    hostedWebSearchEnabled: publicConfig?.hostedWebSearchEnabled ?? false,
    authenticated: publicConfig?.authenticated ?? false,
  });
}

export function createWebSearchExecutor(
  source: TavilyExecutionSource,
  maxResults: number,
  onUnauthorized: () => void,
): ToolExecutor {
  return source.kind === "browser"
    ? createTavilyToolExecutor({
        apiKey: source.apiKey,
        baseUrl: source.baseUrl,
        maxResults,
      })
    : createTavilyToolExecutor({
        mode: "hosted",
        maxResults,
        onUnauthorized,
      });
}
