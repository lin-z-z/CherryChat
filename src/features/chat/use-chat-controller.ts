"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  EMPTY_CONNECTION,
  connectionScope,
  parsePublicConfig,
  resolveInitialConnectionState,
  saveConnectionChange,
  type ConnectionDraft,
  type PublicConfig,
} from "@/features/chat/connection-controller";
import {
  createGenerationPreparation,
  createWebSearchExecutor,
  descriptorsFromIds,
  lastGeneratedModelId,
  modelCapabilityIdentity,
  projectConnectionModels,
  resolveEnabledModelIds,
  resolveVisibleModelIds,
  resolveWebSearchSource,
  type GenerationPreparation,
} from "@/features/chat/chat-controller-projections";
import { formatUserFacingError } from "@/lib/user-facing-error";
import { ImageProcessor } from "@/runtime/attachments/image-processor";
import type { ConversationExportProjection } from "@/runtime/chat/export-projection";
import { buildChatCompletionsRequest } from "@/runtime/chat/request-builder";
import {
  buildTitleRequest,
  parseGeneratedTitle,
  shouldGenerateTitle,
} from "@/runtime/chat/title-generation";
import type { SelectedContext } from "@/runtime/chat/context-selection";
import { DefaultTokenEstimator } from "@/runtime/chat/token-estimator";
import type {
  AssistantRecord,
  AttachmentRecord,
  ConversationRecord,
  EffectiveModelCapability,
  MessageNode,
  ModelDescriptor,
  ModelCapabilityOverride,
  ModelPreferences,
  ReasoningChoice,
} from "@/runtime/chat/types";
import {
  createDefaultModelPreferences,
  DEFAULT_ASSISTANT_ID,
} from "@/runtime/chat/types";
import { resolveModelList } from "@/runtime/models/model-list";
import { ToolRegistry } from "@/runtime/tools/tool-registry";
import {
  loadAgentRuntime,
  resolveAgentRuntimeKind,
} from "@/runtime/agent/agent-runtime-factory";
import {
  getConnectionEndpointProfile,
  resolveModelEndpointType,
} from "@/runtime/models/endpoint-profiles";
import {
  DEFAULT_REASONING_CHOICE,
  isReasoningChoiceSupported,
  resolveEffectiveModelCapability,
} from "@/runtime/models/effective-model-capabilities";
import {
  ChatTransportError,
  errorCodeForStatus,
} from "@/runtime/transport/chat-errors";
import { createChatTransport } from "@/runtime/transport/chat-transport-factory";
import {
  DEFAULT_REQUEST_TIMEOUT_POLICY,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";
import {
  ThrottledStreamPersistence,
  type StreamSnapshot,
} from "@/runtime/streaming/stream-state";
import { FrameSnapshotDispatcher } from "@/runtime/streaming/frame-snapshot-dispatcher";
import {
  AttachmentRepository,
  ObjectUrlRegistry,
} from "@/storage/attachment-repository";
import { AssistantRepository } from "@/storage/assistant-repository";
import {
  exportBackupArchive,
  importPreparedBackup,
  prepareBackupImport,
  summarizeBackup,
  type PreparedBackup,
} from "@/storage/backup";
import { ConnectionStore } from "@/storage/connection-store";
import {
  exportConversationJson,
  exportConversationMarkdown,
  loadConversationProjection,
  type DownloadArtifact,
} from "@/storage/conversation-export";
import { ConversationRepository } from "@/storage/conversation-repository";
import { clearLocalData } from "@/storage/clear-local-data";
import { ChatDatabase } from "@/storage/database";
import { ModelCapabilityRepository } from "@/storage/model-capability-repository";
import { MessageStreamPersistence } from "@/storage/stream-persistence";
import { ModelListCacheRepository } from "@/storage/model-list-cache-repository";
import {
  WebSearchRepository,
  type WebSearchSaveInput,
  type WebSearchConfiguration,
} from "@/storage/web-search-repository";
import { DEFAULT_TAVILY_BASE_URL } from "@/runtime/tools/tavily-url";
import { DEFAULT_EXA_BASE_URL } from "@/runtime/tools/exa-url";
import {
  DEFAULT_GROK_MODEL,
  DEFAULT_GROK_RESPONSES_URL,
} from "@/runtime/tools/grok-url";

const LANGUAGE_STORAGE_KEY = "cherrychat.language";
const THEME_STORAGE_KEY = "cherrychat.theme";
const DEFAULT_MODEL_SETTINGS_KEY = "defaultModel";
const TITLE_MODEL_SETTINGS_KEY = "titleModel";
const TITLE_ATTEMPT_PREFIX = "title-attempt:";

export type AppTheme = "system" | "light" | "dark";
export type ChatController = ReturnType<typeof useChatController>;
export type { ConnectionDraft, PublicConfig };

interface Services {
  database: ChatDatabase;
  conversations: ConversationRepository;
  assistants: AssistantRepository;
  connections: ConnectionStore;
  capabilities: ModelCapabilityRepository;
  modelLists: ModelListCacheRepository;
  attachments: AttachmentRepository;
  objectUrls: ObjectUrlRegistry;
  imageProcessor: ImageProcessor;
  webSearch: WebSearchRepository;
}

interface ActiveGenerationHandle {
  id: string;
  conversationId: string;
  assistantMessageId: string;
  controller: AbortController;
  completion: Promise<void>;
}

export interface ActiveGenerationProjection {
  id: string;
  conversationId: string;
  assistantMessageId: string;
  snapshot: StreamSnapshot;
}

export function useChatController() {
  const { t } = useTranslation();
  const translateRef = useRef(t);
  const servicesRef = useRef<Services | null>(null);
  const activeGenerationRef = useRef<ActiveGenerationHandle | null>(null);
  const generationPreparationRef = useRef<GenerationPreparation | null>(null);
  const generationStartingRef = useRef(false);
  const currentConversationIdRef = useRef<string | null>(null);
  const connectionRef = useRef<ConnectionDraft>(EMPTY_CONNECTION);
  const requestTimeoutsRef = useRef<RequestTimeoutPolicy>(
    DEFAULT_REQUEST_TIMEOUT_POLICY,
  );
  const capabilityResolutionEpochRef = useRef(0);
  const capabilityIdentityRef = useRef<string | null>(null);
  const modelRefreshEpochRef = useRef(0);
  const modelCacheWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const modelDescriptorsRef = useRef<ModelDescriptor[]>([]);
  const conversationLoadEpochRef = useRef(0);
  const webSearchEnabledRef = useRef(false);
  const hostedAuthEpochRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [storageDegraded, setStorageDegraded] = useState(false);
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [connection, setConnection] =
    useState<ConnectionDraft>(EMPTY_CONNECTION);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [titleModel, setTitleModel] = useState<string | null>(null);
  const [enabledModels, setEnabledModels] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [webSearchConfig, setWebSearchConfig] =
    useState<WebSearchConfiguration>({
      enabled: false,
      maxResults: 5,
      provider: "tavily",
      providers: {
        tavily: {
          apiKey: "",
          baseUrl: DEFAULT_TAVILY_BASE_URL,
          hasApiKey: false,
        },
        exa: {
          apiKey: "",
          baseUrl: DEFAULT_EXA_BASE_URL,
          hasApiKey: false,
        },
        grok: {
          apiKey: "",
          responsesUrl: DEFAULT_GROK_RESPONSES_URL,
          model: DEFAULT_GROK_MODEL,
          xSearch: false,
          hasApiKey: false,
        },
      },
      hasApiKey: false,
    });
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [capability, setCapability] = useState<EffectiveModelCapability | null>(
    null,
  );
  const [modelPreferences, setModelPreferences] = useState<ModelPreferences>(
    createDefaultModelPreferences(),
  );
  const [reasoningChoice, setReasoningChoice] = useState<ReasoningChoice>(
    DEFAULT_REASONING_CHOICE,
  );
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<
    ConversationRecord[]
  >([]);
  const [assistants, setAssistants] = useState<AssistantRecord[]>([]);
  const [currentConversation, setCurrentConversation] =
    useState<ConversationRecord | null>(null);
  const [path, setPath] = useState<MessageNode[]>([]);
  const [allMessages, setAllMessages] = useState<MessageNode[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    AttachmentRecord[]
  >([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>(
    {},
  );
  const [activeGeneration, setActiveGeneration] =
    useState<ActiveGenerationProjection | null>(null);
  const [generationStarting, setGenerationStarting] = useState(false);
  const stream = activeGeneration?.snapshot ?? null;
  const [contextStats, setContextStats] = useState<Pick<
    SelectedContext,
    | "configuredHistoryMessages"
    | "actualHistoryMessages"
    | "inputEstimate"
    | "inputBudgetTokens"
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Awaited<ReturnType<ConversationRepository["search"]>>
  >([]);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    const updateOnlineState = () => setOnline(window.navigator.onLine);
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  const requireServices = useCallback(() => {
    const services = servicesRef.current;
    if (!services) throw new Error("Chat services are not ready");
    return services;
  }, []);

  const refreshLists = useCallback(async () => {
    const services = requireServices();
    const [active, archived, nextAssistants] = await Promise.all([
      services.conversations.listConversations(false),
      services.conversations.listConversations(true),
      services.assistants.list(),
    ]);
    setConversations(active);
    setArchivedConversations(archived);
    setAssistants(nextAssistants);
  }, [requireServices]);

  const clearCurrentProjection = useCallback(() => {
    conversationLoadEpochRef.current += 1;
    currentConversationIdRef.current = null;
    requireServices().objectUrls.dispose();
    setCurrentConversation(null);
    setPath([]);
    setAllMessages([]);
    setPendingAttachments([]);
    setAttachmentUrls({});
    setContextStats(null);
    webSearchEnabledRef.current = false;
    setWebSearchEnabled(false);
  }, [requireServices]);

  const resolveCapability = useCallback(
    async (nextConnection: ConnectionDraft) => {
      const resolutionEpoch = ++capabilityResolutionEpochRef.current;
      const endpointType = resolveModelEndpointType(
        nextConnection,
        nextConnection.modelId,
        modelDescriptorsRef.current,
      );
      const identity = modelCapabilityIdentity(nextConnection, endpointType);
      if (!nextConnection.modelId) {
        capabilityIdentityRef.current = null;
        setCapability(null);
        setModelPreferences(createDefaultModelPreferences());
        setReasoningChoice(DEFAULT_REASONING_CHOICE);
        return null;
      }
      const scope = connectionScope(nextConnection);
      const [resolved, preferences] = await Promise.all([
        requireServices().capabilities.resolve(scope, nextConnection.modelId),
        requireServices().capabilities.resolvePreferences(
          scope,
          nextConnection.modelId,
        ),
      ]);
      const effective = resolveEffectiveModelCapability({
        modelCapability: resolved,
        endpointProfile: getConnectionEndpointProfile({
          ...nextConnection,
          endpointType,
        }),
      });
      if (
        resolutionEpoch !== capabilityResolutionEpochRef.current ||
        identity !==
          modelCapabilityIdentity(
            connectionRef.current,
            resolveModelEndpointType(
              connectionRef.current,
              connectionRef.current.modelId,
              modelDescriptorsRef.current,
            ),
          )
      ) {
        return effective;
      }
      capabilityIdentityRef.current = identity;
      setCapability(effective);
      setModelPreferences(preferences);
      setReasoningChoice((current) =>
        isReasoningChoiceSupported(effective.reasoningControl, current)
          ? current
          : DEFAULT_REASONING_CHOICE,
      );
      return effective;
    },
    [requireServices],
  );

  const setActiveModel = useCallback(
    async (modelId: string) => {
      const normalized = modelId.normalize("NFKC").trim();
      if (!normalized)
        throw new Error(translateRef.current("selectModelError"));
      const next = { ...connectionRef.current, modelId: normalized };
      connectionRef.current = next;
      capabilityIdentityRef.current = null;
      setCapability(null);
      setModelPreferences(createDefaultModelPreferences());
      setReasoningChoice(DEFAULT_REASONING_CHOICE);
      setConnection(next);
      setModels((current) => resolveEnabledModelIds(normalized, current));
      await resolveCapability(next);
    },
    [resolveCapability],
  );

  const loadConversation = useCallback(
    async (conversationId: string) => {
      const services = requireServices();
      const loadEpoch = ++conversationLoadEpochRef.current;
      const [conversationRecord, currentPath, messages] = await Promise.all([
        services.conversations.getConversation(conversationId),
        services.conversations.getCurrentPath(conversationId),
        services.conversations.listMessages(conversationId),
      ]);
      const lastGeneratedModel = [...currentPath]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" && Boolean(message.modelSnapshot),
        )?.modelSnapshot?.modelId;
      const activeModelId =
        conversationRecord.activeModelId ?? lastGeneratedModel ?? null;
      const ids = new Set(
        currentPath.flatMap((message) =>
          message.parts
            .filter((part) => part.type === "image_ref")
            .map((part) => part.attachmentId),
        ),
      );
      const attachments = await Promise.all(
        [...ids].map(async (id) => ({
          id,
          attachment: await services.attachments.get(id),
        })),
      );
      if (loadEpoch !== conversationLoadEpochRef.current) return;

      if (activeModelId && activeModelId !== connectionRef.current.modelId) {
        await setActiveModel(activeModelId);
      }
      if (loadEpoch !== conversationLoadEpochRef.current) return;
      if (activeModelId && conversationRecord.activeModelId === null) {
        await services.conversations.setActiveModel(
          conversationRecord.id,
          activeModelId,
        );
      }

      services.objectUrls.dispose();
      const urls: Record<string, string> = {};
      for (const { id, attachment } of attachments) {
        if (attachment) {
          urls[id] = services.objectUrls.acquire(id, attachment.blob);
        }
      }

      currentConversationIdRef.current = conversationRecord.id;
      webSearchEnabledRef.current = conversationRecord.webSearchEnabled;
      setWebSearchEnabled(conversationRecord.webSearchEnabled);
      setCurrentConversation(
        activeModelId && conversationRecord.activeModelId === null
          ? { ...conversationRecord, activeModelId }
          : conversationRecord,
      );
      setPath(currentPath);
      setAllMessages(messages);
      setPendingAttachments([]);
      setAttachmentUrls(urls);
      setContextStats(null);
    },
    [requireServices, setActiveModel],
  );

  useEffect(() => {
    let disposed = false;
    let activeServices: Services | null = null;

    void (async () => {
      try {
        let database = new ChatDatabase();
        let useLocalStorageConnection = false;
        try {
          await database.open();
        } catch {
          database.close();
          const memory = await import("fake-indexeddb");
          database = new ChatDatabase(
            `cherrychat-memory-${crypto.randomUUID()}`,
            {
              indexedDB: memory.indexedDB,
              IDBKeyRange: memory.IDBKeyRange,
            },
          );
          await database.open();
          useLocalStorageConnection = true;
          if (!disposed) setStorageDegraded(true);
        }
        if (disposed) {
          database.close();
          return;
        }
        const objectUrls = new ObjectUrlRegistry();
        const assistantRepository = new AssistantRepository(database);
        await assistantRepository.ensureDefault();
        const services: Services = {
          database,
          conversations: new ConversationRepository(database),
          assistants: assistantRepository,
          connections: new ConnectionStore(
            database,
            window.localStorage,
            useLocalStorageConnection,
          ),
          capabilities: new ModelCapabilityRepository(database),
          modelLists: new ModelListCacheRepository(database),
          attachments: new AttachmentRepository(database),
          objectUrls,
          imageProcessor: new ImageProcessor(),
          webSearch: new WebSearchRepository(database),
        };
        activeServices = services;
        servicesRef.current = services;
        await services.conversations.recoverInterruptedMessages();
        const publicConfigPromise = fetch("/api/config", {
          cache: "no-store",
        }).then(async (response) => parsePublicConfig(await response.json()));
        const [
          config,
          stored,
          storedDefaultModel,
          storedTitleModel,
          active,
          archived,
          nextAssistants,
        ] = await Promise.all([
          publicConfigPromise,
          services.connections.load(),
          services.database.settings.get(DEFAULT_MODEL_SETTINGS_KEY),
          services.database.settings.get(TITLE_MODEL_SETTINGS_KEY),
          services.conversations.listConversations(false),
          services.conversations.listConversations(true),
          services.assistants.list(),
        ]);
        requestTimeoutsRef.current = config.requestTimeouts;
        const {
          connection: nextConnection,
          defaultModel: nextDefaultModel,
          titleModel: nextTitleModel,
        } = resolveInitialConnectionState({
          config,
          storedConnection: stored,
          storedDefaultModel: storedDefaultModel?.value,
          storedTitleModel: storedTitleModel?.value,
        });
        const nextWebSearchConfig = await services.webSearch.load({
          defaultEnabled:
            nextConnection.mode === "hosted" && config.hostedWebSearchEnabled,
        });
        const cachedModelState = await services.modelLists.loadState(
          connectionScope(nextConnection),
        );
        const initialModelDescriptors =
          nextConnection.mode === "hosted"
            ? descriptorsFromIds(config.models)
            : cachedModelState.discoveredModels.length > 0
              ? cachedModelState.discoveredModels
              : stored
                ? []
                : descriptorsFromIds(config.models);
        const initialAvailableModels = resolveVisibleModelIds(
          nextConnection.modelId,
          initialModelDescriptors.map(({ id }) => id),
        );
        const initialModelProjection = projectConnectionModels({
          mode: nextConnection.mode,
          currentModelId: nextConnection.modelId,
          availableModelIds: initialAvailableModels,
          persistedEnabledModelIds:
            cachedModelState.enabledModelIds ??
            (stored ? null : initialAvailableModels),
          requiredModelIds: [nextDefaultModel, nextTitleModel],
        });
        if (disposed) return;
        setPublicConfig(config);
        connectionRef.current = nextConnection;
        modelDescriptorsRef.current = structuredClone(initialModelDescriptors);
        setConnection(nextConnection);
        setDefaultModel(nextDefaultModel);
        setTitleModel(nextTitleModel);
        setEnabledModels(initialModelProjection.enabledModels);
        setAvailableModels(initialAvailableModels);
        setModels(initialModelProjection.models);
        setWebSearchConfig(nextWebSearchConfig);
        setConversations(active);
        setArchivedConversations(archived);
        setAssistants(nextAssistants);
        await resolveCapability(nextConnection);
        if (active[0]) await loadConversation(active[0].id);
      } catch (cause) {
        if (!disposed)
          setError(formatUserFacingError(cause, translateRef.current));
      } finally {
        if (!disposed) setReady(true);
      }
    })();

    return () => {
      disposed = true;
      generationPreparationRef.current?.controller.abort();
      activeGenerationRef.current?.controller.abort();
      activeServices?.objectUrls.dispose();
      activeServices?.database.close();
      servicesRef.current = null;
    };
  }, [loadConversation, resolveCapability]);

  const createConversation = useCallback(
    async (
      assistantId = DEFAULT_ASSISTANT_ID,
      activateDefaultModel = true,
      enableWebSearch = false,
    ) => {
      if (
        activateDefaultModel &&
        defaultModel &&
        defaultModel !== connectionRef.current.modelId
      ) {
        await setActiveModel(defaultModel);
      }
      const services = requireServices();
      const assistant = await services.assistants.get(assistantId);
      const created = await services.conversations.createConversation({
        activeModelId: connectionRef.current.modelId,
        webSearchEnabled: enableWebSearch,
        assistant: {
          id: assistant.id,
          snapshot: services.assistants.snapshot(assistant),
        },
      });
      await refreshLists();
      await loadConversation(created.id);
      return created;
    },
    [
      defaultModel,
      loadConversation,
      refreshLists,
      requireServices,
      setActiveModel,
    ],
  );

  const saveAssistant = useCallback(
    async (
      assistantId: string | null,
      input: Parameters<AssistantRepository["create"]>[0],
    ) => {
      const services = requireServices();
      const saved = assistantId
        ? await services.assistants.update(assistantId, input)
        : await services.assistants.create(input);
      await refreshLists();
      return saved;
    },
    [refreshLists, requireServices],
  );

  const deleteAssistant = useCallback(
    async (assistantId: string) => {
      await requireServices().assistants.delete(assistantId);
      await refreshLists();
    },
    [refreshLists, requireServices],
  );

  const buildTransport = useCallback(
    (value: ConnectionDraft) =>
      createChatTransport(
        {
          ...value,
          endpointType: resolveModelEndpointType(
            value,
            value.modelId,
            modelDescriptorsRef.current,
          ),
        },
        fetch,
        requestTimeoutsRef.current,
      ),
    [],
  );

  const refreshModels = useCallback(
    async (value: ConnectionDraft = connection) => {
      const refreshEpoch = ++modelRefreshEpochRef.current;
      setError(null);
      const scope = connectionScope(value);
      try {
        const result = resolveModelList(
          await buildTransport(value).listModels(),
          value.apiType,
          value.modelId,
        );
        if (refreshEpoch !== modelRefreshEpochRef.current) {
          return result.modelIds;
        }
        let nextDescriptors: ModelDescriptor[];
        if (result.source === "remote") {
          const write = modelCacheWriteChainRef.current.then(async () => {
            if (refreshEpoch !== modelRefreshEpochRef.current) return null;
            return requireServices().modelLists.save(scope, result.models);
          });
          modelCacheWriteChainRef.current = write.then(
            () => undefined,
            () => undefined,
          );
          nextDescriptors = (await write) ?? result.models;
        } else {
          nextDescriptors = await resolveCachedModels(
            requireServices().modelLists,
            scope,
            result.models,
          );
        }
        const modelState = await requireServices().modelLists.loadState(scope);
        if (refreshEpoch === modelRefreshEpochRef.current) {
          modelDescriptorsRef.current = structuredClone(nextDescriptors);
          const nextAvailableModels = resolveVisibleModelIds(
            value.modelId,
            nextDescriptors.map(({ id }) => id),
          );
          const nextModelProjection = projectConnectionModels({
            mode: value.mode,
            currentModelId: value.modelId,
            availableModelIds: nextAvailableModels,
            persistedEnabledModelIds: modelState.enabledModelIds,
            requiredModelIds: [defaultModel ?? "", titleModel ?? ""],
          });
          setEnabledModels(nextModelProjection.enabledModels);
          setAvailableModels(nextAvailableModels);
          setModels(nextModelProjection.models);
          await resolveCapability(value);
        }
        return nextDescriptors.map(({ id }) => id);
      } catch (cause) {
        const cachedModels = await requireServices()
          .modelLists.load(scope)
          .catch(() => []);
        const modelState = await requireServices()
          .modelLists.loadState(scope)
          .catch(() => null);
        if (refreshEpoch === modelRefreshEpochRef.current) {
          const fallbackDescriptors =
            value.mode === "hosted" && publicConfig
              ? descriptorsFromIds(publicConfig.models)
              : (modelState?.discoveredModels ??
                descriptorsFromIds(cachedModels));
          modelDescriptorsRef.current = structuredClone(fallbackDescriptors);
          const fallbackAvailableModels = resolveVisibleModelIds(
            value.modelId,
            fallbackDescriptors.map(({ id }) => id),
          );
          const fallbackModelProjection = projectConnectionModels({
            mode: value.mode,
            currentModelId: value.modelId,
            availableModelIds: fallbackAvailableModels,
            persistedEnabledModelIds: modelState?.enabledModelIds ?? null,
            requiredModelIds: [defaultModel ?? "", titleModel ?? ""],
          });
          setEnabledModels(fallbackModelProjection.enabledModels);
          setAvailableModels(fallbackAvailableModels);
          setModels(fallbackModelProjection.models);
          await resolveCapability(value);
        }
        throw cause;
      }
    },
    [
      buildTransport,
      connection,
      defaultModel,
      publicConfig,
      requireServices,
      resolveCapability,
      titleModel,
    ],
  );

  const saveConnection = useCallback(
    async (value: ConnectionDraft) => {
      setError(null);
      modelRefreshEpochRef.current += 1;
      capabilityResolutionEpochRef.current += 1;
      const previousConnection = connectionRef.current;
      const { connection: nextConnection } = await saveConnectionChange(
        { previous: previousConnection, draft: value },
        {
          authenticateHosted: async (accessCode) => {
            const response = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accessCode }),
            });
            if (!response.ok) {
              const code = errorCodeForStatus(response.status);
              throw new ChatTransportError(
                code,
                t(`chatError.${code}`),
                response.status,
              );
            }
            hostedAuthEpochRef.current += 1;
            setPublicConfig((current) =>
              current ? { ...current, authenticated: true } : current,
            );
          },
          clearModelCache: async (scope) => {
            const clear = modelCacheWriteChainRef.current.then(() =>
              requireServices().modelLists.clear(scope),
            );
            modelCacheWriteChainRef.current = clear.then(
              () => undefined,
              () => undefined,
            );
            await clear;
          },
          persistConnection: (bundle) =>
            requireServices().connections.save(bundle),
          now: () => new Date().toISOString(),
        },
      );
      connectionRef.current = nextConnection;
      modelDescriptorsRef.current = descriptorsFromIds([
        nextConnection.modelId,
      ]);
      capabilityIdentityRef.current = null;
      setCapability(null);
      setModelPreferences(createDefaultModelPreferences());
      setReasoningChoice(DEFAULT_REASONING_CHOICE);
      setConnection(nextConnection);
      const nextAvailableModels = resolveVisibleModelIds(
        nextConnection.modelId,
        nextConnection.mode === "hosted" ? (publicConfig?.models ?? []) : [],
      );
      const nextModelProjection = projectConnectionModels({
        mode: nextConnection.mode,
        currentModelId: nextConnection.modelId,
        availableModelIds: nextAvailableModels,
        persistedEnabledModelIds: null,
      });
      setAvailableModels(nextAvailableModels);
      setEnabledModels(nextModelProjection.enabledModels);
      setModels(nextModelProjection.models);
      await resolveCapability(nextConnection);
      await refreshModels(nextConnection).catch(() => undefined);
    },
    [publicConfig, refreshModels, requireServices, resolveCapability, t],
  );

  const saveDefaultModel = useCallback(
    async (modelId: string) => {
      const normalized = modelId.trim();
      if (!normalized) throw new Error(t("selectModelError"));
      await requireServices().database.settings.put({
        key: DEFAULT_MODEL_SETTINGS_KEY,
        value: normalized,
        updatedAt: new Date().toISOString(),
      });
      setDefaultModel(normalized);
      return normalized;
    },
    [requireServices, t],
  );

  const saveTitleModel = useCallback(
    async (modelId: string) => {
      const normalized = modelId.trim();
      if (!normalized || !models.includes(normalized)) {
        throw new Error(t("selectModelError"));
      }
      await requireServices().database.settings.put({
        key: TITLE_MODEL_SETTINGS_KEY,
        value: normalized,
        updatedAt: new Date().toISOString(),
      });
      setTitleModel(normalized);
      return normalized;
    },
    [models, requireServices, t],
  );

  const saveEnabledModels = useCallback(
    async (modelIds: readonly string[]) => {
      if (connection.mode === "hosted") {
        const projection = projectConnectionModels({
          mode: connection.mode,
          currentModelId: connection.modelId,
          availableModelIds: modelDescriptorsRef.current.map(({ id }) => id),
          persistedEnabledModelIds: null,
          requiredModelIds: [defaultModel ?? "", titleModel ?? ""],
        });
        setEnabledModels(projection.enabledModels);
        setModels(projection.models);
        return projection.enabledModels;
      }
      const normalized = Array.from(
        new Set(
          modelIds
            .map((modelId) => modelId.normalize("NFKC").trim())
            .filter(Boolean),
        ),
      );
      const saved = await requireServices().modelLists.saveEnabled(
        connectionScope(connection),
        normalized,
        modelDescriptorsRef.current,
      );
      setEnabledModels(saved);
      setModels(
        resolveEnabledModelIds(connection.modelId, saved, [
          defaultModel ?? "",
          titleModel ?? "",
        ]),
      );
      return saved;
    },
    [connection, defaultModel, requireServices, titleModel],
  );

  const saveWebSearchSettings = useCallback(
    async (input: WebSearchSaveInput) => {
      const candidate = webSearchConfigurationFromSaveInput(input);
      if (
        input.enabled &&
        !resolveWebSearchSource(
          connectionRef.current.mode,
          candidate,
          publicConfig,
        )
      ) {
        throw new ChatTransportError(
          "INVALID_REQUEST",
          "Web search is not configured",
          null,
        );
      }
      const saved = await requireServices().webSearch.save(input);
      setWebSearchConfig(saved);
      return saved;
    },
    [publicConfig, requireServices],
  );

  const createHostedWebSearchUnauthorizedHandler = useCallback(() => {
    const requestEpoch = hostedAuthEpochRef.current;
    return () => {
      if (requestEpoch !== hostedAuthEpochRef.current) return;
      hostedAuthEpochRef.current += 1;
      setPublicConfig((current) =>
        current ? { ...current, authenticated: false } : current,
      );
    };
  }, []);

  const testWebSearch = useCallback(
    async (input: WebSearchConfiguration) => {
      const source = resolveWebSearchSource(
        connectionRef.current.mode,
        input,
        publicConfig,
      );
      if (!source) {
        throw new ChatTransportError(
          "INVALID_REQUEST",
          "Web search is not configured",
          null,
        );
      }
      const executor = createWebSearchExecutor(
        source,
        input.maxResults,
        createHostedWebSearchUnauthorizedHandler(),
      );
      await executor.execute(
        { query: "Web search connection test" },
        new AbortController().signal,
      );
    },
    [createHostedWebSearchUnauthorizedHandler, publicConfig],
  );

  const setConversationWebSearch = useCallback(
    async (enabled: boolean) => {
      if (
        enabled &&
        (!webSearchConfig.enabled ||
          !resolveWebSearchSource(
            connectionRef.current.mode,
            webSearchConfig,
            publicConfig,
          ))
      ) {
        throw new ChatTransportError(
          "INVALID_REQUEST",
          "Web search is not configured",
          null,
        );
      }
      const conversationId = currentConversationIdRef.current;
      if (conversationId) {
        await requireServices().conversations.setWebSearchEnabled(
          conversationId,
          enabled,
        );
        setCurrentConversation((current) =>
          current?.id === conversationId
            ? { ...current, webSearchEnabled: enabled }
            : current,
        );
      }
      webSearchEnabledRef.current = enabled;
      setWebSearchEnabled(enabled);
    },
    [publicConfig, requireServices, webSearchConfig],
  );

  const settleActiveGeneration = useCallback(
    async (conversationId?: string) => {
      const preparation = generationPreparationRef.current;
      if (preparation) {
        if (
          conversationId === undefined ||
          preparation.conversationId === conversationId
        ) {
          preparation.controller.abort();
        }
        await preparation.ready;
      }

      const active = activeGenerationRef.current;
      if (
        !active ||
        (conversationId !== undefined &&
          active.conversationId !== conversationId)
      ) {
        return;
      }
      active.controller.abort();
      await active.completion;
    },
    [],
  );

  const selectAssistant = useCallback(
    async (assistantId: string) => {
      if (currentConversation?.assistantId === assistantId) {
        return currentConversation;
      }
      await settleActiveGeneration();
      const services = requireServices();
      const assistant = await services.assistants.get(assistantId);
      const binding = {
        id: assistant.id,
        snapshot: services.assistants.snapshot(assistant),
      };
      if (currentConversation) {
        const rebound = await services.conversations.rebindAssistantIfEmpty(
          currentConversation.id,
          binding,
        );
        if (rebound) {
          await refreshLists();
          await loadConversation(currentConversation.id);
          return services.conversations.getConversation(currentConversation.id);
        }
      }
      return createConversation(assistantId);
    },
    [
      createConversation,
      currentConversation,
      loadConversation,
      refreshLists,
      requireServices,
      settleActiveGeneration,
    ],
  );

  const generateAssistant = useCallback(
    async (
      conversationRecord: ConversationRecord,
      user: MessageNode,
      historyPath: readonly MessageNode[],
      versionOfAssistantId: string | null,
      preparation: GenerationPreparation,
    ) => {
      const services = requireServices();
      const endpointType = resolveModelEndpointType(
        connection,
        connection.modelId,
        modelDescriptorsRef.current,
      );
      const identity = modelCapabilityIdentity(connection, endpointType);
      const resolved =
        capabilityIdentityRef.current === identity &&
        capability?.modelId === connection.modelId
          ? capability
          : await resolveCapability(connection);
      if (!resolved) throw new Error(t("selectModelError"));
      const preferences =
        capabilityIdentityRef.current === identity &&
        capability?.modelId === connection.modelId
          ? modelPreferences
          : await services.capabilities.resolvePreferences(
              connectionScope(connection),
              connection.modelId,
            );
      if (
        identity !==
        modelCapabilityIdentity(
          connectionRef.current,
          resolveModelEndpointType(
            connectionRef.current,
            connectionRef.current.modelId,
            modelDescriptorsRef.current,
          ),
        )
      ) {
        throw new Error(t("selectModelError"));
      }
      const built = await buildChatCompletionsRequest({
        modelId: connection.modelId,
        capability: resolved,
        preferences,
        reasoning: reasoningChoice,
        systemPrompt: conversationRecord.assistantSnapshot.systemPrompt,
        historyPath,
        currentUserMessage: user,
        contextCutoffId: conversationRecord.contextCutoffId,
        loadAttachment: async (id) =>
          (await services.attachments.get(id)) ?? null,
      });
      setContextStats({
        configuredHistoryMessages: built.context.configuredHistoryMessages,
        actualHistoryMessages: built.context.actualHistoryMessages,
        inputEstimate: built.context.inputEstimate,
        inputBudgetTokens: built.context.inputBudgetTokens,
      });
      const assistantInput = {
        role: "assistant" as const,
        parts: [],
        status: "pending" as const,
        modelSnapshot: {
          modelId: connection.modelId,
          connectionScope: connectionScope(connection),
        },
      };
      const assistant = versionOfAssistantId
        ? await services.conversations.createVersion(
            versionOfAssistantId,
            assistantInput,
          )
        : await services.conversations.appendMessage(
            conversationRecord.id,
            assistantInput,
          );
      setPath([...historyPath, user, assistant]);
      const controller = preparation.controller;
      const generationId = crypto.randomUUID();
      let resolveCompletion: () => void = () => {};
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });
      const startedAt = Date.now();
      const initialSnapshot: StreamSnapshot = {
        state: "connecting",
        reasoningText: "",
        finalText: "",
        reasoningSource: null,
        tagState: "before-content",
        usage: null,
        toolCalls: [],
        contentParts: [],
        providerContextParts: [],
        reasoningDurationMs: null,
        startedAt,
        updatedAt: startedAt,
      };
      activeGenerationRef.current = {
        id: generationId,
        conversationId: conversationRecord.id,
        assistantMessageId: assistant.id,
        controller,
        completion,
      };
      setActiveGeneration({
        id: generationId,
        conversationId: conversationRecord.id,
        assistantMessageId: assistant.id,
        snapshot: initialSnapshot,
      });
      preparation.resolveReady();
      if (generationPreparationRef.current === preparation) {
        generationPreparationRef.current = null;
      }
      const persistence = new ThrottledStreamPersistence(
        new MessageStreamPersistence(services.database, assistant.id),
      );
      let latestSnapshot = initialSnapshot;
      const snapshotDispatcher = new FrameSnapshotDispatcher((snapshot) => {
        setActiveGeneration((current) =>
          current?.id === generationId ? { ...current, snapshot } : current,
        );
      });

      try {
        const webSearchSource = resolveWebSearchSource(
          connection.mode,
          webSearchConfig,
          publicConfig,
        );
        if (
          conversationRecord.webSearchEnabled &&
          (!webSearchConfig.enabled ||
            webSearchSource === null ||
            !resolved.tools)
        ) {
          throw new ChatTransportError(
            "WEB_SEARCH_UNAVAILABLE",
            t("chatError.WEB_SEARCH_UNAVAILABLE"),
            null,
          );
        }
        const webSearchAvailable =
          conversationRecord.webSearchEnabled &&
          webSearchConfig.enabled &&
          webSearchSource !== null &&
          resolved.tools;
        const registry = new ToolRegistry(
          webSearchAvailable && webSearchSource
            ? [
                createWebSearchExecutor(
                  webSearchSource,
                  webSearchConfig.maxResults,
                  createHostedWebSearchUnauthorizedHandler(),
                ),
              ]
            : [],
        );
        const definitions = registry.definitions();
        const request = {
          ...built.request,
          ...(definitions.length > 0 ? { tools: definitions } : {}),
        };
        const transportConnection = { ...connection, endpointType };
        const runtime = await loadAgentRuntime(
          resolveAgentRuntimeKind(transportConnection),
        );
        const estimator = new DefaultTokenEstimator();
        await runtime.run({
          request,
          connection: transportConnection,
          timeoutPolicy: requestTimeoutsRef.current,
          signal: controller.signal,
          persistence,
          registry,
          supportsReasoning: resolved.reasoning,
          onSnapshot: (snapshot) => {
            latestSnapshot = snapshot;
            snapshotDispatcher.schedule(snapshot);
          },
          estimateUsage: ({ finalText }) => {
            const completionTokens = estimator.estimate(
              [{ role: "assistant", content: finalText }],
              connection.modelId,
            ).tokens;
            return {
              promptTokens: built.context.inputEstimate.tokens,
              completionTokens,
              reasoningTokens: null,
              totalTokens:
                built.context.inputEstimate.tokens + completionTokens,
              estimated: true,
            };
          },
        });
      } catch (cause) {
        const transportError =
          cause instanceof ChatTransportError
            ? cause
            : new ChatTransportError(
                "UPSTREAM_ERROR",
                cause instanceof Error
                  ? cause.message
                  : "Upstream request failed",
                null,
              );
        const stopped =
          transportError.code === "ABORTED" || controller.signal.aborted;
        const updatedAt = Date.now();
        await persistence.finish({
          ...latestSnapshot,
          state: stopped ? "stopped" : "error",
          updatedAt,
          error: stopped ? null : transportError,
        });
      } finally {
        snapshotDispatcher.flush();
        try {
          if (
            activeGenerationRef.current?.id === generationId &&
            currentConversationIdRef.current === conversationRecord.id
          ) {
            await loadConversation(conversationRecord.id);
          }
          await refreshLists();
        } catch (cause) {
          if (
            activeGenerationRef.current?.id === generationId &&
            !controller.signal.aborted
          ) {
            setError(formatUserFacingError(cause, t));
          }
        } finally {
          if (activeGenerationRef.current?.id === generationId) {
            activeGenerationRef.current = null;
            setActiveGeneration((current) =>
              current?.id === generationId ? null : current,
            );
          }
          resolveCompletion();
        }
      }
    },
    [
      capability,
      connection,
      loadConversation,
      createHostedWebSearchUnauthorizedHandler,
      modelPreferences,
      publicConfig,
      reasoningChoice,
      refreshLists,
      requireServices,
      resolveCapability,
      t,
      webSearchConfig,
    ],
  );

  const maybeGenerateTitle = useCallback(
    async (conversationId: string) => {
      try {
        const services = requireServices();
        const [conversationRecord, messages, attempted] = await Promise.all([
          services.conversations.getConversation(conversationId),
          services.conversations.listMessages(conversationId),
          services.database.meta.get(
            `${TITLE_ATTEMPT_PREFIX}${conversationId}`,
          ),
        ]);
        if (attempted || !shouldGenerateTitle(conversationRecord, messages)) {
          return;
        }
        await services.database.meta.put({
          key: `${TITLE_ATTEMPT_PREFIX}${conversationId}`,
          value: true,
          updatedAt: new Date().toISOString(),
        });
        const titleModelId = titleModel ?? connection.modelId;
        const response = await buildTransport({
          ...connection,
          modelId: titleModelId,
        }).createChatCompletion(buildTitleRequest(titleModelId, messages));
        const title = parseGeneratedTitle(await response.json());
        await services.conversations.setAiTitle(conversationId, title);
        await refreshLists();
      } catch {
        // 标题属于非关键增强；会话被删除或请求失败时保留本地标题。
      }
    },
    [buildTransport, connection, refreshLists, requireServices, titleModel],
  );

  const send = useCallback(async () => {
    if (
      (!draft.trim() && pendingAttachments.length === 0) ||
      generationStartingRef.current ||
      activeGenerationRef.current
    ) {
      return;
    }
    const preparation = createGenerationPreparation(
      currentConversation?.id ?? null,
    );
    let titleConversationId: string | null = null;
    generationStartingRef.current = true;
    setGenerationStarting(true);
    generationPreparationRef.current = preparation;
    try {
      setError(null);
      const services = requireServices();
      let conversationRecord = currentConversation;
      if (!conversationRecord) {
        conversationRecord = await createConversation(
          DEFAULT_ASSISTANT_ID,
          false,
          webSearchEnabled,
        );
      }
      preparation.conversationId = conversationRecord.id;
      const user = await services.conversations.appendMessage(
        conversationRecord.id,
        {
          role: "user",
          parts: [
            ...(draft.trim()
              ? [{ type: "text" as const, text: draft.trim() }]
              : []),
            ...pendingAttachments.map((attachment) => ({
              type: "image_ref" as const,
              attachmentId: attachment.id,
              alt: null,
            })),
          ],
        },
      );
      if (path.length === 0 && draft.trim()) {
        await services.conversations.setLocalTitle(
          conversationRecord.id,
          draft.trim().slice(0, 48),
        );
      }
      const currentPath = await services.conversations.getCurrentPath(
        conversationRecord.id,
      );
      setDraft("");
      setPendingAttachments([]);
      await generateAssistant(
        conversationRecord,
        user,
        currentPath.slice(0, -1),
        null,
        preparation,
      );
      titleConversationId = conversationRecord.id;
    } finally {
      preparation.resolveReady();
      if (generationPreparationRef.current === preparation) {
        generationPreparationRef.current = null;
      }
      generationStartingRef.current = false;
      setGenerationStarting(false);
    }
    if (titleConversationId) void maybeGenerateTitle(titleConversationId);
  }, [
    createConversation,
    currentConversation,
    draft,
    generateAssistant,
    path.length,
    pendingAttachments,
    requireServices,
    maybeGenerateTitle,
    webSearchEnabled,
  ]);

  const regenerateAssistant = useCallback(
    async (assistantId: string) => {
      if (
        !currentConversation ||
        generationStartingRef.current ||
        activeGenerationRef.current
      ) {
        return;
      }
      const preparation = createGenerationPreparation(currentConversation.id);
      generationStartingRef.current = true;
      setGenerationStarting(true);
      generationPreparationRef.current = preparation;
      try {
        setError(null);
        const services = requireServices();
        const assistant = allMessages.find(({ id }) => id === assistantId);
        if (
          !assistant ||
          assistant.role !== "assistant" ||
          !assistant.parentId
        ) {
          throw new Error(t("regenerateError"));
        }
        const parentPath = await services.conversations.selectPathToMessage(
          assistant.parentId,
        );
        const user = parentPath.at(-1);
        if (!user || user.role !== "user") {
          throw new Error(t("regenerateError"));
        }
        const conversationRecord = await services.conversations.getConversation(
          currentConversation.id,
        );
        await generateAssistant(
          conversationRecord,
          user,
          parentPath.slice(0, -1),
          assistant.id,
          preparation,
        );
      } finally {
        preparation.resolveReady();
        if (generationPreparationRef.current === preparation) {
          generationPreparationRef.current = null;
        }
        generationStartingRef.current = false;
        setGenerationStarting(false);
      }
    },
    [allMessages, currentConversation, generateAssistant, requireServices, t],
  );

  const addImages = useCallback(
    async (files: readonly File[]) => {
      const services = requireServices();
      const operationEpoch = conversationLoadEpochRef.current;
      if (pendingAttachments.length + files.length > 3) {
        throw new Error(t("imageLimitError"));
      }
      const saved: AttachmentRecord[] = [];
      for (const file of files) {
        const processed = await services.imageProcessor.process(file);
        if (operationEpoch !== conversationLoadEpochRef.current) return;
        const attachment = await services.attachments.save(processed);
        if (operationEpoch !== conversationLoadEpochRef.current) return;
        saved.push(attachment);
      }
      const urls = Object.fromEntries(
        saved.map((attachment) => [
          attachment.id,
          services.objectUrls.acquire(attachment.id, attachment.blob),
        ]),
      );
      setAttachmentUrls((previous) => ({ ...previous, ...urls }));
      setPendingAttachments((previous) => [...previous, ...saved]);
    },
    [pendingAttachments.length, requireServices, t],
  );

  const removePendingAttachment = useCallback(
    (attachmentId: string) => {
      setPendingAttachments((items) =>
        items.filter(({ id }) => id !== attachmentId),
      );
      requireServices().objectUrls.release(attachmentId);
      setAttachmentUrls((previous) => {
        const next = { ...previous };
        delete next[attachmentId];
        return next;
      });
    },
    [requireServices],
  );

  const archiveConversation = useCallback(
    async (conversationId: string) => {
      const isCurrent = currentConversationIdRef.current === conversationId;
      const index = conversations.findIndex(({ id }) => id === conversationId);
      const neighbor = conversations[index + 1] ?? conversations[index - 1];
      await settleActiveGeneration(conversationId);
      await requireServices().conversations.setArchived(conversationId, true);
      if (isCurrent) clearCurrentProjection();
      await refreshLists();
      if (isCurrent && neighbor) await loadConversation(neighbor.id);
    },
    [
      clearCurrentProjection,
      conversations,
      loadConversation,
      refreshLists,
      requireServices,
      settleActiveGeneration,
    ],
  );

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      if (!title.trim()) return;
      await requireServices().conversations.rename(
        conversationId,
        title.trim().slice(0, 80),
      );
      if (currentConversationIdRef.current === conversationId) {
        await loadConversation(conversationId);
      }
      await refreshLists();
    },
    [loadConversation, refreshLists, requireServices],
  );

  const restoreConversation = useCallback(
    async (conversationId: string) => {
      await requireServices().conversations.setArchived(conversationId, false);
      await refreshLists();
      await loadConversation(conversationId);
    },
    [loadConversation, refreshLists, requireServices],
  );

  const selectModel = useCallback(
    async (modelId: string) => {
      const conversationId = currentConversationIdRef.current;
      const from = lastGeneratedModelId(path);
      if (conversationId) {
        await requireServices().conversations.setActiveModel(
          conversationId,
          modelId,
        );
      }
      await setActiveModel(modelId);
      if (conversationId) {
        setCurrentConversation((current) =>
          current?.id === conversationId
            ? { ...current, activeModelId: modelId }
            : current,
        );
      }
      return conversationId && from && from !== modelId
        ? { conversationId, from, to: modelId }
        : null;
    },
    [path, requireServices, setActiveModel],
  );

  const resolveModelCapability = useCallback(
    async (modelId: string) => {
      if (!modelId.trim()) return null;
      const scope = connectionScope(connection);
      return requireServices().capabilities.resolve(scope, modelId);
    },
    [connection, requireServices],
  );

  const resolveModelExecutionCapability = useCallback(
    async (modelId: string) => {
      if (!modelId.trim()) return null;
      const scope = connectionScope(connection);
      const modelCapability = await requireServices().capabilities.resolve(
        scope,
        modelId,
      );
      return resolveEffectiveModelCapability({
        modelCapability,
        endpointProfile: getConnectionEndpointProfile({
          ...connection,
          endpointType: resolveModelEndpointType(
            connection,
            modelId,
            modelDescriptorsRef.current,
          ),
        }),
      });
    },
    [connection, requireServices],
  );

  const resolveModelPreferences = useCallback(
    async (modelId: string) => {
      if (!modelId.trim()) return createDefaultModelPreferences();
      const scope = connectionScope(connection);
      return requireServices().capabilities.resolvePreferences(scope, modelId);
    },
    [connection, requireServices],
  );

  const saveModelSettings = useCallback(
    async (
      modelId: string,
      override: ModelCapabilityOverride,
      preferences: ModelPreferences,
    ) => {
      const normalized = modelId.trim();
      if (!normalized) throw new Error(t("selectModelError"));
      const scope = connectionScope(connection);
      const saved = await requireServices().capabilities.saveSettings(
        scope,
        normalized,
        override,
        preferences,
      );
      if (normalized === connection.modelId) {
        await resolveCapability(connection);
      }
      return saved;
    },
    [connection, requireServices, resolveCapability, t],
  );

  const resetModelSettings = useCallback(
    async (modelId: string) => {
      const normalized = modelId.trim();
      if (!normalized) return;
      const scope = connectionScope(connection);
      await requireServices().capabilities.resetSettings(scope, normalized);
      if (normalized === connection.modelId) {
        await resolveCapability(connection);
      }
    },
    [connection, requireServices, resolveCapability],
  );

  const saveModelCapability = useCallback(
    async (modelId: string, override: ModelCapabilityOverride) => {
      const normalized = modelId.trim();
      if (!normalized) throw new Error(t("selectModelError"));
      const scope = connectionScope(connection);
      const saved = await requireServices().capabilities.saveOverride(
        scope,
        normalized,
        override,
      );
      if (normalized === connection.modelId) {
        await resolveCapability(connection);
      }
      return saved;
    },
    [connection, requireServices, resolveCapability, t],
  );

  const resetModelCapability = useCallback(
    async (modelId: string) => {
      const normalized = modelId.trim();
      if (!normalized) return;
      const scope = connectionScope(connection);
      await requireServices().capabilities.reset(scope, normalized);
      if (normalized === connection.modelId) {
        await resolveCapability(connection);
      }
    },
    [connection, requireServices, resolveCapability],
  );

  const saveCapabilityOverride = useCallback(
    async (override: ModelCapabilityOverride) => {
      if (!connection.modelId) return;
      const scope = connectionScope(connection);
      await requireServices().capabilities.saveOverride(
        scope,
        connection.modelId,
        override,
      );
      await resolveCapability(connection);
    },
    [connection, requireServices, resolveCapability],
  );

  const resetCapabilityOverride = useCallback(async () => {
    if (!connection.modelId) return;
    const scope = connectionScope(connection);
    await requireServices().capabilities.reset(scope, connection.modelId);
    await resolveCapability(connection);
  }, [connection, requireServices, resolveCapability]);

  const selectVersion = useCallback(
    async (messageId: string) => {
      if (!currentConversation) return;
      await requireServices().conversations.selectVersion(messageId);
      await loadConversation(currentConversation.id);
    },
    [currentConversation, loadConversation, requireServices],
  );

  const editMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!currentConversation) return;
      await requireServices().conversations.editUserMessage(messageId, text);
      await loadConversation(currentConversation.id);
      await refreshLists();
    },
    [currentConversation, loadConversation, refreshLists, requireServices],
  );

  const generateUserBranch = useCallback(
    async (messageId: string, editedText?: string) => {
      if (
        !currentConversation ||
        generationStartingRef.current ||
        activeGenerationRef.current
      ) {
        return;
      }
      const preparation = createGenerationPreparation(currentConversation.id);
      generationStartingRef.current = true;
      setGenerationStarting(true);
      generationPreparationRef.current = preparation;
      try {
        setError(null);
        const services = requireServices();
        const userId =
          editedText === undefined
            ? messageId
            : (
                await services.conversations.editUserMessage(
                  messageId,
                  editedText,
                )
              ).id;
        const userPath =
          await services.conversations.selectPathToMessage(userId);
        const user = userPath.at(-1);
        if (!user || user.role !== "user") {
          throw new Error(t("regenerateError"));
        }
        const conversationRecord = await services.conversations.getConversation(
          currentConversation.id,
        );
        await generateAssistant(
          conversationRecord,
          user,
          userPath.slice(0, -1),
          null,
          preparation,
        );
      } finally {
        preparation.resolveReady();
        if (generationPreparationRef.current === preparation) {
          generationPreparationRef.current = null;
        }
        generationStartingRef.current = false;
        setGenerationStarting(false);
      }
    },
    [currentConversation, generateAssistant, requireServices, t],
  );

  const editAndRegenerate = useCallback(
    (messageId: string, text: string) => generateUserBranch(messageId, text),
    [generateUserBranch],
  );

  const generateUserMessage = useCallback(
    (messageId: string) => generateUserBranch(messageId),
    [generateUserBranch],
  );

  const setContextCutoff = useCallback(
    async (messageId: string | null) => {
      if (!currentConversation) return;
      await requireServices().conversations.setContextCutoff(
        currentConversation.id,
        messageId,
      );
      await loadConversation(currentConversation.id);
    },
    [currentConversation, loadConversation, requireServices],
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      const isCurrent = currentConversationIdRef.current === conversationId;
      const visibleList = isCurrent ? conversations : archivedConversations;
      const index = visibleList.findIndex(({ id }) => id === conversationId);
      const neighbor = visibleList[index + 1] ?? visibleList[index - 1];
      await settleActiveGeneration(conversationId);
      await requireServices().conversations.deleteConversation(conversationId);
      if (isCurrent) clearCurrentProjection();
      await refreshLists();
      if (isCurrent && neighbor) await loadConversation(neighbor.id);
    },
    [
      archivedConversations,
      clearCurrentProjection,
      conversations,
      loadConversation,
      refreshLists,
      requireServices,
      settleActiveGeneration,
    ],
  );

  const clearAllConversations = useCallback(async () => {
    await settleActiveGeneration();
    const services = requireServices();
    await services.conversations.clearConversations();
    clearCurrentProjection();
    setConversations([]);
    setArchivedConversations([]);
  }, [clearCurrentProjection, requireServices, settleActiveGeneration]);

  const search = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      setSearchResults(await requireServices().conversations.search(query));
    },
    [requireServices],
  );

  const openSearchResult = useCallback(
    async (conversationId: string, messageId: string | null) => {
      if (messageId) {
        await requireServices().conversations.selectPathToMessage(messageId);
      }
      await loadConversation(conversationId);
      setSearchOpen(false);
    },
    [loadConversation, requireServices],
  );

  const clearAllLocalData = useCallback(async () => {
    const services = requireServices();
    await settleActiveGeneration();
    services.objectUrls.dispose();
    const signOut = fetch("/api/auth", { method: "DELETE" }).catch(() => null);
    await clearLocalData(services.database, window.localStorage);
    await signOut;
    window.location.reload();
  }, [requireServices, settleActiveGeneration]);

  const createBackup = useCallback(async (): Promise<Blob> => {
    const database = requireServices().database;
    const updatedAt = new Date().toISOString();
    const language = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const theme = window.localStorage.getItem(THEME_STORAGE_KEY);
    await database.settings.bulkPut([
      ...(language ? [{ key: "language", value: language, updatedAt }] : []),
      ...(theme ? [{ key: "theme", value: theme, updatedAt }] : []),
    ]);
    return exportBackupArchive(database);
  }, [requireServices]);

  const inspectBackup = useCallback(async (file: Blob) => {
    const prepared = await prepareBackupImport(file);
    return { prepared, summary: summarizeBackup(prepared) };
  }, []);

  const restoreBackup = useCallback(
    async (prepared: PreparedBackup) => {
      await settleActiveGeneration();
      const database = requireServices().database;
      await importPreparedBackup(database, prepared);
      const [language, theme, restoredDefaultModel, restoredTitleModel] =
        await Promise.all([
          database.settings.get("language"),
          database.settings.get("theme"),
          database.settings.get(DEFAULT_MODEL_SETTINGS_KEY),
          database.settings.get(TITLE_MODEL_SETTINGS_KEY),
        ]);
      if (typeof language?.value === "string") {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language.value);
      }
      if (typeof theme?.value === "string") {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme.value);
      }
      if (typeof restoredDefaultModel?.value === "string") {
        setDefaultModel(restoredDefaultModel.value);
      }
      if (typeof restoredTitleModel?.value === "string") {
        setTitleModel(restoredTitleModel.value);
      }
      const restoredModelState = await requireServices().modelLists.loadState(
        connectionScope(connectionRef.current),
      );
      const restoredDescriptors =
        connectionRef.current.mode === "hosted"
          ? descriptorsFromIds(
              publicConfig?.models ??
                modelDescriptorsRef.current.map(({ id }) => id),
            )
          : restoredModelState.discoveredModels;
      modelDescriptorsRef.current = structuredClone(restoredDescriptors);
      const restoredAvailableModels = resolveVisibleModelIds(
        connectionRef.current.modelId,
        restoredDescriptors.map(({ id }) => id),
      );
      const restoredProjection = projectConnectionModels({
        mode: connectionRef.current.mode,
        currentModelId: connectionRef.current.modelId,
        availableModelIds: restoredAvailableModels,
        persistedEnabledModelIds: restoredModelState.enabledModelIds,
        requiredModelIds: [
          typeof restoredDefaultModel?.value === "string"
            ? restoredDefaultModel.value
            : (defaultModel ?? ""),
          typeof restoredTitleModel?.value === "string"
            ? restoredTitleModel.value
            : (titleModel ?? ""),
        ],
      });
      setAvailableModels(restoredAvailableModels);
      setEnabledModels(restoredProjection.enabledModels);
      setModels(restoredProjection.models);
      await resolveCapability(connectionRef.current);
      clearCurrentProjection();
      await refreshLists();
    },
    [
      clearCurrentProjection,
      defaultModel,
      publicConfig,
      refreshLists,
      requireServices,
      resolveCapability,
      settleActiveGeneration,
      titleModel,
    ],
  );

  const exportCurrentJson = useCallback(
    async (includeReasoning: boolean): Promise<DownloadArtifact> => {
      if (!currentConversation) throw new Error(t("selectConversationError"));
      return exportConversationJson(
        requireServices().database,
        currentConversation.id,
        includeReasoning,
      );
    },
    [currentConversation, requireServices, t],
  );

  const exportCurrentMarkdown = useCallback(
    async (includeReasoning: boolean): Promise<DownloadArtifact> => {
      if (!currentConversation) throw new Error(t("selectConversationError"));
      return exportConversationMarkdown(
        requireServices().database,
        currentConversation.id,
        includeReasoning,
      );
    },
    [currentConversation, requireServices, t],
  );

  const loadPrintProjection = useCallback(
    async (
      includeReasoning: boolean,
    ): Promise<ConversationExportProjection> => {
      if (!currentConversation) throw new Error(t("selectConversationError"));
      return loadConversationProjection(
        requireServices().database,
        currentConversation.id,
        "current",
        includeReasoning,
      );
    },
    [currentConversation, requireServices, t],
  );

  const stop = useCallback(
    () => settleActiveGeneration(),
    [settleActiveGeneration],
  );

  const webSearchSource = resolveWebSearchSource(
    connection.mode,
    webSearchConfig,
    publicConfig,
  );

  return {
    ready,
    online,
    storageDegraded,
    publicConfig,
    connection,
    defaultModel,
    titleModel,
    enabledModels,
    availableModels,
    models,
    webSearchConfig,
    webSearchSource: webSearchSource?.kind ?? null,
    webSearchEnabled,
    webSearchAvailable:
      webSearchConfig.enabled &&
      webSearchSource !== null &&
      capability?.tools === true,
    capability,
    modelPreferences,
    reasoningChoice,
    setReasoningChoice,
    conversations,
    archivedConversations,
    assistants,
    currentConversation,
    path,
    allMessages,
    draft,
    setDraft,
    pendingAttachments,
    attachmentUrls,
    activeGeneration,
    generationStarting,
    stream,
    contextStats,
    error,
    setError,
    settingsOpen,
    setSettingsOpen,
    searchOpen,
    setSearchOpen,
    searchQuery,
    searchResults,
    createConversation,
    selectAssistant,
    saveAssistant,
    deleteAssistant,
    loadConversation,
    saveConnection,
    saveDefaultModel,
    saveTitleModel,
    saveEnabledModels,
    refreshModels,
    saveWebSearchSettings,
    testWebSearch,
    setConversationWebSearch,
    send,
    regenerateAssistant,
    stop,
    addImages,
    removePendingAttachment,
    archiveConversation,
    renameConversation,
    restoreConversation,
    deleteConversation,
    clearAllConversations,
    selectModel,
    resolveModelCapability,
    resolveModelExecutionCapability,
    resolveModelPreferences,
    saveModelSettings,
    resetModelSettings,
    saveModelCapability,
    resetModelCapability,
    saveCapabilityOverride,
    resetCapabilityOverride,
    selectVersion,
    editMessage,
    editAndRegenerate,
    generateUserMessage,
    setContextCutoff,
    search,
    openSearchResult,
    clearAllLocalData,
    createBackup,
    inspectBackup,
    restoreBackup,
    exportCurrentJson,
    exportCurrentMarkdown,
    loadPrintProjection,
    refreshLists,
  };
}

function webSearchConfigurationFromSaveInput(
  input: WebSearchSaveInput,
): WebSearchConfiguration {
  return {
    enabled: input.enabled,
    maxResults: input.maxResults,
    provider: input.provider,
    providers: {
      tavily: {
        ...input.providers.tavily,
        hasApiKey: Boolean(input.providers.tavily.apiKey.trim()),
      },
      exa: {
        ...input.providers.exa,
        hasApiKey: Boolean(input.providers.exa.apiKey.trim()),
      },
      grok: {
        ...input.providers.grok,
        hasApiKey: Boolean(input.providers.grok.apiKey.trim()),
      },
    },
    hasApiKey: Boolean(input.providers[input.provider].apiKey.trim()),
  };
}

async function resolveCachedModels(
  repository: ModelListCacheRepository,
  scope: string,
  fallback: readonly ModelDescriptor[],
): Promise<ModelDescriptor[]> {
  const cached = await repository.loadDescriptors(scope);
  return cached.length > 0 ? cached : [...fallback];
}
