# Browser Database Guidelines

CherryChat uses Dexie/IndexedDB in the browser. There is no Vercel-side database.
`src/storage/database.ts` is the only schema owner; domain record types come from
`src/runtime/chat/types.ts`.

## Schema and Transactions

- Define store/index strings once in `CHAT_DATABASE_STORES`.
- Use stable string IDs and declared compound keys for branch selections,
  message attachments, and model overrides.
- Validate records at repository boundaries with the runtime schemas.
- Use one Dexie `rw` transaction for related records. Connection and credential
  writes, message-tree mutations, imports, and destructive clears must not leave
  partial state.
- Convert browser exceptions through `normalizeStorageError` so UI code receives
  stable codes such as `QUOTA_EXCEEDED` and `TRANSACTION_FAILED`.

## Migrations

For released persistent schemas, add a monotonically increasing
`this.version(n)` block. Migrate existing records inside `upgrade()` without
deleting unknown user data and supply defaults for every new required field.
An explicitly approved development-only schema reset may reject old records
instead, but the active task and the owning code-spec must both state that no
migration is supported, and repository tests must assert rejection. The
v1-to-v2 reference and fixture are `ChatDatabase` and
`src/storage/database-migration.test.ts`.

## Fallback and Cleanup

Only the current connection/credential bundle falls back to localStorage when
IndexedDB cannot open (`ConnectionStore`). Chat history may fall back to page
memory but is not falsely reported as persistent. Clear operations must cover
both IndexedDB and the fallback key. Never describe local persistence as
encryption; same-origin scripts can read it.

Avoid direct table access outside repositories, non-transactional multi-table
writes, destructive migration rewrites, and persisted derived totals.

## Scenario: Multi-Provider Web Search Credentials And Interrupted Messages

### 1. Scope / Trigger

Use this contract when changing Tavily, Exa, or Grok search settings,
credentials, database migrations, backup/export, tool checkpoints, or startup
recovery.

### 2. Signatures

```ts
// Database v8
webSearchCredentials: "&id, updatedAt";
ConversationRecord.webSearchEnabled: boolean;

type WebSearchProviderId = "tavily" | "exa" | "grok";

interface WebSearchSettings {
  enabled: boolean;
  maxResults: number;
  provider: WebSearchProviderId;
  hostedProvider: WebSearchProviderId | null;
}

interface WebSearchLoadOptions {
  defaultEnabled?: boolean;
}

WebSearchRepository.load(
  options?: WebSearchLoadOptions,
): Promise<WebSearchConfiguration>;
WebSearchRepository.save(input: {
  enabled: boolean;
  maxResults: number;
  provider: WebSearchProviderId;
  hostedProvider: WebSearchProviderId | null;
  providers: {
    tavily: { apiKey: string; baseUrl: string };
    exa: { apiKey: string; baseUrl: string };
    grok: {
      apiKey: string;
      responsesUrl: string;
      model: string;
      xSearch: boolean;
    };
  };
}): Promise<WebSearchConfiguration>;

ConversationRepository.recoverInterruptedMessages(): Promise<number>;
```

### 3. Contracts

- Non-secret settings use `settings["webSearch.v2"]` and store `enabled`,
  `maxResults`, the BYOK `provider`, and nullable Hosted `hostedProvider`.
  Personal configurations use the dedicated `webSearchCredentials` records
  `tavily`, `exa`, and `grok`. The two Provider preferences are independent.
- Existing `webSearch.v2` records without `hostedProvider` parse as `null`; this
  optional-field evolution requires no Dexie schema upgrade. Backup/export may
  carry the non-sensitive Provider ID but never a deployment or personal bundle.
- Database v8 migrates a valid `webSearch.v1` value to `webSearch.v2` with
  `provider: "tavily"`, preserves the existing Tavily credential, then deletes
  only the legacy settings key. The Dexie upgrade transaction rolls back the
  write and delete together.
- `load({ defaultEnabled })` applies a source-aware default only when no valid
  `webSearch.v2` record exists. A valid credential for the selected Provider
  also defaults the
  unsaved setting on. Once the user saves either enabled or disabled, that
  persisted value always wins over deployment capability and credentials.
- Save settings and all three Provider records in one Dexie transaction.
  Switching Provider preserves valid inactive records; clearing one Provider's
  Key deletes only that record. A Key is 8..2048 trimmed characters, a URL is
  absolute HTTP(S) without credentials/query/fragment and at most 2048
  characters, and result count is 1..50 with a default of 5.
- Tavily and Exa store normalized base URLs. Grok stores a normalized complete
  Responses URL, a non-empty model of at most 512 characters, and `xSearch`;
  the defaults are `https://api.x.ai/v1/responses`, `grok-4.5`, and `false`.
- Backup/export includes the per-conversation toggle and non-secret settings,
  but excludes the complete credential table, including Provider URLs, Grok
  model, and X Search. Clear-local-data includes the table.
- On startup, Assistant rows left `pending` or `streaming` by a reload/crash are
  changed to `stopped`. A running tool part becomes the safe retryable
  `TOOL_REQUEST_ABORTED` projection; prior ordered text/tool parts remain.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Personal key is non-empty but shorter than 8 characters | Repository rejects before writing |
| Any personal Key has an invalid Provider URL | Reject the transaction before writing |
| Grok model is empty or over 512 characters | Reject the transaction before writing |
| Selected Provider has no valid credential | Keep the setting; expose `hasApiKey=false` |
| Switching from Tavily to Exa or Grok | Preserve valid inactive Provider records |
| Existing v2 record omits `hostedProvider` | Load `hostedProvider: null` without rewriting the record |
| Hosted preference changes | Preserve BYOK `provider` and all personal credentials |
| No settings record and `defaultEnabled=true` | Return enabled defaults without writing a preference |
| No settings record and a valid selected-Provider credential exists | Return enabled defaults and all Provider configurations |
| Saved `enabled=false` with any available source | Preserve the explicit disabled preference |
| Settings or any credential write fails | Transaction rolls back all search records |
| v7 has `webSearch.v1` plus Tavily credential | v8 writes `webSearch.v2` with Tavily selected and preserves the credential |
| Backup contains no Provider credential | Expected; restore leaves local configurations unchanged/absent |
| Pending Assistant has no parts | Recover as an empty stopped message |
| Streaming Assistant has a running tool | Preserve parts and mark that tool interrupted |
| Recovery runs again | Return zero; completed/stopped/error rows are unchanged |

### 5. Good/Base/Bad Cases

- Good: one browser configures Tavily, Exa, and Grok, switches among them, and
  each valid configuration remains available after reload.
- Good: the browser saves Hosted Grok while BYOK remains Tavily; switching modes
  and reloading preserves both choices without copying credentials.
- Good: export includes `webSearch.v2` preferences but no Key, Provider URL,
  Grok model, or X Search value from the credential table.
- Base: a browser with no Hosted source, personal credential, or saved setting
  loads disabled Tavily defaults, including Grok `grok-4.5` and X Search off in
  the inactive default configuration.
- Good: Hosted search becomes available on first use, so the controller passes
  `defaultEnabled: true`; a later explicit opt-out remains off after reload.
- Bad: put the key in `settings`, a conversation, a tool result, or an exported
  manifest because those stores are intentionally portable.

### 6. Tests Required

- Repository: three-Provider round trip, switching without credential loss,
  Hosted/BYOK preference isolation, legacy v2 missing-field parsing,
  source-aware unsaved defaults, persisted opt-out priority,
  selected-credential defaults, transactional save/load/delete,
  range/model/URL validation, and normalized storage errors.
- Migration: v5 to v6 adds the credential table and conversation toggles; v7 to
  v8 converts `webSearch.v1` to `webSearch.v2`, selects Tavily, preserves its
  credential, and removes only the legacy setting after the new write.
- Backup/clear: exclude all three Provider records and include the credential
  table in destructive clear.
- Recovery: text plus running tool becomes ordered stopped content; second run
  is idempotent.
- Build security: scan client static files for configured long secret values
  and server environment variable names without printing values.

### 7. Wrong vs Correct

```ts
// Wrong: portable settings leak BYOK secrets and make Provider switching lossy.
await database.settings.put({
  key: "webSearch.v2",
  value: { provider, apiKey, responsesUrl, model, xSearch },
  updatedAt,
});

// Correct: portable settings select a Provider; one non-exported table owns
// every Provider-specific credential bundle.
await database.settings.put({
  key: "webSearch.v2",
  value: { enabled, maxResults, provider, hostedProvider },
  updatedAt,
});
await database.webSearchCredentials.put({
  id: "grok",
  apiKey,
  responsesUrl,
  model,
  xSearch,
  encrypted: false,
  updatedAt,
});

// Wrong: materialize deployment capability as a user preference on startup.
await repository.save({ enabled: hostedWebSearchEnabled, ...defaults });

// Correct: derive only the unsaved load result; explicit saves remain durable.
await repository.load({ defaultEnabled: hostedWebSearchEnabled });
```

## Scenario: Persisted Assistant Generation Errors

### 1. Scope / Trigger

Use this contract when changing chat transport errors, stream finalization,
message rendering, retries, backups, or the message schema.

### 2. Signatures

- Database v5 adds `MessageNode.error: MessageError | null` and supplies `null`
  to legacy messages.
- `MessageError` contains `code: ChatErrorCode`, `status: number | null`, and
  `retryable: boolean`.
- `toMessageError(ChatTransportError)` is the only transport-to-storage
  projection.

### 3. Contracts

- Persist only the stable code, HTTP status, and retryability. Never persist raw
  transport message/detail, upstream bodies, Authorization values, or prompts.
- Error finalization preserves partial reasoning/text parts and usage.
  Completed/stopped finalization writes `error: null`.
- Error-status Assistant messages are excluded from future request context but
  remain selectable, exportable, restorable, and retryable in the UI.
- Backup message parsing defaults a missing error field to `null` so v2 archives
  created before database v5 remain importable.
- `structuredClone(Error)` does not preserve custom Error subclass fields in all
  browsers. Any clone boundary carrying a `ChatTransportError` must explicitly
  retain or project `code/status`; never assume a successful type-check proves
  runtime clone semantics.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Pre-v5 database message has no `error` | Migration writes `null` |
| Backup message has no `error` | Schema defaults it to `null` |
| Error code or HTTP status is invalid | Runtime schema rejects the backup |
| Generation completes or is stopped | Finalization writes `error: null` |
| Transport error contains raw detail | Projection omits message and detail |
| Custom Error crosses a clone boundary | Wrapper explicitly retains typed fields |

### 5. Good / Base / Bad Cases

- Good: a stream emits partial text, then fails; the message stores the partial
  parts and `{ code: "STREAM_PROTOCOL_ERROR", status, retryable }` only.
- Base: an old completed message upgrades with `error: null` and no changes to
  its parts, usage, branch links, or attachments.
- Bad: persist the custom Error object or assume `structuredClone` preserves its
  `code`, producing raw detail leakage or `chatError.undefined`.

### 6. Tests Required

- Migration: a pre-v5 message receives `error: null` without changing parts or
  attachment links.
- Stream persistence: finalize through `ThrottledStreamPersistence`, then assert
  partial output plus exact safe error fields and absence of raw detail.
- Backup: an error message round-trips the safe projection.
- Browser: 401/429/protocol failures render inside the Assistant message, never
  duplicate in the composer banner, survive reload, and regenerate a sibling
  response version.

### 7. Wrong vs Correct

```ts
// Wrong: structuredClone drops custom fields from ChatTransportError.
await port.finalize(structuredClone(result));

// Correct: preserve the typed error across the clone boundary; persistence then
// projects it to MessageError before writing IndexedDB.
await port.finalize({ ...structuredClone(result), error: result.error });
```

## Scenario: Per-Model Request Preferences

### 1. Scope / Trigger

Use this contract when changing model streaming, Temperature, Top P, capability
overrides, or backup behavior. Preferences are execution settings, not model
support labels.

### 2. Signatures

- `ModelOverrideRecord.preferences?: ModelPreferences` remains in the existing
  `modelOverrides` store keyed by `[connectionScope+modelId]`.
- `ModelPreferences` contains `streaming: boolean`,
  `temperature: { enabled, value }`, and `topP: { enabled, value }`.
- `ModelCapabilityRepository.saveSettings(scope, modelId, override,
  preferences)` writes capability and preferences in one record.

### 3. Contracts

- Missing preferences resolve to streaming enabled and both optional parameters
  disabled with value `1`.
- Temperature accepts `0..2`; Top P accepts `0..1`.
- `saveOverride` preserves existing preferences. Capability-only reset also
  preserves preferences; full model-settings reset deletes the model record.
- `saveSettings` merges capability fields that its form does not own (including
  legacy `temperature` / `topP` support overrides) before replacing preferences.
- Backup manifest v2 accepts optional preferences so old archives remain valid
  and new archives round-trip the settings without a database version bump.
  Import remapping must copy optional preferences through to `bulkPut`; schema
  validation alone does not preserve fields omitted by the mapper.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing `preferences` | Resolve defaults |
| Invalid range/non-finite value | `modelPreferencesSchema` rejects |
| Legacy `streamUsage` override | Accept for backup compatibility, ignore at runtime |
| Full reset | Delete scoped model record |

### 5. Good / Base / Bad Cases

- Good: two providers expose the same model ID but retain separate preferences
  because `connectionScope` is part of the key.
- Base: an old model override has no preferences and resolves safe defaults.
- Bad: store model preferences in a conversation or a single global settings
  key, causing model/provider changes to inherit unrelated values.

### 6. Tests Required

- Repository: default resolution, scoped save, capability-preserving save/reset,
  and full reset.
- Backup: optional legacy field plus new-preference round trip.
- Backup import: assert a non-default preference and legacy support override
  survive ID remapping and restore.
- Repository: assert saving new preferences does not delete capability fields
  that the settings form does not expose.
- E2E: saved non-streaming mode and enabled Temperature affect the actual request.

### 7. Wrong vs Correct

```ts
// Wrong: global preference leaks across models and providers.
await database.settings.put({ key: "temperature", value: 0.7 });

// Correct: one validated record owns model capability and execution settings.
await capabilities.saveSettings(scope, modelId, override, preferences);
```

## Scenario: Sparse Model Capability Overrides

### 1. Scope / Trigger

Use this contract when changing built-in model metadata, name inference,
capability settings, reasoning efforts, or `ModelCapabilityRepository`. A
resolved automatic value is display state, not proof that the user customized
that value.

### 2. Signatures

```ts
getAutomaticModelCapability(modelId: string): ResolvedModelCapability;
compactModelCapabilityOverride(
  modelId: string,
  override: ModelCapabilityOverride,
): ModelCapabilityOverride;
ModelCapabilityRepository.saveSettings(
  connectionScope: string,
  modelId: string,
  override: ModelCapabilityOverride,
  preferences: ModelPreferences,
): Promise<void>;
```

### 3. Contracts

- Automatic capability resolution uses built-in family metadata first and
  conservative model-name inference second.
- A stored override contains only values that differ from the current automatic
  capability. An empty override resolves to the automatic source, not `user`.
- Records without `capabilityVersion: 1` are legacy complete-form snapshots.
  Repository reads lazily remove values equal to the old family fallback,
  compact old 32K/empty-effort defaults against the current automatic
  capability, preserve actual differences, write version `1`, and retain
  generation preferences.
- If a new catalogue/alias now exposes explicit effort levels, an empty effort
  list from a legacy complete snapshot is treated as the former automatic
  default, not a durable user choice. Non-empty custom effort lists remain.
- `supportedEfforts` is persisted only when the final effective capability has
  `reasoning=true`; a disabled reasoning capability must not retain inactive
  effort text as a hidden override.
- A model-settings save replaces reasoning, effort, vision, tools, and context fields
  owned by the form while preserving hidden `temperature` and `topP` support
  overrides already stored in the same record.
- Request preferences remain independently persisted. Saving streaming,
  Temperature, or Top P values must not freeze automatic model capabilities.
- Explicit user differences win over built-in metadata and inference. Users can
  remove those differences through the model-settings reset action.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Form equals built-in capability | Store `{}` as the capability override |
| Form equals inferred capability | Store `{}` and retain `inferred` source |
| One capability differs | Store only that field and resolve source `user` |
| Unknown Custom API model enables tools | Store `tools: true`; composer may expose search after endpoint intersection |
| Reasoning is disabled with effort text present | Omit `supportedEfforts` |
| Preferences change while capability is automatic | Persist preferences with `{}` override |
| Hidden support override already exists | Preserve it during form-owned save |
| Legacy complete snapshot has 32K context and empty efforts | Migrate those automatic fields, then resolve current catalogue values |
| Legacy snapshot equals an old family fallback | Remove fallback-equal fields so a newer precise catalogue record can apply |

### 5. Good/Base/Bad Cases

- Good: `openai/gpt-5-mini` discovered through a Custom API resolves built-in
  reasoning, vision, context, and effort defaults without writing them back.
- Base: an unknown model resolves conservative inferred values and stays
  automatic until the user changes a capability.
- Bad: serialize the complete resolved form. A later registry correction is
  then masked by stale values that falsely appear user-authored.

### 6. Tests Required

- Resolver unit tests: built-in and inferred values compact to `{}`; one changed
  field remains sparse; disabled reasoning drops effort options.
- Repository tests: preference-only saves keep automatic source and preserve
  hidden support overrides.
- Repository tests: bare and namespaced legacy Grok snapshots migrate to the
  current built-in values while explicit reasoning/image differences remain.
- Repository tests: a legacy `gemini-3.1-pro` family snapshot resolves current
  catalogue effort levels without losing genuinely different user fields.
- Playwright: discover a namespaced built-in model through Custom API, select it
  in Model management, and assert reasoning, vision, tools, context, effort
  options, and source without reloading.
- Playwright: edit one capability, save, and assert the source changes to custom;
  switching to another automatic model must not inherit that override.

### 7. Wrong vs Correct

```ts
// Wrong: resolved defaults become permanent user data.
await repository.saveSettings(scope, modelId, resolvedCapability, preferences);

// Correct: persist only differences from the current automatic capability.
await repository.saveSettings(
  scope,
  modelId,
  compactModelCapabilityOverride(modelId, formOverride),
  preferences,
);
```

## Scenario: Assistant-Bound Conversation Snapshots

### 1. Scope / Trigger

Use this contract when changing Assistants, conversation creation, prompt
selection, Assistant switching, or full backup/restore. It prevents later
Assistant edits from silently changing the behavior of existing conversations.

### 2. Signatures

- IndexedDB v3 adds `assistants: "&id, kind, updatedAt"`.
- `ConversationRecord` stores `assistantId: string` and
  `assistantSnapshot: { name, icon, systemPrompt }`.
- `ConversationRepository.rebindAssistantIfEmpty(conversationId, binding)`
  atomically counts messages and updates the binding only when the count is 0.
- Backup manifest v2 stores both `assistants[]` and complete conversation
  snapshots.

### 3. Contracts

- `default-assistant` is the one fixed Default Assistant ID. Its name/icon are
  fixed, its prompt is editable, and it cannot be deleted.
- New chats bind a fresh Default Assistant snapshot. Selecting another
  Assistant rebinds an empty chat; a non-empty chat creates another chat.
- Assistant edits/deletes never rewrite existing conversation snapshots.
- Request construction reads only
  `conversation.assistantSnapshot.systemPrompt`; it must not join the live
  Assistant record or merge browser-global/per-conversation prompt state.
- Conversation history stays globally time-grouped. `assistantId` is persisted
  for association and future filtering, not used to partition the list.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing Assistant ID on selection | `AssistantNotFoundError` |
| Empty/overlong name or overlong prompt | `RangeError` |
| Rename/re-icon Default Assistant | `DefaultAssistantOperationError` |
| Delete Default Assistant | `DefaultAssistantOperationError` |
| Rebind chat containing messages | Return `false`; caller creates a chat |
| Backup lacks exactly one fixed Default Assistant | `BackupValidationError` |

### 5. Good/Base/Bad Cases

- Good: a custom Assistant creates a chat snapshot; deleting the source leaves
  the chat usable with an explicit deleted-source label.
- Base: an upgraded v1/v2 chat receives an empty Default Assistant snapshot and
  retains its messages and attachment links.
- Bad: request code fetches the current Assistant prompt by `assistantId`, so
  editing an Assistant changes historical prompt behavior.

### 6. Tests Required

- Repository: Default invariants, snapshot copying, empty/non-empty atomic
  rebinding, and source deletion without conversation deletion.
- Migration: construct a legacy schema without the `assistants` table, upgrade
  to v3, and assert the table/default/snapshots plus legacy message links.
- Backup: round-trip custom Assistants, ID remapping, and deleted-source chats.
- Request builder: assert exactly one system message from the stored snapshot.
- Playwright: create/edit/delete, empty rebind, non-empty switch, deleted
  fallback, global history count, and desktop/mobile top-bar geometry.

### 7. Wrong vs Correct

```typescript
// Wrong: mutable source data controls an old conversation.
const assistant = await assistants.get(conversation.assistantId);
buildRequest({ systemPrompt: assistant.systemPrompt });

// Correct: the conversation's immutable execution snapshot controls requests.
buildRequest({
  systemPrompt: conversation.assistantSnapshot.systemPrompt,
});
```

## Scenario: Last-Known-Good Model Discovery Cache

### 1. Scope / Trigger

Use this contract when model discovery, connection saving, API URL
normalization, credentials, or the controller's available-model state changes.

### 2. Signatures

```ts
ModelListCacheRepository.load(connectionScope: string): Promise<string[]>;
ModelListCacheRepository.loadDescriptors(
  connectionScope: string,
): Promise<ModelDescriptor[]>;
ModelListCacheRepository.save(
  connectionScope: string,
  models: readonly ModelDescriptor[],
): Promise<ModelDescriptor[]>;
ModelListCacheRepository.clear(connectionScope: string): Promise<void>;
```

The fixed settings key is `modelListCache.v2`; each entry contains validated
`models`, optional enabled IDs, and `updatedAt`, keyed by canonical connection
scope. Development-stage v1 cache data is intentionally discarded.

### 3. Contracts

- `/v1` suffixes and trailing slashes are removed before a BYOK scope is built;
  hosted scope is always `hosted:same-origin`.
- A successful remote list replaces only its scope. There is no hard TTL.
- New API descriptors preserve `ownedBy` and normalized endpoint types. A cache
  fallback or backup restore must update `modelDescriptorsRef` and recompute the
  active capability before transport/UI state is exposed.
- Reload and transient discovery failure use the last successful list. A scope
  with no successful list falls back to the current model only.
- Changing connection scope or credentials clears the target scope before the
  new connection is persisted, so a previous account's private models are not
  reused.
- Cache save and clear operations share one controller mutation queue. An epoch
  is checked when a queued save executes, not only when the response arrives.
- Model IDs are trimmed, deduplicated, and limited to 512 characters. Raw API
  keys and access codes never enter cache keys or values.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Empty/oversized scope, model ID, or owner | Zod rejects before persistence |
| Unknown New API endpoint alias | Ignore that alias; keep other valid aliases |
| Corrupt cache settings value | `load` returns an empty list |
| Clear unknown scope | No write and no `updatedAt` change |
| Stale refresh epoch | Skip the queued cache write |
| Scope/credential change | Clear target scope before connection save |
| IndexedDB operation fails | Normalize to `StorageError`; do not partially rewrite the cache record |

### 5. Good/Base/Bad Cases

- Good: A slow response from connection A finishes after B is saved; the queued
  epoch check skips A and B remains the durable list.
- Base: the same saved Custom API reloads offline and keeps its cached models.
- Bad: key A and key B share one endpoint cache without invalidation, exposing
  A-only model names after B's refresh fails.

### 6. Tests Required

- Repository: scope isolation, normalization, corruption fallback, target-only
  clear, unknown-scope no-op, and transaction rollback.
- Playwright: reload persistence, transient failure retention, canonical `/v1/`
  handling, Custom API without access code, and delayed A versus current B.
- Security: client bundle and logs contain no credential values or credential
  fingerprints.

### 7. Wrong vs Correct

```ts
// Wrong: every refresh owns an independent write and stale results can win.
const models = await transport.listModels();
await cache.save(scope, models);
setModels(models);

// Correct: execution-time epoch checks serialize durable mutations.
await cacheMutationQueue.enqueue(async () => {
  if (epoch !== currentEpoch) return;
  await cache.save(scope, models);
});
```

## Scenario: Discovered versus Enabled Model Lists

### 1. Scope / Trigger

Use this contract when model discovery, provider switching, model selectors,
default-model settings, or title-model settings change. Discovery output is
server-derived data; enablement is an explicit user preference.

### 2. Signatures

```ts
interface ModelListState {
  discoveredModels: ModelDescriptor[];
  discoveredModelIds: string[];
  enabledModelIds: string[] | null;
}

ModelListCacheRepository.loadState(scope: string): Promise<ModelListState>;
ModelListCacheRepository.save(
  scope: string,
  discoveredModels: readonly ModelDescriptor[],
): Promise<ModelDescriptor[]>;
ModelListCacheRepository.saveEnabled(
  scope: string,
  enabledModelIds: readonly string[],
  discoveredModels?: readonly ModelDescriptor[],
): Promise<string[]>;
```

The fixed settings key is `modelListCache.v2`; each scope entry stores
`models`, nullable `enabledModelIds`, and `updatedAt`.

### 3. Contracts

- A remote refresh replaces only `models`; it preserves the scope's enabled
  list and never implicitly enables every newly discovered model.
- A missing legacy `enabledModelIds` behaves as the current model only until the
  user explicitly saves a selection. Existing public deployment model lists
  may initialize all configured models because they are curated server data.
- Chat, default-model, title-model, and capability selectors consume the
  enabled projection. The active/default/title models are retained as required
  in memory so a setting cannot strand a live conversation.
- `saveEnabled` requires at least one normalized ID. The controller rejects a
  selection that omits the active, default, or title model; the settings page
  reports a localized action error beside the save button.
- When enablement is the first persisted operation for a curated deployment
  list, `saveEnabled` stores the complete discovered fallback as `models`;
  disabled choices must remain available to re-enable after reload.
- Clearing a connection scope also clears its enabled projection. Cache values
  contain model IDs only; credentials and raw upstream payloads never enter it.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Legacy entry has no enabled list | Resolve current model only (or curated initial config) |
| Enabled list is empty | Repository rejects the write |
| Selection omits active/default/title model | Controller rejects and leaves the draft dirty |
| Refresh returns new IDs | Store discovered IDs, preserve enabled IDs |
| Connection scope or credential changes | Clear both projections for the target scope |
| Corrupt settings JSON | Return an empty state; do not expose unvalidated values |

### 5. Good / Base / Bad Cases

- Good: a Custom API returns 200 models, the user enables three, and the chat
  selector shows only those three plus required in-use models.
- Base: a transient refresh failure keeps the last discovered and enabled
  projections for that connection.
- Bad: assign `result.modelIds` directly to `setModels`, silently re-expanding a
  user's carefully chosen list after every refresh.

### 6. Tests Required

- Repository: state round trip, legacy missing-field behavior, scope isolation,
  enabled-list preservation across discovery refresh, empty-list validation,
  and target-only clear.
- Component: searchable list, required-model checkboxes, enable/disable draft,
  and localized save error.
- Playwright: Custom API discovery with a subset enabled, reload persistence,
  unenabled model absent from chat selectors, delayed connection A/B refresh,
  and desktop/mobile no-overflow assertions.

### 7. Wrong vs Correct

```ts
// Wrong: discovery is treated as the user's final selection.
setModels(result.modelIds);

// Correct: discovery and user preference are separate projections.
const state = await modelLists.loadState(scope);
setAvailableModels(result.modelIds);
setModels(resolveEnabledModelIds(activeModel, state.enabledModelIds));
```

## Scenario: Bounded Backup And Image Metadata Validation

### 1. Scope / Trigger

Use this contract when changing full backup import/export, `JsonValue`, message
tree integrity, attachment persistence, image decoding, or HEIC conversion.
Imported archives and model/user images are untrusted resource inputs.

### 2. Signatures

```ts
inspectImageMetadata(blob: Blob): Promise<{
  mimeType: SupportedImageMime;
  width: number;
  height: number;
}>;

prepareBackupImport(input: Blob | Uint8Array): Promise<PreparedBackup>;
importPreparedBackup(database, prepared, createId?): Promise<BackupSummary>;
```

### 3. Contracts

- Backup limits are 50 MiB compressed, 128 MiB expanded, 1,024 files, 16 MiB
  Manifest, and 10 MiB per attachment. Entity maxima are 256 Assistants, 2,000
  Conversations, 50,000 Messages, 50,000 Branch selections, 1,000 Attachments,
  3,000 MessageAttachment links, 512 Settings, and 5,000 ModelOverrides.
- Scan Manifest JSON nesting to 32 before `JSON.parse`. `JsonValue` uses an
  explicit stack with at most 32 container levels and 10,000 nodes; cycles,
  non-finite numbers, class instances, and unsupported values fail validation.
- Message-parent cycle validation is O(n) with white/gray/black-equivalent
  state. Each message is entered and finalized at most once.
- Image metadata reads at most 1 MiB of header data. PNG, JPEG, WebP, and
  HEIC/HEIF must have a maximum edge of 16,384 and at most 40,000,000 pixels.
- Source metadata is checked before `createImageBitmap` or HEIC conversion;
  converted JPEG metadata is checked before decode. Backup import and export
  require actual MIME and dimensions to match the stored Manifest/record.
- All import validation finishes before the single write transaction begins.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Archive/file/entity/JSON limit exceeded | `BackupValidationError`; no writes |
| Cross-conversation parent, cycle, or broken attachment link | `BackupValidationError` |
| Header dimensions unavailable or unsafe | `ImageMetadataError`; no decode/convert |
| Backup MIME or dimensions disagree with bytes | `BackupValidationError` |
| HEIC conversion is non-JPEG or unsafe | `ImageProcessingError(DECODE_FAILED)` |

### 5. Good / Base / Bad Cases

- Good: a 2,000-node linear message chain validates once per node and restores
  in one transaction.
- Base: a normal PNG/JPEG/WebP attachment round-trips with matching hash, MIME,
  byte count, width, and height.
- Bad: trust Manifest dimensions, decode first and inspect later, recursively
  validate arbitrary JSON, or walk every message's full ancestor chain.

### 6. Tests Required

- Backup: every entity maximum, compressed/expanded/file/Manifest limits,
  pre-parse depth, bounded JSON nodes, long linear chain, cycle, relationship
  integrity, MIME/dimension tampering, and no mutation on failure.
- Image metadata: PNG, realistic JPEG segments, VP8X/VP8/VP8L, HEIC and HEIF,
  missing dimensions, maximum edge, total pixels, and bounded header behavior.
- Image processor: oversized source before decode/convert, converted JPEG before
  codec decode, decoded/header mismatch with `close()`, and normal compression.

### 7. Wrong vs Correct

```ts
// Wrong: full decode allocates pixels before the safety decision.
const bitmap = await createImageBitmap(blob);
assertPixels(bitmap.width, bitmap.height);

// Correct: bounded header validation owns the pre-decode decision.
const metadata = await inspectImageMetadata(blob);
assertSafeImageDimensions(metadata.width, metadata.height);
const bitmap = await createImageBitmap(blob);
```

## Scenario: Retired Conversation Fields And Backup Compatibility

### 1. Scope / Trigger

Use this contract when removing a persisted `ConversationRecord` field, changing
the Dexie conversation migration, or changing Backup v2 conversation parsing.
Database schema versions and portable backup versions are independent contracts.

### 2. Signatures

```ts
// Current browser schema
ChatDatabase.version(7);

// Portable archive remains unchanged.
const BACKUP_FORMAT_VERSION = 2;

// Accepted legacy-only Backup v2 input fields.
contextMessageLimit?: number;
advancedSettings?: unknown;
```

The current `ConversationRecord` omits `contextMessageLimit` and
`advancedSettings`; `autoTitle` remains a live field used by title generation.

### 3. Contracts

- The v7 upgrade iterates existing conversations and deletes exactly the two
  retired properties without changing IDs, Assistant snapshots, model state,
  messages, branches, attachments, or web-search state.
- Earlier migration paths must not add defaults for a field that v7 immediately
  removes.
- New conversations and new Backup v2 archives never write the retired fields.
- The Backup v2 conversation schema stays strict for unknown properties but
  accepts these two known legacy properties, validates their legacy shape, and
  transforms them away before the import transaction.
- A database version bump alone does not require Backup v3. Increase the backup
  version only when a compatible reader cannot represent the portable contract.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Database v1-v6 record has both retired fields | v7 deletes both and preserves the record |
| Current record has neither field | v7 leaves all current data unchanged |
| Backup v2 has valid legacy fields | Accept, strip, then import |
| Backup v2 has an invalid legacy field shape | `BackupValidationError`; no writes |
| Backup v2 has another unknown property | Strict schema rejects; no writes |
| New export is inspected | Neither retired field is present |

### 5. Good / Base / Bad Cases

- Good: a legacy v2 archive imports into database v7, keeps its messages and
  Assistant binding, and stores neither retired property.
- Base: a current Backup v2 round-trip is byte-shape compatible without a format
  version change.
- Bad: use `.passthrough()` for compatibility, preserve arbitrary unknown data,
  or bump to Backup v3 only because IndexedDB gained a cleanup migration.

### 6. Tests Required

- Migration: construct legacy v1, v3, and v6 databases with the retired fields,
  upgrade to v7, and assert field absence plus preservation of current fields.
- Repository/new-chat: assert newly written records never contain the fields and
  `autoTitle` still drives title behavior.
- Backup: import a valid legacy v2 fixture, reject invalid shapes and unrelated
  unknown fields, and assert a new export omits the retired properties.
- Transaction safety: every failed import completes validation before any write.

### 7. Wrong vs Correct

```ts
// Wrong: broad compatibility silently accepts unrelated future fields.
const conversationSchema = currentConversationSchema.passthrough();

// Correct: accept only the two known legacy inputs, then return the current
// runtime shape before persistence.
const conversationSchema = legacyConversationSchema.transform(
  ({ contextMessageLimit: _limit, advancedSettings: _advanced, ...current }) =>
    current,
);
```
