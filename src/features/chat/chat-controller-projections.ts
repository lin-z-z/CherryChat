import {
  connectionScope,
  type ConnectionDraft,
  type PublicConfig,
} from "@/features/chat/connection-controller";
import type {
  ChatEndpointType,
  MessageNode,
  ModelDescriptor,
  WebSearchConfiguration,
} from "@/runtime/chat/types";
import {
  createWebSearchProviderExecutor,
  resolveWebSearchExecutionSource,
  type WebSearchExecutionSource,
} from "@/runtime/tools/web-search-provider";
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

export interface ConnectionModelProjection {
  enabledModels: string[];
  models: string[];
}

export function projectConnectionModels({
  mode,
  currentModelId,
  availableModelIds,
  persistedEnabledModelIds,
  requiredModelIds = [],
}: {
  mode: ConnectionDraft["mode"];
  currentModelId: string;
  availableModelIds: readonly string[];
  persistedEnabledModelIds: readonly string[] | null;
  requiredModelIds?: readonly string[];
}): ConnectionModelProjection {
  const enabledModels = resolvePersistedEnabledModelIds(
    currentModelId,
    mode === "hosted" ? availableModelIds : persistedEnabledModelIds,
  );
  return {
    enabledModels,
    models: resolveEnabledModelIds(
      currentModelId,
      enabledModels,
      requiredModelIds,
    ),
  };
}

export function lastGeneratedModelId(
  messages: readonly MessageNode[],
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.modelSnapshot) {
      return message.modelSnapshot.modelId;
    }
  }
  return null;
}

export function resolveWebSearchSource(
  connectionMode: ConnectionDraft["mode"],
  webSearch: WebSearchConfiguration,
  publicConfig: PublicConfig | null,
): WebSearchExecutionSource | null {
  return resolveWebSearchExecutionSource({
    connectionMode,
    webSearch,
    hostedWebSearchEnabled: publicConfig?.hostedWebSearchEnabled ?? false,
    hostedWebSearchProvider: publicConfig?.hostedWebSearchProvider ?? null,
    authenticated: publicConfig?.authenticated ?? false,
  });
}

export function createWebSearchExecutor(
  source: WebSearchExecutionSource,
  maxResults: number,
  onUnauthorized: () => void,
): ToolExecutor {
  return createWebSearchProviderExecutor({
    source,
    maxResults,
    onUnauthorized,
  });
}
