import {
  WEB_SEARCH_PROVIDER_IDS,
  type ChatApiType,
  type ConnectionBundle,
  type WebSearchProviderId,
} from "@/runtime/chat/types";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { normalizeApiBaseUrl } from "@/runtime/transport/chat-transport-factory";
import {
  DEFAULT_REQUEST_TIMEOUT_POLICY,
  isRequestTimeoutPolicy,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";

export interface PublicConfig {
  byokEnabled: boolean;
  hostedEnabled: boolean;
  hostedWebSearchEnabled: boolean;
  hostedWebSearchProvider?: WebSearchProviderId | null;
  models: string[];
  defaultModel: string | null;
  titleModel: string | null;
  authenticated: boolean;
  requestTimeouts: RequestTimeoutPolicy;
}

export interface ConnectionDraft {
  mode: "byok" | "hosted";
  baseUrl: string;
  apiKey: string;
  accessCode: string;
  modelId: string;
  apiType: ChatApiType;
}

export const EMPTY_CONNECTION: ConnectionDraft = {
  mode: "byok",
  baseUrl: "https://api.openai.com",
  apiKey: "",
  accessCode: "",
  modelId: "gpt-4.1-mini",
  apiType: "openai",
};

interface InitialConnectionInput {
  config: PublicConfig;
  storedConnection: ConnectionBundle | null;
  storedDefaultModel: unknown;
  storedTitleModel: unknown;
}

export interface InitialConnectionState {
  connection: ConnectionDraft;
  defaultModel: string;
  titleModel: string;
}

export function resolveInitialConnectionState({
  config,
  storedConnection,
  storedDefaultModel,
  storedTitleModel,
}: InitialConnectionInput): InitialConnectionState {
  const persistedDefaultModel =
    typeof storedDefaultModel === "string" ? storedDefaultModel : null;
  const defaultModel =
    persistedDefaultModel ??
    storedConnection?.connection.modelId ??
    config.defaultModel ??
    EMPTY_CONNECTION.modelId;
  const mode =
    storedConnection?.connection.mode ??
    (config.hostedEnabled ? "hosted" : "byok");
  const titleModel =
    typeof storedTitleModel === "string"
      ? storedTitleModel
      : mode === "hosted"
        ? (config.titleModel ?? defaultModel)
        : defaultModel;
  const connection = storedConnection
    ? { ...bundleToDraft(storedConnection), modelId: defaultModel }
    : {
        ...EMPTY_CONNECTION,
        mode,
        modelId: defaultModel,
      };

  return { connection, defaultModel, titleModel };
}

interface SaveConnectionInput {
  previous: ConnectionDraft;
  draft: ConnectionDraft;
}

interface SaveConnectionPorts {
  authenticateHosted(accessCode: string): Promise<void>;
  clearModelCache(connectionScope: string): Promise<void>;
  persistConnection(bundle: ConnectionBundle): Promise<void>;
  now(): string;
}

export interface SaveConnectionResult {
  connection: ConnectionDraft;
  previousScope: string;
  nextScope: string;
  modelCacheInvalidated: boolean;
}

export async function saveConnectionChange(
  { previous, draft }: SaveConnectionInput,
  ports: SaveConnectionPorts,
): Promise<SaveConnectionResult> {
  const connection = normalizeConnectionDraft(draft);
  if (connection.mode === "hosted") {
    await ports.authenticateHosted(connection.accessCode);
  }

  const updatedAt = ports.now();
  const previousScope = connectionScope(previous);
  const nextScope = connectionScope(connection);
  const modelCacheInvalidated =
    previousScope !== nextScope || credentialsChanged(previous, connection);
  if (modelCacheInvalidated) {
    await ports.clearModelCache(nextScope);
  }

  await ports.persistConnection({
    connection: {
      id: "current",
      mode: connection.mode,
      baseUrl: connection.baseUrl,
      modelId: connection.modelId,
      apiType: connection.apiType,
      updatedAt,
    },
    credential: {
      id: "current",
      apiKey: connection.apiKey,
      accessCode: connection.accessCode,
      encrypted: false,
      updatedAt,
    },
  });

  return {
    connection,
    previousScope,
    nextScope,
    modelCacheInvalidated,
  };
}

export function connectionScope(
  value: Pick<ConnectionDraft, "mode" | "baseUrl" | "apiType">,
): string {
  if (value.mode === "hosted") return "hosted:same-origin";
  const baseUrl = value.baseUrl.trim()
    ? normalizeApiBaseUrl(value.apiType, value.baseUrl)
    : value.baseUrl.trim();
  const legacyScope = `${value.mode}:${baseUrl || "same-origin"}`;
  return `${legacyScope}:${value.apiType}`;
}

export function parsePublicConfig(value: unknown): PublicConfig {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid server config");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.byokEnabled !== "boolean" ||
    typeof record.hostedEnabled !== "boolean" ||
    typeof record.hostedWebSearchEnabled !== "boolean" ||
    typeof record.authenticated !== "boolean" ||
    !Array.isArray(record.models)
  ) {
    throw new Error("Invalid server config");
  }
  const hostedWebSearchProvider = isWebSearchProviderId(
    record.hostedWebSearchProvider,
  )
    ? record.hostedWebSearchProvider
    : record.hostedWebSearchEnabled
      ? "tavily"
      : null;
  const requestTimeouts =
    record.requestTimeouts === undefined
      ? DEFAULT_REQUEST_TIMEOUT_POLICY
      : record.requestTimeouts;
  if (!isRequestTimeoutPolicy(requestTimeouts)) {
    throw new Error("Invalid server config");
  }
  return {
    byokEnabled: record.byokEnabled,
    hostedEnabled: record.hostedEnabled,
    hostedWebSearchEnabled: record.hostedWebSearchEnabled,
    hostedWebSearchProvider,
    authenticated: record.authenticated,
    models: record.models.filter(
      (model): model is string => typeof model === "string",
    ),
    defaultModel:
      typeof record.defaultModel === "string" ? record.defaultModel : null,
    titleModel:
      typeof record.titleModel === "string" ? record.titleModel : null,
    requestTimeouts: { ...requestTimeouts },
  };
}

function isWebSearchProviderId(value: unknown): value is WebSearchProviderId {
  return (
    typeof value === "string" &&
    (WEB_SEARCH_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

function bundleToDraft(bundle: ConnectionBundle): ConnectionDraft {
  return {
    mode: bundle.connection.mode,
    baseUrl: bundle.connection.baseUrl,
    modelId: bundle.connection.modelId,
    apiType: bundle.connection.apiType,
    apiKey: bundle.credential.apiKey,
    accessCode: bundle.credential.accessCode,
  };
}

function normalizeConnectionDraft(value: ConnectionDraft): ConnectionDraft {
  const hosted = value.mode === "hosted";
  if (!hosted && value.apiType !== "openai" && !value.baseUrl.trim()) {
    throw new ChatTransportError(
      "INVALID_REQUEST",
      "A direct API URL is required for this connection type",
      null,
    );
  }
  return {
    ...value,
    baseUrl:
      value.mode === "byok" && value.baseUrl.trim()
        ? normalizeApiBaseUrl(value.apiType, value.baseUrl)
        : value.baseUrl.trim(),
    modelId: value.modelId.normalize("NFKC").trim(),
    apiType: hosted ? "openai" : value.apiType,
  };
}

function credentialsChanged(
  previous: Pick<ConnectionDraft, "mode" | "apiKey" | "accessCode">,
  next: Pick<ConnectionDraft, "mode" | "apiKey" | "accessCode">,
): boolean {
  if (previous.mode !== next.mode) return true;
  return next.mode === "byok"
    ? previous.apiKey !== next.apiKey
    : previous.accessCode !== next.accessCode;
}
