# Hook Guidelines

`src/features/chat/use-chat-controller.ts` is the primary custom hook and the
reference for feature orchestration. It owns browser service initialization,
current UI/runtime state, async commands, and cleanup, then returns a typed
`ChatController` facade to components.

## Required Pattern

- Name hooks `use<Feature>...` and keep them in `src/features/<feature>/`.
- Construct browser-only services inside effects or callbacks, never during
  server rendering.
- Keep stable service instances in refs and dispose object URLs/abort controllers
  during teardown.
- Wrap command functions in `useCallback` with complete dependencies.
- Translate stable domain errors through `readableError`; do not parse upstream
  strings independently in each component.
- Abort an active stream before destructive data operations.

## Fetching

CherryChat intentionally has no React Query/SWR cache. `/api/config` is loaded by
the controller, model/chat requests go through typed transports, and IndexedDB is
the local source of truth. Validate external JSON before promoting it to state.

## Scenario: Provider Endpoint Adapters

### 1. Scope / Trigger

Use this contract when adding or changing a Custom API protocol, reasoning
parameter format, model discovery route, or provider response parser.

### 2. Signatures

```ts
type NonStreamingChatCompletionsRequest = ChatCompletionsRequest & {
  stream: false;
};

interface ChatTransport {
  listModels(signal?: AbortSignal): Promise<unknown>;
  createChatCompletion(
    request: NonStreamingChatCompletionsRequest,
    signal?: AbortSignal,
  ): Promise<Response>;
}

createChatTransport(connection: ChatTransportConnection): ChatTransport;
```

`ChatTransportConnection` contains `mode`, `baseUrl`, `apiKey`, `modelId`, and
`apiType`. `ChatTransport` is an auxiliary boundary for model discovery and
automatic non-streaming titles. Main chat generation resolves and dynamically
loads an `AgentRuntime`; components only edit the connection draft.

### 3. Contracts

- `openai`, `new-api`, and `openai-compatible` discover through `/v1/models`;
  title completion uses JSON `/v1/chat/completions` with `stream:false`.
- `openai-responses` discovers through `/v1/models`; title completion maps the
  canonical non-streaming request to `/v1/responses` and normalizes JSON back to
  the shared Chat Completions response shape. Its serialized body always includes
  `store:false`; HTTP `cache:"no-store"` is a separate cache control and never
  substitutes for the provider retention field.
- `gemini` discovers through Gemini `v1beta`; title completion maps the
  canonical non-streaming request to `generateContent` and normalizes JSON.
- `anthropic` discovers through `/v1/models`; title completion maps the
  canonical non-streaming request to `/v1/messages` and normalizes JSON.
- Main chat streaming and non-streaming generation belongs to the four AI SDK
  runtimes. The provider SDK parses native events, while
  `AiSdkStreamProjector` owns CherryChat snapshots and persistence. Auxiliary
  transports must not retain an SSE mapper or become a generation fallback.
- Hosted connections always use the same-origin OpenAI-compatible routes and
  ignore persisted Custom API endpoint metadata.
- The Custom API form exposes one `API type` field with exactly OpenAI, OpenAI
  Responses, Anthropic, Gemini, New API, and Custom OpenAI compatible choices.
  There is no second compatibility-format field. Development-phase records
  without `apiType` are intentionally not migrated.
- The selected `apiType` is part of the model-list and capability cache scope.
- Auxiliary adapters never own persistence, cancellation state, or UI errors.
  `useChatController`, the selected `AgentRuntime`, and
  `AiSdkStreamProjector` own those concerns.

### 4. Validation & Error Matrix

| Condition | Adapter/controller behavior |
| --- | --- |
| Native endpoint has no absolute API URL | Reject with `INVALID_REQUEST` before saving |
| URL contains credentials, query, fragment, or unsupported scheme | Reject during endpoint normalization |
| Upstream status is 401/403/404/429 | Project stable `ChatTransportError` code/status |
| AI SDK provider stream is invalid or truncated | Raise `STREAM_PROTOCOL_ERROR` and persist the assistant error |
| Auxiliary completion request is not `stream:false` | Type error; no transport request |
| Auxiliary Responses serializer omits `store:false` | Contract regression; the exact request-body test must fail |
| Auxiliary provider returns invalid title JSON | Raise `STREAM_PROTOCOL_ERROR`; keep the local title |
| Request is aborted | Propagate `ABORTED` and finalize the message as stopped |
| Custom API discovery fails | Keep the scope's last-known-good model list |

### 5. Good / Base / Bad Cases

- Good: choose Gemini, save a direct URL, discover models through the auxiliary
  transport, then generate through `ai-sdk-google` while the projector renders
  reasoning, answer text, tools, and usage.
- Base: leave reasoning effort unset; the provider chooses its default and no
  provider-specific reasoning field is invented.
- Good: an automatic Responses title request sends both body `store:false` and
  fetch option `cache:"no-store"`; each field owns a different boundary.
- Bad: call `fetch` from a settings component, parse provider JSON in the
  controller, or let a native adapter write IndexedDB records directly.
- Bad: rely on `cache:"no-store"` while omitting body `store:false`; this disables
  HTTP caching but leaves the upstream Responses retention contract unspecified.
- Bad: reuse an OpenAI cache scope for Anthropic/Gemini or silently fall back
  to the same-origin route when a native URL is missing.

### 6. Tests Required

- Auxiliary transport: model discovery, headers, non-streaming title request
  projection, JSON normalization, timeout, abort, and redacted errors for each
  adapter; no streaming mapper remains. The Responses test asserts the complete
  serialized body includes `store:false` and excludes hidden provider context.
- Runtime: streaming/non-streaming text, image, reasoning, tools, usage, abort,
  and errors for each of the four AI SDK providers.
- Factory: all six API types select the intended adapter and Hosted remains
  pinned to the same-origin OpenAI Chat transport.
- Storage: all six API types round-trip without changing the credential-free
  backup contract; records without `apiType` are rejected.
- Component/E2E: Custom API exposes exactly one API-type selector, excluded
  providers never appear, and saved Gemini/Responses flows reach their native
  discovery and chat URLs.

### 7. Wrong vs Correct

```ts
// Wrong: provider-specific request and response logic leaks into React.
await fetch(connection.baseUrl + "/messages", { body: JSON.stringify(form) });

// Correct: auxiliary transport is limited to a non-streaming title request.
const response = await createChatTransport(connection).createChatCompletion(
  buildTitleRequest(titleModelId, messages),
  signal,
);

// Wrong: HTTP cache control does not declare upstream Responses retention.
fetch(responsesUrl, {
  cache: "no-store",
  body: JSON.stringify({ model, input }),
});

// Correct: the transport owns both independent controls.
fetch(responsesUrl, {
  cache: "no-store",
  body: JSON.stringify({ model, input, store: false }),
});

// Correct: main generation selects an endpoint-owned AI SDK runtime.
const runtime = await loadAgentRuntime(resolveAgentRuntimeKind(connection));
await runtime.run(options);
```

## Avoid

- A second hook that writes the same conversation/runtime state.
- Effects that silently persist incomplete initialization state.
- Capturing stale translations or connections in long-lived callbacks.
- Calling `fetch` from visual components when the operation belongs to the
  controller or `src/runtime/transport/`.

## Settings Controller Contract

### 1. Scope / Trigger

The settings workspace changes connection, discovered/enabled models, default
and title models, and model-capability state across React, IndexedDB, and request
construction. Keep these boundaries in `useChatController`; the component owns
only drafts and local errors.

### 2. Signatures

```ts
saveConnection(value: ConnectionDraft): Promise<void>;
refreshModels(value?: ConnectionDraft): Promise<string[]>;
saveEnabledModels(modelIds: readonly string[]): Promise<string[]>;
saveDefaultModel(modelId: string): Promise<string>;
saveTitleModel(modelId: string): Promise<string>;
resolveModelCapability(modelId: string): Promise<ResolvedModelCapability | null>;
resolveModelPreferences(modelId: string): Promise<ModelPreferences>;
saveModelSettings(
  modelId: string,
  override: ModelCapabilityOverride,
  preferences: ModelPreferences,
): Promise<ModelOverrideRecord>;
resetModelSettings(modelId: string): Promise<void>;
selectModel(modelId: string): Promise<{
  conversationId: string;
  from: string;
  to: string;
} | null>;

WebSearchRepository.load(options?: {
  defaultEnabled?: boolean;
}): Promise<WebSearchConfiguration>;

interface PublicConfig {
  hostedWebSearchEnabled: boolean;
  hostedWebSearchProvider: "tavily" | "exa" | "grok" | null;
  defaultModel: string | null;
  titleModel: string | null;
}

resolveInitialConnectionState(input: {
  config: PublicConfig;
  storedConnection: ConnectionBundle | null;
  storedDefaultModel: unknown;
  storedTitleModel: unknown;
}): InitialConnectionState;

saveConnectionChange(
  input: { previous: ConnectionDraft; draft: ConnectionDraft },
  ports: {
    authenticateHosted(accessCode: string): Promise<void>;
    clearModelCache(scope: string): Promise<void>;
    persistConnection(bundle: ConnectionBundle): Promise<void>;
    now(): string;
  },
): Promise<SaveConnectionResult>;
```

### 3. Contracts

- `defaultModel` is stored as the `settings` key `defaultModel`; a missing key
  falls back to the saved connection model, server default, and local fallback.
- `src/features/chat/connection-controller.ts` owns public-config validation,
  initial connection precedence, connection normalization/scope, and the
  connection-save sequence without importing React. `useChatController` remains
  the Facade and injects `fetch`, Repository operations, the serialized model
  cache mutation chain, translations, and React state updates.
- Connection saving runs `normalize -> Hosted authenticate -> optional target
  cache clear -> transactional connection persistence`. Authentication or
  normalization failure must stop before cache/persistence side effects. A
  successful Hosted authentication may update the authenticated projection even
  when a later local persistence step fails, because the HttpOnly Session Cookie
  is already active.
- `titleModel` is stored independently as the `settings` key `titleModel`; a
  missing key on a Hosted connection falls back to public `titleModel`, then
  `defaultModel`. A saved Custom API connection skips the Hosted title default.
  Only automatic title requests use it; normal completions continue using the
  active conversation model.
- Automatic title generation is a best-effort, at-most-once enhancement. Write
  the durable `title-attempt:<conversationId>` marker before starting the remote
  request. Failure keeps the local title and the marker; success only updates
  the title projection. A later send must not retry a failed or pending attempt.
- Startup resolves `/api/config` once and shares that promise with connection
  and web-search initialization. With no saved connection, Hosted mode wins
  when `hostedEnabled=true`; otherwise Custom API is selected. A saved
  connection always wins, including a saved Custom API on a Hosted deployment.
- The same public config passes `hostedWebSearchEnabled` to
  `WebSearchRepository.load({ defaultEnabled })`. This only derives the first
  unsaved global search permission; repository persistence remains authoritative
  after the user explicitly enables or disables it. The per-conversation search
  toggle still initializes off and never incurs search cost by itself.
- Public config carries `hostedWebSearchProvider` as the deployment default and
  ordered `hostedWebSearchProviders` as the allowed selection set. The
  controller uses a persisted `webSearch.hostedProvider` only while it remains
  allowed; otherwise it resolves the server default without rewriting BYOK
  `webSearch.provider`. Provider Key, URL, Grok model, and X Search remain absent
  from the public response and controller input.
- `availableModels` is the discovered projection. In BYOK, `models` is the
  user-enabled projection consumed by selectors; refreshing discovery never
  replaces that enabled list. In Hosted, the server's available list is the
  enabled list, and startup, refresh, fallback, connection save, and backup
  restore all ignore but do not delete a browser-saved subset. Required
  active/default/title models remain visible.
- Capability and preference writes are stored together and scoped by the
  current connection scope plus explicit `modelId`; header selection never
  rewrites the persisted default model.
- Model discovery uses one canonical connection scope. A saved Custom API
  restores its last successful list from IndexedDB with no time-based expiry;
  a failed refresh keeps that list. A connection or credential change clears
  the target scope before the new connection is persisted.
- New API discovery restores `ModelDescriptor[]`, not IDs alone. Success,
  cache fallback, and backup restore all synchronize `modelDescriptorsRef` and
  recompute effective capability before UI or transport selection continues.
- Every non-chat model role passes its own model ID to endpoint resolution.
  Title generation builds transport from `titleModelId`; model settings resolve
  the selected editor model, not the active chat model.
- Model refresh and capability resolution are identity-bearing async work.
  Refresh cache mutations run through one queue and re-check a monotonically
  increasing epoch when the mutation executes. Capability results may update
  React state only when both the epoch and canonical `scope + modelId` identity
  still match `connectionRef.current`.
- Explicit New chat creation activates the persisted default model. If the user
  selects a model on an empty workspace and sends directly, implicit creation
  preserves that selection instead of silently restoring the default.
- `selectModel` persists the target for the next request, but its optional
  switch event derives `from` from the current branch's last Assistant
  `modelSnapshot`. Before any Assistant reply, or when selecting that same
  answered model again, it returns `null`.
- `ModelPreferences.streaming` defaults to `true`. `temperature` and `topP`
  each use `{ enabled, value }`; disabled values are omitted from the request.
- An explicitly `unsupported` model capability disables the corresponding
  parameter control and omits the field even if legacy preferences enabled it;
  `unknown` remains user-configurable for custom APIs.
- Network search is available only when global settings, the active
  connection's mode-bound source, and effective `tools=true` agree. Hosted mode
  resolves only authenticated site search for the allowed local preference or
  public default; BYOK resolves only the locally selected Provider's personal
  Key/URL/model/options.
  A conversation
  whose saved flag is on must still be able to turn it off after authorization,
  key, model support, or global settings are removed; sending while intent is on
  must fail visibly instead of silently omitting tools.
- Main chat streaming and non-streaming requests both use the selected AI SDK
  runtime and pass through the same projector/persistence boundary. Automatic
  title requests always use auxiliary non-streaming JSON transports.
- Normal requests do not send `stream_options.include_usage`. Exact usage is
  read when returned; otherwise the runtime stores a local estimate.
- Request context ignores legacy `ConversationRecord.contextMessageLimit` and
  selects as many complete rounds as fit the model's token budget and cutoff.
- `TokenEstimator.estimate(messages, modelId).tokens` is monotonic when messages
  are appended. Context selection relies on that contract: estimate the base
  request, try the complete eligible history once, then binary-search the first
  fitting complete-round suffix. Reuse the winning estimate in the result.

### 4. Validation & Error Matrix

| Condition | Controller behavior |
| --- | --- |
| Empty default model or capability model ID | Reject with `selectModelError` |
| Empty enabled-model list or required model omitted | Reject to the model-selection form; do not mutate React state |
| Title model is empty or not enabled | Reject with `selectModelError` |
| No saved title model on first Hosted load | Use public `titleModel`, then effective default |
| Saved browser title model and public `titleModel` both exist | Restore the browser value |
| Direct BYOK URL is invalid | Reject before persistence |
| Hosted access code is rejected | Reject with `chatError.UNAUTHORIZED` |
| No saved connection and Hosted is available | Initialize access-code mode |
| Saved Custom API and Hosted is available | Restore Custom API; do not replace it |
| No saved search preference and Hosted search is available | Initialize global search permission on without persisting it |
| Saved search preference is off and any Provider is available | Restore off; source availability must not override user intent |
| Hosted mode has only saved personal Provider credentials | Keep them, but report site search unavailable until authenticated |
| Hosted allowlist contains one Provider | Display it in a locked selector |
| Hosted allowlist contains several Providers | Allow one global Settings selection; do not add conversation-level Provider state |
| Saved Hosted preference is no longer allowed | Resolve the public default without rewriting BYOK Provider or credentials |
| Hosted Provider is Grok while BYOK selection is Exa | Display Hosted Grok; do not rewrite or execute local Exa settings |
| Custom API has only a valid Hosted Session | Report personal setup required; do not call `/api/web-search` |
| Model discovery fails for the current scope | Keep its last-known-good list; reject to the settings action |
| Hosted cache/backup enables only a subset | Project every current server model; keep the stale subset stored but inactive |
| Cached New API list has endpoint metadata | Restore descriptors and recompute capability before rethrowing the refresh error |
| Title model uses another New API endpoint | Build title transport from the title model descriptor |
| An older model refresh finishes after a new connection starts | Return to its caller but do not write cache or React state |
| Connection scope or credential changes | Clear the target list cache before persisting the new connection |
| A answered, B selected without sending, then C selected | Return a switch event from A to C |
| A answered, B selected without sending, then A selected | Return `null`; do not invent a switch event |
| Capability override is malformed | Repository schema rejects the write |
| Temperature outside `0..2` or Top P outside `0..1` | Repository schema rejects the write |
| Non-streaming response is not valid Chat Completions JSON | Surface `STREAM_PROTOCOL_ERROR` and finalize the failed message |
| Settings action fails | Reject to the component; do not set `chat.error` |

### 5. Good / Base / Bad Cases

- Good: enable Temperature `0.7` for one model, disable streaming, save once,
  and send `{ stream: false, temperature: 0.7 }` with no `top_p` or
  `stream_options`.
- Base: leave both optional parameters disabled and stream with model defaults;
  history is limited only by the token budget.
- Good: connection A refreshes slowly while connection B is saved; B's models
  remain visible and A cannot repopulate the cache after B clears it.
- Good: a Custom API discovers 100 models, the user enables three, and title
  generation uses one of those three without changing the chat's active model.
- Good: current chat uses Gemini while the title model uses Responses through
  one New API service; each request reaches the endpoint selected by its model.
- Good: Hosted replies use `DEFAULT_MODEL` while automatic titles use
  `TITLE_MODEL`; a later browser save replaces only the title default.
- Base: reload the same saved Custom API without a network call and restore its
  cached model list.
- Good: a first-time Hosted deployment opens in access-code mode and shows
  global web search allowed, while the conversation search toggle remains off.
- Good: switching from access-code mode to Custom API keeps every personal
  Provider draft but requires the currently selected source; it never spends
  the deployment key.
- Good: an allowlist ordered `grok,tavily` still starts from the public Tavily
  default, then restores a saved Hosted Grok choice after reload.
- Good: the user saves Custom API and turns global search off; reload restores
  both choices even though Hosted model and search services remain available.
- Bad: treat "supports Temperature" as the value setting, or retain a hidden
  five-message cap after removing the old history-limit UI.
- Bad: compare only `modelId` or check an epoch before enqueueing a cache write;
  the connection may change before the IndexedDB transaction commits.
- Bad: call `setModels(result.modelIds)` after refresh; this makes discovery
  overwrite the user's enabled subset.

### 6. Tests Required

- Component/E2E: connection edits do not call `saveConnection` before the local
  save button and closing a dirty form asks for confirmation.
- Component/E2E: default model saving is independent from per-model settings;
  explicit new chats use the default while an empty workspace preserves a
  manually selected model on first send.
- Runtime: streaming defaults on; disabling it parses JSON responses;
  Temperature/Top P are sent only when enabled and usage options are absent.
- Runtime: automatic context includes every complete round that fits the token
  budget and still honors the explicit context-cutoff marker. Compare the full
  result against a linear test-only oracle, and cover zero/one round, fully
  fitting history, a partially fitting suffix, and an oversized newest round.
  Performance assertions use estimator call counts (`<= 2` when all history
  fits and logarithmic when pruning), never fixed elapsed-time thresholds.
- Repository: model-list save/load/clear is scope-isolated and clear preserves
  unrelated entries.
- Feature unit: initial Hosted/saved-Custom-API precedence plus the exact
  authentication/cache/persistence call order and failure short-circuit.
- Hook integration: execute the real `useChatController` with fake-indexeddb and
  Mock only `/api/config`, `/api/auth`, and `/api/models`; assert Hosted default,
  saved Custom API restoration, authentication request, state, and durable
  ConnectionStore round trip.
- Repository/component: discovery refresh preserves enabled IDs; required
  models cannot be deselected; legacy records without enablement stay valid.
- Hook/component: Hosted initialization and backup restore ignore stale enabled
  subsets, and the Hosted Model service renders no enablement checkboxes.
- Projection/browser: model switch events cover no prior answer, A -> B -> C
  without a B reply, selecting A again, and B replying before switching to C.
- Playwright: cached models survive reload and transient failure; a delayed
  connection-A response cannot replace connection B's list.
- Repository/Playwright: source-aware defaults apply only without records;
  explicit Custom API, selected Provider, inactive Provider configurations, and
  search opt-out choices survive reload on a Hosted deployment.
- Component/feature: switching Tavily/Exa/Grok preserves inactive fields;
  Hosted uses only the ordered allowlist, locks a one-item list, persists a
  multi-item selection separately, and always locks Key, URL, model, and
  X Search while BYOK exposes only the selected Provider's controls.
- Repository/Playwright: an allowed Hosted preference survives reload; removing
  it from public config falls back to the server default without changing BYOK.
- Playwright: an unenabled model is absent from chat/default/title selectors,
  and the actual title request body uses the saved title model.
- Server/Playwright: `TITLE_MODEL` must be allowed, appears in public config,
  and drives only the first unsaved Hosted title request.
- Playwright: after a title request fails, a second send produces no second
  non-streaming title request and keeps the local fallback title.
- Runtime/browser: search definitions are absent for `tools=false`, and a user
  override enables them for a verified unknown Custom API model.

### 7. Wrong vs Correct

```ts
// Wrong: disabling a control still sends a fallback value, and hidden legacy
// history settings continue truncating requests.
request.temperature = form.temperature.value;
selectRequestContext({ historyMessageLimit: conversation.contextMessageLimit });

// Correct: the selected model owns preferences; disabled fields are omitted
// and context selection is driven by the model token budget.
await controller.saveModelSettings(selectedModel, override, preferences);
selectRequestContext({ contextWindow: capability.contextWindow, history });

// Wrong: an async result writes after the active connection has changed.
setModels(await transport.listModels());

// Correct: cache writes are serialized and validate identity at execution time.
await enqueueModelCacheMutation(async () => {
  if (epoch !== modelRefreshEpochRef.current) return;
await modelLists.save(scope, modelDescriptors);
});

// Wrong: title generation silently follows a later chat-model switch.
buildTitleRequest(connection.modelId, messages);

// Correct: title and reply roles own both request model and transport endpoint.
const titleModelId = titleModel ?? connection.modelId;
buildTransport({ ...connection, modelId: titleModelId })
  .createChatCompletion(buildTitleRequest(titleModelId, messages));

// Correct: a deployment title model is only an unsaved Hosted default.
const initialTitleModel = storedTitleModel ??
  (connection.mode === "hosted" ? config.titleModel : null) ??
  defaultModel;

// Wrong: deployment availability replaces durable user choices on every load.
setConnection(config.hostedEnabled ? hostedDraft : byokDraft);
setWebSearchConfig({ ...storedSearch, enabled: config.hostedWebSearchEnabled });

// Correct: persisted choices win; deployment capability supplies only defaults.
const connection = storedConnection ??
  (config.hostedEnabled ? hostedDraft : byokDraft);
const webSearch = await repository.load({
  defaultEnabled: config.hostedWebSearchEnabled,
});

// Wrong: React callback branches duplicate ordering and are only tested through
// a fully mocked Controller.
await authenticate(draft.accessCode);
await modelLists.clear(scope);
await connections.save(bundle);

// Correct: one feature-local coordinator owns the order; the Facade supplies
// real side-effect ports and can be exercised through the actual Hook.
const saved = await saveConnectionChange(
  { previous: connectionRef.current, draft },
  { authenticateHosted, clearModelCache, persistConnection, now },
);
connectionRef.current = saved.connection;

// Wrong: repeatedly re-estimate every growing history suffix.
for (const round of rounds.toReversed()) {
  estimator.estimate([...round.messages, ...selected], modelId);
}

// Correct: use the monotonic contract to locate one complete suffix boundary.
const allEstimate = estimator.estimate(buildMessages(rounds), modelId);
const selectedStart = allEstimate.tokens <= budget
  ? 0
  : findFirstFittingSuffix(rounds, budget, estimator);
```
