# Tool Runtime And Web Search Contract

CherryChat normalizes provider tool calls into one ordered message contract.
React never parses provider payloads, and tool executors never write messages
directly.

## Scenario: Ordered Tools And Tavily Search

### 1. Scope / Trigger

Use this contract when changing provider tool encoding, stream events, message
parts, Tavily, tool errors, cancellation, or source rendering.

### 2. Signatures

```ts
interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  step: number;
  input: JsonValue;
  output: JsonValue | null;
  status: "running" | "completed" | "error";
  errorCode: string | null;
  errorStatus: number | null;
  retryable: boolean;
}

interface ToolExecutor {
  definition: ChatCompletionToolDefinition;
  dedupeKey?(input: Record<string, JsonValue>): string | null;
  execute(
    input: Record<string, JsonValue>,
    signal: AbortSignal,
  ): Promise<JsonValue>;
}

ToolRegistry.prepare(call: NormalizedToolCall, step: number): ToolCallPart;
ToolRegistry.execute(
  call: NormalizedToolCall,
  signal: AbortSignal,
  step?: number,
): Promise<ToolCallPart>;

AgentRuntime.run(options: AgentRuntimeOptions): Promise<StreamResult>;
resolveAgentRuntimeKind(connection):
  | "ai-sdk-openai-compatible"
  | "ai-sdk-openai-responses"
  | "ai-sdk-google"
  | "ai-sdk-anthropic";
loadAgentRuntime(kind: AgentRuntimeKind): Promise<AgentRuntime>;
createTavilyToolExecutor(options: TavilyClientOptions): ToolExecutor;
resolveTavilyExecutionSource(context: {
  connectionMode: "hosted" | "byok";
  browserApiKey: string;
  browserBaseUrl: string;
  hostedWebSearchEnabled: boolean;
  authenticated: boolean;
}):
  | { kind: "browser"; apiKey: string; baseUrl: string }
  | { kind: "hosted" }
  | null;
```

The default Tavily base URL is `https://api.tavily.com`. A configured base URL
or full trailing `/search` URL is normalized before the runtime appends exactly
one `/search`. The runtime allows at most five model steps and three tool calls
per user send.

### 3. Contracts

- The four AI SDK provider runtimes and compatibility middleware normalize
  completed tool calls to `NormalizedToolCall`. Provider JSON, AI SDK messages,
  and SDK stream parts do not reach React props or IndexedDB schemas.
- Runtime selection has no environment switch. Hosted, direct OpenAI Chat,
  Custom OpenAI compatible, and New API `openai-chat` use the compatible
  runtime; direct OpenAI Responses and New API `openai-responses` use the native
  Responses runtime; direct Gemini and New API `gemini` use the native Google
  runtime; direct Anthropic and New API `anthropic` use the native Anthropic
  runtime. Missing New API endpoint metadata resolves to compatible Chat.
  Hosted never selects a native provider from its stored API type. Load every
  provider through a dynamic import so its SDK stays outside the page entry
  chunk. Auxiliary `ChatTransport` instances are not a generation fallback;
  they serve model discovery and non-streaming title completion only.
- AI SDK `ToolLoopAgent` must use `maxRetries: 0`. One CherryChat generation is
  one billable request chain; an SDK retry or cross-runtime fallback can
  duplicate model charges and non-idempotent tool side effects.
- AI SDK's default stream error handler writes the raw error to `console.error`.
  Install an explicit no-op `onError` and project the error through
  `ChatTransportError`; upstream response bodies and credentials must not enter
  browser logs.
- AI SDK may normalize an omitted tool choice to `toolChoice: "auto"`. Remove
  that field in provider middleware unless the canonical CherryChat request
  explicitly declared `tool_choice: "auto"`; strict compatible gateways can
  distinguish omission from an explicit automatic choice.
- Provider middleware owns Native/DSML replay merging and executor-declared
  semantic deduplication before `ToolLoopAgent` sees a `tool-call`. Doing this in
  `execute()` is too late because AI SDK has already counted and scheduled the
  duplicate call. Apply step and tool-call limits only after this normalization.
- Native tool-call reconstruction must preserve `providerMetadata` in both
  `wrapStream` and `wrapGenerate`. A streaming-only assertion does not prove
  non-streaming Gemini thought signatures survive a tool continuation.
- The canonical tool-result message may retain the tool name for native Gemini
  projection, but the OpenAI Chat wire adapter emits only `role`, `content`,
  and `tool_call_id`. Do not forward the canonical `name` field to a strict
  OpenAI-compatible gateway. This matches the reviewed
  `@ai-sdk/openai-compatible` wire contract.
- DeepSeek models can leak tool calls as `<｜｜DSML｜｜tool_calls>` in text
  rather than native tool-call deltas. Enable the compatibility parser only for
  DeepSeek identities, buffer tags across chunks, preserve invalid markup as
  text, and generate a UUID-based ID for every extracted call. A per-parser
  counter is invalid because persisted history can contain calls from multiple
  generations.
- An OpenAI-compatible stream completes on `[DONE]` or normal EOF after a
  non-null `finish_reason`. A terminal `delta: null` is empty, and a missing
  tool-call index uses that call's array position. EOF without either terminal
  signal remains `STREAM_PROTOCOL_ERROR`. The controlled AI SDK fetch preserves
  raw bytes and appends an internal finish marker for a truncated stream; the
  middleware turns that marker into the stable error only after earlier text
  deltas have reached the projector.
- `@ai-sdk/openai-compatible` owns SSE decoding, primary-choice selection, and
  native delta reconstruction. CherryChat's controlled fetch only checks each
  `data:` payload for a primary terminal `finish_reason`; it prefers `index=0`
  and otherwise the first choice. It must not rebuild content or tool deltas.
  Compatibility middleware receives completed SDK calls and keeps DSML calls
  in a separate ordered collection before semantic deduplication.
- Deduplicate only after a model step has complete arguments and before tool
  limits, running parts, execution, and continuation messages. A repeated
  non-empty ID is always one logical call. Parameter-level deduplication is
  opt-in through `ToolExecutor.dedupeKey`; Tavily returns its schema-validated,
  trimmed query. Reset dedupe state for every model step, preserve different
  queries, and never infer idempotency for tools that omit `dedupeKey`.
- Before execution, persist a `running` part. Replace that exact ID with the
  completed/error part and checkpoint again. Do not append a duplicate.
- The continuation request contains the current step's Assistant text plus its
  tool calls, followed by tool-result messages. Persisted history reconstructs
  the same sequence from ordered `MessagePart[]`.
- A `web_search` tool result sent to the model is projected to
  `[{ id, title, url, content }]`. The richer `{ query, results }` envelope is
  retained only for local rendering and persistence.
- The `web_search` definition uses `strict: true`, requires only `query`, rejects
  extra properties, and caps the model-facing query at 200 characters. OpenAI
  Chat preserves `strict`; Anthropic and Gemini project only their native schema
  fields, while Responses keeps its existing strict function contract.
- Register Tavily only when the conversation toggle is on, a resolved source
  exists, global search is enabled, and effective model capability has
  `tools=true`. If intent is still on but any condition becomes false, persist a
  visible `WEB_SEARCH_UNAVAILABLE` Assistant error instead of silently sending a
  tool-free request.
- Source selection is a strict resource bundle. Hosted mode resolves only an
  authenticated deployment source; BYOK mode resolves only a non-empty browser
  Key and its URL. Select once before execution; failure never falls back to the
  other connection mode or billing source.
- Keep inactive credentials persisted but do not execute them: access-code mode
  disables personal Tavily editing, while Custom API ignores an otherwise valid
  Hosted Session.
- Browser credentials and their personal URL come from `webSearchCredentials`.
  Hosted execution calls fixed `/api/web-search` with `credentials: same-origin`,
  no Authorization, Key, or target fields. Neither credential or URL enters
  backup/export, logs, parts, or errors.
- A personal URL is browser-direct and must support CORS. The deployment URL
  comes only from `TAVILY_BASE_URL`; a browser value never changes the Hosted
  route target.
- The upstream JSON body contains exactly `{ query, max_results }`, matching
  the reviewed minimum Tavily compatibility request. Provider-specific
  optional fields require an explicit capability contract; do not add them to
  the shared request because strict compatible gateways may reject them.
- Hosted session `401 UNAUTHORIZED` invalidates only the matching auth epoch;
  an older delayed 401 cannot overwrite a newer successful access-code login.
- One abort signal covers model fetch, Tavily response headers, and bounded body
  reading. Timeout is 30 seconds and response size is at most 1 MiB.
- Persist only stable tool code/status/retryability. Accept source links only
  with `http:` or `https:`; drop invalid/missing URLs individually so one bad
  result cannot hide valid sources.

### 4. Validation & Error Matrix

| Condition | Stable result |
| --- | --- |
| Hosted, OpenAI Chat, or Custom OpenAI compatible connection | Select `ai-sdk-openai-compatible` |
| Direct or New API endpoint resolves to Responses, Gemini, or Anthropic | Select its native AI SDK runtime |
| New API endpoint metadata is missing | Select compatible Chat; do not infer a native provider from the model name |
| Tool is not registered | `TOOL_NOT_AVAILABLE`, not retryable |
| Tool arguments are invalid | `INVALID_TOOL_INPUT`, not retryable |
| Personal URL is not absolute HTTP(S), contains credentials/query/fragment, or exceeds 2048 characters | `INVALID_REQUEST` before fetch/save |
| Tavily returns 401/403 | `TOOL_AUTH_FAILED`, status retained |
| Hosted Session is missing/expired | Proxy `UNAUTHORIZED` -> local `TOOL_AUTH_FAILED`; mark current auth epoch invalid |
| Tavily returns 429 | `TOOL_RATE_LIMITED`, retryable |
| Tavily returns 5xx | `TOOL_SERVICE_UNAVAILABLE`, retryable |
| Header or body exceeds timeout | `TOOL_REQUEST_TIMEOUT`, retryable |
| User aborts during execution | `TOOL_REQUEST_ABORTED`; generation is stopped |
| Response exceeds 1 MiB or JSON is invalid | `TOOL_REQUEST_FAILED` |
| Result URL uses data/javascript/ftp | Drop that source before persistence |
| Model/tool step limit is exceeded | Generation error `INVALID_REQUEST` |
| EOF follows an explicit `finish_reason` but omits `[DONE]` | Complete the step normally |
| EOF has neither `[DONE]` nor any finish reason | `STREAM_PROTOCOL_ERROR`; retain partial output |
| Canonical OpenAI tool result contains `name` | Strip `name` at the OpenAI Chat transport boundary |
| Hosted mode has personal Key but no authenticated Hosted source | Search unavailable; do not use the personal Key |
| BYOK mode has a valid Hosted Session but no personal Key | Search unavailable; do not use deployment Tavily |
| DeepSeek returns a complete DSML invoke split across chunks | Emit a normalized tool call with a unique ID |
| DeepSeek returns malformed or unclosed DSML | Preserve the original markup as text |
| OpenAI-compatible web-search definition omits `strict` | Contract drift; exact serializer test must fail |
| A secondary choice contains text, finish reason, or tools | Ignore it; consume the primary choice only |
| One tool index changes to a different non-empty ID | `STREAM_PROTOCOL_ERROR`; do not guess or concatenate |
| One model step repeats a Tavily query with another ID | Execute once and emit one Assistant call/result pair |
| A later model step repeats the same Tavily query | Execute again; deduplication never crosses steps |
| AI SDK runtime receives an upstream 401/403/429/5xx | Return one redacted `ChatTransportError`; do not retry or switch runtimes |
| Canonical request omits `tool_choice` | Remove AI SDK's injected `toolChoice`; omit the wire field |
| AI SDK emits a raw stream error | Suppress its default console handler and persist only the stable projected error |
| Deduplication leaves more than three calls or requires a sixth model step | Fail before any call in that over-limit batch executes |

### 5. Good/Base/Bad Cases

- Good: the model writes "I will check", calls Tavily, receives one source,
  and continues. Live UI, reload, export, and the next request keep that order.
- Good: one step returns the same trimmed Tavily query under two IDs; the first
  ID is retained, one request runs, and the continuation contains one result.
- Good: the AI SDK path receives the same Native and DSML Tavily invocation,
  middleware emits one normalized call, and `ToolLoopAgent` executes it once.
- Base: one step requests two different queries, or a later step repeats the
  previous query; each intended call runs in order.
- Good: one New API catalogue contains Chat, Responses, Gemini, and Anthropic
  endpoints; each selected model resolves directly to its matching AI SDK
  runtime without a configuration flag.
- Base: New API omits endpoint metadata; compatible Chat is selected and no
  native provider is inferred from the model name.
- Good: access-code mode uses the authenticated site source and keeps personal
  fields disabled even if a personal Key was saved earlier.
- Good: switching to Custom API immediately requires the saved personal Tavily
  source; the still-valid Hosted Session cannot fund the search.
- Base: search is configured globally but disabled in a conversation; the
  normal single-stream chat path sends no tool fields.
- Good: global search is disabled after a conversation enabled it; the composer
  still allows the user to turn that conversation flag off.
- Bad: clear timeout/abort listeners after response headers, leaving a stalled
  body impossible to stop.
- Bad: render `z.string().url()` values directly; that accepts non-web schemes.
- Bad: deduplicate every tool by raw argument text or across model steps; raw
  text misses equivalent JSON, while global dedupe removes legitimate retries.
- Bad: rely on AI SDK defaults for retries, error logging, or tool choice. Those
  defaults conflict with CherryChat billing, secret-handling, and wire-omission
  contracts.

### 6. Tests Required

- Provider contracts: streaming and non-streaming tool calls/results for all
  four AI SDK runtimes, including split arguments and stable IDs.
- OpenAI-compatible runtime: null terminal delta, omitted tool index, explicit
  finish without `[DONE]`, and a truly truncated stream that still fails.
- OpenAI Chat serializer: assert the exact continuation tool-result message and
  the absence of `name` or other canonical/native-only fields; assert the first
  tool definition retains `strict: true`.
- DeepSeek: split opening tags, multiple invokes, malformed/unclosed fallback,
  non-streaming conversion, model gating, and unique IDs across parser
  instances; execute one extracted call through the complete continuation loop.
- Tool result projection: assert the exact numbered web-search array in both the
  live loop and persisted-history reconstruction.
- Middleware/projector: mixed text/tool/text order, running checkpoint, result
  replacement, continuation request, step/call limits, and abort during
  execution.
- Middleware/projector: repeated ID, Tavily-equivalent query under different IDs,
  native-plus-DSML equivalent search, different queries in one step, repeated
  query across steps, and a non-idempotent executor without `dedupeKey`.
- AI SDK runtime: text/reasoning/usage projection, streaming and non-streaming
  tool continuation, Native plus DSML dedupe before limits, cross-step ID
  uniqueness, abort checkpoints, and stable upstream errors. Assert one fetch,
  no auxiliary `ChatTransport` generation call, and no `console.error` for a
  failed model step.
- AI SDK provider boundary: assert exact direct BYOK and fixed Hosted URLs,
  credentials, secret absence, `maxRetries: 0`, and that `tool_choice` appears
  only when the canonical request explicitly opted in.
- Runtime Factory: Hosted, direct API types, New API endpoint identities, and
  missing New API metadata select exactly one of compatible, Responses, Google,
  and Anthropic. The resolver has no configuration argument or legacy value.
- Production bundle: locate the AI SDK marker in an async client chunk and
  assert that chunk is absent from the page `entryJSFiles` list.
- Provider fetch/runtime: primary terminal choice, `[DONE]`, explicit finish
  without `[DONE]`, and true truncation; SDK-reconstructed native calls cannot
  collide with ordered DSML calls.
- Tavily: URL normalization, direct custom target, request schema, 401/429/5xx
  mapping, header/body timeout, caller abort, 1 MiB bound, secret absence, and
  invalid URL filtering. Assert the exact two-field upstream body so optional
  official parameters cannot silently return.
- Storage: schema round trip, backup credential exclusion, interrupted startup
  recovery, and content-part order.
- Browser: settings save, composer on/off, actual mocked cross-origin POST,
  sources, localized errors, reload, and desktop/mobile overflow.
- Browser: same-origin hosted POST has no Authorization; Custom API requests
  remain isolated; Session expiry prevents a silent ordinary answer while the
  conversation search intent remains on.

### 7. Wrong vs Correct

```ts
// Wrong: provider payload and secret-bearing error cross into the component.
const raw = await response.json();
setToolState(raw.candidates[0].content.parts);

// Correct: the adapter emits one shared event and the registry returns a safe
// persistent part.
const part = await registry.execute(normalizedCall, signal, step);
snapshot.contentParts = replaceToolPart(snapshot.contentParts, part);
await persistence.checkpoint(snapshot);

// Correct: resolve one mode-bound billing source before constructing the executor.
const resolvedSource = resolveTavilyExecutionSource(context);
const executor = resolvedSource
  ? createExecutorForSource(resolvedSource)
  : null;

// Wrong: reuse a valid Hosted Session while the model uses a Custom API.
const crossModeSource = browserKey
  ? browserSource
  : authenticated
    ? hostedSource
    : null;

// Correct: the connection mode owns the resource bundle.
const modeBoundSource = resolveTavilyExecutionSource({
  connectionMode,
  ...context,
});

// Wrong: forward a browser URL through the Hosted route.
fetch("/api/web-search", { body: JSON.stringify({ query, target: baseUrl }) });

// Wrong: treat optional official Tavily fields as universally compatible.
const body = { query, max_results, search_depth: "basic" };

// Correct: keep the shared compatibility payload minimal.
const body = { query, max_results };

// Wrong: leak a canonical helper field into a strict OpenAI-compatible wire.
const toolResult = { role: "tool", tool_call_id, name, content };

// Correct: the OpenAI Chat transport owns the minimum wire projection.
const toolResult = { role: "tool", tool_call_id, content };

// Wrong: restart DSML IDs at one for every generated answer.
const toolCallId = `dsml_${++sequence}`;

// Correct: IDs remain unique when multiple generated turns enter history.
const toolCallId = `dsml_${crypto.randomUUID()}`;

// Wrong: SDK defaults can retry, log raw upstream errors, and inject auto.
new ToolLoopAgent({ model, tools });

// Correct: CherryChat owns replay, logging, and wire omission semantics.
new ToolLoopAgent({
  model: wrapLanguageModel({ model, middleware: compatibilityMiddleware }),
  tools,
  maxRetries: 0,
  onError: () => undefined,
});

// Wrong: route generation through the auxiliary discovery/title transport.
await createChatTransport(connection).createChatCompletion(request, signal);

// Correct: endpoint identity selects one dynamically loaded generation runtime.
const runtimeKind = resolveAgentRuntimeKind(connection);
await (await loadAgentRuntime(runtimeKind)).run(options);

// Wrong: assume every tool is idempotent and dedupe raw argument strings.
const unique = new Map(calls.map((call) => [call.arguments, call]));

// Correct: only the executor that owns validated input declares idempotency.
const tavilyExecutor = {
  dedupeKey(input) {
    const parsed = inputSchema.safeParse(input);
    return parsed.success ? parsed.data.query : null;
  },
  execute,
};

// Wrong: require a sentinel even after the provider emitted a terminal chunk.
if (!sawDone) throw new StreamProtocolError("missing [DONE]");

// Correct: accept only a sentinel or an explicit provider finish reason.
if (!sawDone && !sawTerminalChunk) throw protocolError;
```

## Scenario: Stateless OpenAI Chat Reasoning Context

### 1. Scope / Trigger

Use this contract when changing DeepSeek V4, reviewed GLM, Qwen3.8, or Kimi K3
compatible Chat generation, `reasoning_content`, ordinary multi-turn or
tool-loop continuation, stream projection, context selection, message schemas,
Token estimation, persistence, or backup/export. The replay copy is
provider-owned continuation state; the visible reasoning projection remains a
separate user-facing part.

### 2. Signatures

```ts
type OpenAIChatReasoningContextProvider =
  | "deepseek-chat"
  | "glm-chat"
  | "qwen-chat"
  | "kimi-chat";

interface OpenAIChatReasoningContextBehavior {
  provider: OpenAIChatReasoningContextProvider;
  capture: "tool-call" | "always";
}

interface OpenAIChatReasoningContextPart {
  type: "provider_context";
  provider: OpenAIChatReasoningContextProvider;
  contextType: "reasoning_content";
  step: number; // 0..4
  text: string;
}

createOpenAIChatReasoningContext(
  provider: OpenAIChatReasoningContextProvider,
  step: number,
  text: string,
): OpenAIChatReasoningContextPart | null;

canAppendOpenAIChatReasoningContext(
  current: readonly OpenAIChatReasoningContextPart[],
  candidate: OpenAIChatReasoningContextPart,
): boolean;

getOpenAIChatReasoningContextProvider(
  modelId: string,
  choice?: ReasoningChoice,
): OpenAIChatReasoningContextProvider | null;

getOpenAIChatReasoningContextBehavior(
  modelId: string,
  choice?: ReasoningChoice,
): OpenAIChatReasoningContextBehavior | null;

toOpenAICompatibleModelMessages(
  messages: readonly ChatCompletionMessage[],
  modelId: string,
  reasoning?: ReasoningChoice,
): ModelMessage[];
```

Each Assistant message allows at most five steps per OpenAI Chat reasoning
provider, 1 MiB of UTF-8 text per step, and 4 MiB total per provider. Steps are
unique and bounded from 0 through 4.

### 3. Contracts

- DeepSeek V4 always owns `deepseek-chat` context in the OpenAI-compatible
  runtime. GLM owns `glm-chat` context only when the current explicit choice
  sends `thinking.enabled` with `clear_thinking:false`: On for switch-style GLM
  and High/Max for GLM-5.2. GLM default and Off neither capture nor replay it.
  Qwen3.8 owns `qwen-chat` for default or explicit effort, but not Off. Kimi K3
  always owns `kimi-chat`. Ordinary hybrid Qwen has no replay owner in this
  contract.
- Structured SDK reasoning is eligible; `<think>` text parsed from ordinary
  content is not rewritten as `reasoning_content`.
- Capture behavior is explicit rather than inferred from the provider name.
  DeepSeek/GLM use `tool-call`: persist only after the same generated Assistant
  turn contains a tool call, then retain every non-empty structured reasoning
  step. Qwen3.8/Kimi use `always`, so ordinary no-tool turns also retain every
  non-empty structured reasoning step for the next request.
- The running-tool durability checkpoint must already contain the preceding
  reasoning step. Streaming drafts and non-streaming `generate()` results use
  the same projector contract; stop/error/final states preserve validated
  context without storing SDK message objects.
- Runtime message schemas require unique bounded steps per provider and
  Assistant ownership. DeepSeek/GLM also require tool-call history; Qwen/Kimi
  accept bounded ordinary Assistant history. All four providers are distinct
  discriminated owners and must never satisfy another provider's serializer.
  This additive message-part union requires no Dexie table migration; old
  messages without these parts remain valid.
- After branch, cutoff, complete-round, and Token selection, the request builder
  binds each context part to its owning Assistant step. Only
  `toOpenAICompatibleModelMessages` converts only the current model and choice's
  owning context to reasoning parts that the adapter serializes as
  `reasoning_content`. GLM default/Off, Qwen3.8 Off, ordinary Qwen, every foreign
  Chat provider, GPT, Responses, Gemini, Anthropic, title, and unrelated
  compatible models strip it.
- AI SDK owns same-loop continuation for both streaming and non-streaming
  requests. Persisted history owns reload continuation. Do not concatenate all
  steps onto one unrelated Assistant message or infer ownership from array
  position.
- Count replay text conservatively during context budgeting. Full backup keeps
  the validated part; rendering, search, copy, print, ordinary JSON/Markdown
  export, logs, and user-facing errors omit the hidden replay copy.

### 4. Validation & Error Matrix

| Condition | Stable result |
| --- | --- |
| Eligible Chat turn has no tool call | Keep visible reasoning only; persist no reasoning-content provider context |
| Tool call appears after structured reasoning | Checkpoint the owning step before tool execution |
| Streaming or non-streaming tool continuation | Next model request contains the exact owning `reasoning_content` |
| Reloaded selected history contains valid context | Replay it on the next user turn after normal context selection |
| Duplicate step, step above 4, oversized text, or aggregate overflow | Ignore invalid stream candidate; persisted/imported schema rejects invalid records |
| User message contains Chat reasoning provider context | Schema rejects the record/import |
| DeepSeek request contains only `glm-chat` context, or conversely | Serializer omits the foreign context completely |
| GLM default or Off history contains `glm-chat` context | Serializer omits it and projector creates no new copy |
| Qwen3.8 default/effort has a no-tool reasoning answer | Persist bounded `qwen-chat` context and replay it on the next matching request |
| Qwen3.8 Off or ordinary Qwen has `qwen-chat` history | Serializer omits it and projector creates no new copy |
| Kimi K3 has a no-tool reasoning answer | Persist bounded `kimi-chat` context and replay it on the next Kimi request |
| Qwen request contains only `kimi-chat` context, or conversely | Serializer omits the foreign context completely |
| Only `<think>` markup was received | Do not persist it as replay context |

### 5. Good/Base/Bad Cases

- Good: GLM-5.2 High step 0 reasons, calls Tavily, and checkpoints; step 1
  reasons and answers. Both steps survive reload, while the next High request
  places step 0 on the tool Assistant and step 1 on the final Assistant.
- Good: the same flow works with streaming disabled; the provider may omit
  `stream:false`, but reasoning replay and persistence remain identical.
- Good: Qwen3.8 and Kimi K3 each complete an ordinary no-tool turn, survive a
  reload, and replay only their own ordered hidden context on the next turn.
- Base: a text/reasoning-only answer has no tool call, and GLM default/Off has no
  retained-thinking contract, so DeepSeek/GLM tool-call capture stores no hidden
  continuation context. Qwen3.8/Kimi always-capture is intentionally different.
- Bad: persist every reasoning answer, replay visible aggregated reasoning, or
  replay `glm-chat`, `qwen-chat`, or `kimi-chat` into another family because all
  use the same upstream field name.

### 6. Tests Required

- Projector: provider-specific tool-call versus always capture, every reasoning
  step, running-tool checkpoint, no-tool Qwen/Kimi persistence, limits,
  stop/error, and final persistence.
- Runtime: streaming and non-streaming two-request tool loops with exact actual
  request bodies, no retry/log/fallback, and Hosted schema acceptance.
- Context/converter: per-step reconstruction after reload, four-provider
  bidirectional isolation, GLM default/Off and Qwen Off omission, and strict
  isolation from GPT, Responses, Gemini, Anthropic, and auxiliary title
  requests.
- Schema/storage: UTF-8 item/aggregate limits, unique steps, Assistant-only
  ownership for all four providers, DeepSeek/GLM tool-history requirements,
  Qwen/Kimi ordinary history, Token estimation, stream persistence, full backup
  round trip, and ordinary-export isolation.
- Browser: cover each changed model family's compatible control, exact request
  fields, endpoint fallback, and at least one affected reload-replay workflow.

### 7. Wrong vs Correct

```ts
// Wrong: visible aggregate text loses step and provider ownership.
assistant.reasoning_content = visibleReasoningText;

// Correct: validate, persist, select, and replay the owning provider context.
const behavior = getOpenAIChatReasoningContextBehavior(modelId, choice);
const context = behavior
  ? createOpenAIChatReasoningContext(
      behavior.provider,
      step,
      structuredReasoning,
    )
  : null;
if (
  context &&
  (behavior?.capture === "always" || hasToolCall) &&
  canAppendOpenAIChatReasoningContext(saved, context)
) {
  saved.push(context);
}
const messages = toOpenAICompatibleModelMessages(
  selectedMessages,
  modelId,
  choice,
);
```

## Scenario: Stateless OpenAI Responses Provider Context

### 1. Scope / Trigger

Use this contract when changing the native OpenAI Responses AI SDK runtime,
reasoning metadata, context selection, stream persistence, backup/export, or a
transport that serializes canonical Assistant messages. The encrypted reasoning
item is provider state needed for a stateless next request, not visible chat
content and not an application credential.

### 2. Signatures

```ts
interface OpenAIResponsesContextPart {
  type: "provider_context";
  provider: "openai-responses";
  contextType: "reasoning";
  step: number; // 0..4
  itemId: string;
  encryptedContent: string;
  reasoningTokens: number | null;
}

runAiSdkAgent(
  options: AgentRuntimeOptions,
  prepare: () => AiSdkPreparedAgent,
  behavior?: {
    captureProviderContext?: boolean;
    captureToolProviderContext?: boolean;
  },
): Promise<StreamResult>;

toOpenAIResponsesModelMessages(
  messages: readonly ChatCompletionMessage[],
): ModelMessage[];

createOpenAIResponsesAgentProviderOptions(
  connection: ChatTransportConnection,
  timeoutPolicy: RequestTimeoutPolicy,
  fetchImplementation?: FetchLike,
): { baseURL: string; apiKey: string; fetch: FetchLike };
```

`OPENAI_RESPONSES_CONTEXT_LIMITS` allows at most 32 items per Assistant message,
a 512-character item ID, 512 KiB of UTF-8 encrypted content per item, and 1 MiB
of UTF-8 encrypted content per message. The complete backup manifest remains
bounded to 32 MiB on both export and import.

### 3. Contracts

- Construct the model with
  `createOpenAI({ baseURL, apiKey, fetch }).responses(modelId)`. The provider
  receives `store:false` and `include:["reasoning.encrypted_content"]` on every
  request. Do not use `previous_response_id`, server Conversations, or an OpenAI
  built-in tool.
- The controlled provider fetch accepts only an exact absolute
  `<normalized-base>/v1/responses` POST with no query or fragment. It reuses the
  shared first-byte, idle, total, mixed-content, and caller-abort lifecycle and
  sets `Accept` from the generated `stream` value.
- Capture provider metadata only in the native Responses runtime. Validate it
  before any draft or IndexedDB write; malformed, duplicate, or oversized
  metadata is ignored without discarding visible text or reasoning.
- Await a durability checkpoint as soon as a valid encrypted reasoning item is
  captured. Visible answer text is not evidence that terminal finalization has
  reached IndexedDB; an immediate Firefox reload must still replay the item.
- Upsert one item per `(Assistant message, itemId)`. If one model step emits
  several reasoning items, assign that step's reasoning Token total to the first
  item and zero to the rest so Token budgeting counts it once.
- Persist hidden context through draft, tool checkpoint, completed, stopped,
  IndexedDB, and full JSON backup states. Keep it out of React rendering, search,
  copy, print, Markdown/plain JSON export, logs, user-facing errors, and every
  non-Responses wire format.
- Request construction first applies selected branch, context cutoff, complete
  round selection, and automatic Token budgeting. Only provider-context parts
  attached to the retained Assistant messages are projected into the native
  Responses `ModelMessage` input.
- Replay each retained item as an empty reasoning ModelMessage part with
  `providerOptions.openai.itemId` and
  `providerOptions.openai.reasoningEncryptedContent`. The ordinary AI SDK
  compatible converter must ignore the same canonical field.
- `APICallError` is projected from status/code only. Never retain or show the raw
  upstream response body because a gateway may echo Authorization, request
  input, or encrypted reasoning content.

### 4. Validation & Error Matrix

| Condition | Stable result |
| --- | --- |
| Hosted connection selects Responses metadata | Factory does not select the native Responses runtime |
| BYOK has no URL or Key | `INVALID_REQUEST` / `UNAUTHORIZED` before provider fetch |
| URL, method, query, or fragment differs from exact `/v1/responses` POST | `INVALID_REQUEST`; no network request |
| Request omits `store:false` or encrypted-content include | `INVALID_REQUEST`; no network request |
| Request contains `previous_response_id`, `conversation`, or non-function tools | `INVALID_REQUEST`; no network request |
| Metadata lacks a non-empty encrypted payload or fails schema limits | Ignore that item; preserve visible generation |
| User message contains provider context | Message schema rejects the record/import |
| One Assistant message repeats an item ID or exceeds aggregate limits | Message schema rejects the record/import |
| Non-Responses transport receives canonical provider context | Serializer strips it completely |
| Upstream 401/429/5xx echoes input in its response body | Persist only stable redacted error code/status |

### 5. Good/Base/Bad Cases

- Good: a Responses reasoning item completes, its encrypted content survives a
  reload, and the next selected round sends that item before the new User input.
- Good: a stopped reasoning-only turn keeps valid captured context and can be
  continued without inventing a response ID chain.
- Base: a non-reasoning Responses answer has no provider-context part; the next
  request still sends `store:false` and the required include.
- Base: selecting the same model through an OpenAI Chat endpoint uses the
  compatible runtime and omits Responses-only hidden context from that wire.
- Bad: store the AI SDK `UIMessage` object, raw provider metadata, or complete
  upstream error body in IndexedDB.
- Bad: attach provider context to the latest Assistant after context selection;
  that can replay an item from an unselected branch or a Token-pruned round.

### 6. Tests Required

- Factory: Hosted, direct Chat, direct Responses, New API Chat/Responses,
  Gemini, and Anthropic runtime kinds; a failed selected runtime must not invoke
  another runtime or an auxiliary transport.
- Provider fetch: normalized/subpath URLs, exact POST, headers, streaming and
  non-streaming Accept, stateless fields, function-only tools, timeout/abort,
  CORS/mixed content, and rejection before fetch for every boundary violation.
- Runtime: text, reasoning summary, usage, image data URLs, reasoning choices,
  streaming/non-streaming, 401/429/5xx, invalid events, cancellation, one fetch,
  and no raw response body or secret in errors.
- Metadata/schema: early metadata without encrypted content, final upsert,
  duplicate summary parts, multiple items in one step, UTF-8 byte boundaries,
  aggregate limits, user-message rejection, and reasoning Token allocation once.
- Context/storage: branch, cutoff, regeneration, Token pruning, stopped turns,
  durability checkpoints, IndexedDB reload, and full backup restore replay only
  the retained path.
- Isolation: OpenAI Chat, Gemini, Anthropic, auxiliary title transports,
  ordinary export, print, copy, and search contain no item ID or
  encrypted-content fixture.
- Browser/build: Chromium, Mobile Chrome, Firefox, and WebKit cover native
  Responses and reload replay; the OpenAI SDK marker stays in an async chunk
  absent from the default page `entryJSFiles`; static output contains no
  real/test secrets.

### 7. Wrong vs Correct

```ts
// Wrong: use server state as the local conversation source of truth.
providerOptions.openai.previousResponseId = lastResponseId;

// Correct: every request is stateless and replays only selected local items.
providerOptions.openai = {
  store: false,
  include: ["reasoning.encrypted_content"],
};
const messages = toOpenAIResponsesModelMessages(selectedMessages);

// Wrong: trust and persist arbitrary provider metadata from the stream.
snapshot.parts.push(part.providerMetadata.openai);

// Correct: validate at ingress and keep the hidden type separate from UI parts.
const context = parseOpenAIResponsesProviderContext(metadata, step);
if (context && canAppendOpenAIResponsesProviderContext(current, context)) {
  await projector.captureProviderContext(metadata);
}
```

## Scenario: Stateless Gemini Thought Signatures

### 1. Scope / Trigger

Use this contract when changing the native Google AI SDK runtime, direct/New API
Gemini authentication, thinking configuration, tool metadata, context selection,
stream persistence, backup/export, or a serializer that consumes canonical
Assistant messages.

### 2. Signatures

```ts
interface GeminiThoughtSignatureContextPart {
  type: "provider_context";
  provider: "gemini";
  contextType: "thought_signature";
  step: number;
  toolCallId: string;
  thoughtSignature: string;
}

createGoogleAgentProviderOptions(
  connection: ChatTransportConnection,
  modelId: string,
  timeoutPolicy: RequestTimeoutPolicy,
  fetchImplementation?: FetchLike,
): GoogleGenerativeAIProviderSettings;

toGoogleModelMessages(messages: readonly ChatCompletionMessage[]): ModelMessage[];
resolveGeminiThinkingConfig(
  modelId: string,
  choice?: ReasoningChoice,
): GeminiThinkingConfig | undefined;
```

Each Assistant allows at most 32 signatures, 512 KiB of UTF-8 data per item,
and 1 MiB total. `toolCallId` is non-empty and at most 512 characters.

### 3. Contracts

- Construct the model with
  `createGoogleGenerativeAI({ baseURL, apiKey, headers, fetch })(modelId)`.
  Direct Gemini uses `x-goog-api-key`; New API Gemini sends both that header and
  `Authorization: Bearer <key>`.
- Lock one generation to the selected model. The controlled fetch accepts only
  its exact `:generateContent` POST or `:streamGenerateContent?alt=sse` POST and
  rejects another origin, model, method, query, fragment, or built-in Google
  tool before network I/O.
- The auxiliary Gemini transport and native Google runtime share
  `resolveGeminiThinkingConfig`. Gemini 2.5 uses `thinkingBudget`; Gemini 3/3.1
  uses `thinkingLevel`. The auxiliary JSON mapper uppercases the level at its
  wire boundary; the Google provider receives lowercase.
- Preserve native tool-call `providerMetadata` through `wrapStream` and
  `wrapGenerate`. Validate only `providerMetadata.google.thoughtSignature`,
  then bind it to the normalized `(step, toolCallId)`.
- Tool durability checkpoints persist a signature before Tavily continuation.
  IndexedDB, stopped/completed messages, selected branches and full backup
  retain it; ordinary export, rendering, search, print, copy, errors, logs and
  every non-Google wire omit it.
- After branch/cutoff/Token selection, `toGoogleModelMessages` attaches
  `providerOptions.google.thoughtSignature` only to the owning tool-call. Never
  store AI SDK message or metadata objects.
- Keep `maxRetries:0`, no raw `console.error`, five model steps, three tool
  calls, Tavily-only tools, and no cross-runtime fallback after Google fails.

### 4. Validation & Error Matrix

| Condition | Stable result |
| --- | --- |
| Hosted, missing endpoint metadata, or non-Gemini endpoint | Factory does not select `ai-sdk-google` |
| URL, model, method, query, or fragment differs from the locked request | `INVALID_REQUEST`; no network call |
| Key is empty or New API endpoint is not Gemini | Stable auth/request error before provider creation |
| Tool payload includes Google Search, URL Context, or code execution | `INVALID_REQUEST`; no network call |
| Signature is malformed, repeated, oversized, or over aggregate limits | Ignore stream candidate; persisted/imported schema rejects invalid records |
| Signature belongs to another provider or tool-call ID | Do not attach it to the Google tool call |
| Upstream 401/429/5xx or abort | One redacted terminal result; no retry or runtime switch |

### 5. Good/Base/Bad Cases

- Good: New API Gemini calls Tavily, the second model request returns the exact
  signature, and an immediate reload replays it from IndexedDB.
- Good: the same flow works through streaming and non-streaming Google paths.
- Base: a text-only answer has no signature; default reasoning omits
  `thinkingConfig`.
- Base: selecting the same model through a compatible Chat endpoint strips
  Google-only hidden context from that wire.
- Bad: persist all provider metadata, attach a signature by array position, or
  assume the streaming middleware path covers `doGenerate`.

### 6. Tests Required

- Factory/fetch: direct, New API, Hosted and unknown endpoints; exact model URL,
  direct/dual headers, function-only tools, timeout/abort and pre-fetch rejection.
- Runtime: stream/non-stream text, reasoning, image, usage, Gemini 2.5 budget,
  Gemini 3/3.1 level, Tavily, signature replay and no retry/log/fallback.
- Schema/context/storage: UTF-8 and aggregate limits, Token pruning,
  branch/cutoff/regeneration, checkpoints, backup and ordinary-export isolation.
- Wire isolation: compatible Chat, Responses, Anthropic, and auxiliary title
  requests contain none of the signature fixture.
- Browser/build: Chromium, Mobile Chrome, Firefox, and WebKit cover direct/New
  API, Tavily, reload, and stop; the `google.generative-ai` marker stays outside
  `/page` `entryJSFiles`.

### 7. Wrong vs Correct

```ts
// Wrong: rebuilding a tool call drops provider state in non-streaming mode.
return { type: "tool-call", toolCallId, toolName, input };

// Correct: preserve metadata; the Google-only projector narrows it later.
return { type: "tool-call", toolCallId, toolName, input, providerMetadata };

// Wrong: replay hidden state through a provider-neutral converter.
const messages = toAiSdkModelMessages(canonicalMessages);

// Correct: only the owning converter attaches the signature.
const messages = toGoogleModelMessages(canonicalMessages);
```

## Scenario: Stateless Anthropic Thinking Context

### 1. Scope / Trigger

Use this contract when changing the native Anthropic AI SDK runtime,
direct/New API Anthropic authentication, extended thinking, provider metadata,
context selection, persistence, backup/export, or Anthropic message replay.
Thinking signatures and redacted thinking are provider-owned continuation state,
not visible reasoning text and not application credentials.

### 2. Signatures

```ts
type AnthropicThinkingContextPart =
  | {
      type: "provider_context";
      provider: "anthropic";
      contextType: "thinking";
      step: number;
      blockIndex: number;
      text: string;
      signature: string;
    }
  | {
      type: "provider_context";
      provider: "anthropic";
      contextType: "redacted_thinking";
      step: number;
      blockIndex: number;
      redactedData: string;
    };

createAnthropicAgentProviderOptions(
  connection: ChatTransportConnection,
  modelId: string,
  timeoutPolicy: RequestTimeoutPolicy,
  disabledThinking: boolean,
  fetchImplementation?: FetchLike,
): AnthropicAgentProviderOptions;

toAnthropicModelMessages(
  messages: readonly ChatCompletionMessage[],
): ModelMessage[];

resolveAnthropicRequestSettings(
  request: ChatCompletionsRequest,
): AnthropicRequestSettings;
```

Each Assistant allows at most 32 Anthropic context blocks. `step` is `0..4`;
`blockIndex` is non-negative and unique inside one step. Thinking text,
signature, and redacted data are each limited to 512 KiB of UTF-8 data, and one
message is limited to 2 MiB of Anthropic replay payload.

### 3. Contracts

- Construct the model with
  `createAnthropic({ baseURL, apiKey, headers, fetch })(modelId)`. Direct
  Anthropic sends `x-api-key`; New API Anthropic sends both `x-api-key` and
  `Authorization: Bearer <key>`. The provider metadata namespace is always
  `anthropic`.
- The controlled fetch accepts only the exact normalized `/v1/messages` POST
  for the selected model, with no query or fragment. It allows function tools
  containing `name` and `input_schema`, rejects Anthropic server tools before
  network I/O, sets `Accept` from `stream`, and reuses the shared timeout,
  mixed-content, CORS, and caller-abort lifecycle.
- The auxiliary Anthropic transport and native Anthropic runtime share
  `resolveAnthropicRequestSettings`. `default` omits thinking fields; `off`
  sends disabled; Claude 4.6+ uses adaptive thinking plus optional effort;
  earlier mapped Claude reasoning models use enabled budget thinking. Thinking
  removes incompatible sampling fields and keeps budget strictly below final
  `max_tokens`.
- `@ai-sdk/anthropic@3.0.71` accepts a disabled option but does not emit the
  disabled wire field. The controlled adapter may inject
  `thinking: { type: "disabled" }` only after the canonical resolver selected
  `off`; it must not become a general body rewrite.
- Capture `thinking.signature` and `redacted_thinking.data` in streaming and
  non-streaming paths. Preserve stream block order as `(step, blockIndex)` and
  checkpoint as soon as valid hidden state arrives; visible text is not proof
  that IndexedDB already contains the replay payload.
- Persist validated context through draft, tool checkpoint, completed/stopped
  messages, IndexedDB, and full JSON backup. Keep it out of UI, search, copy,
  print, ordinary JSON/Markdown export, logs, errors, and every non-Anthropic
  wire format.
- Apply branch, cutoff, regeneration, complete-round, and Token selection before
  replay. `toAnthropicModelMessages` attaches a signed reasoning part or an
  empty redacted reasoning part only to the retained Assistant step and orders
  it before that step's text/tool calls.
- Keep `maxRetries: 0`, no raw `console.error`, five model steps, three tool
  calls, Tavily-only tools, and no cross-runtime fallback after native
  Anthropic has been selected.

### 4. Validation & Error Matrix

| Condition | Stable result |
| --- | --- |
| Hosted, unknown endpoint, or non-Anthropic endpoint | Factory does not select `ai-sdk-anthropic` |
| Empty Key or missing direct URL | `UNAUTHORIZED` / `INVALID_REQUEST` before provider fetch |
| URL, model, method, query, or fragment differs from the locked request | `INVALID_REQUEST`; no network call |
| Tool payload is not a function tool | `INVALID_REQUEST`; no network call |
| Reasoning choice is unsupported for the selected Claude model | `INVALID_REQUEST` before fetch |
| Context is malformed, duplicate, oversized, or over aggregate limits | Ignore stream candidate; persisted/imported schema rejects invalid records |
| User message contains provider context | Schema rejects the record/import |
| Non-Anthropic serializer receives Anthropic context | Strip it completely |
| Upstream 401/429/5xx or abort | One redacted terminal result; no retry or runtime switch |

### 5. Good/Base/Bad Cases

- Good: New API Anthropic calls Tavily, the continuation returns the exact
  signed thinking and redacted block, and a reload replays both from IndexedDB.
- Good: direct Anthropic and New API share one metadata namespace while retaining
  their different authentication headers.
- Base: a text-only answer has no hidden context; default reasoning leaves
  provider behavior untouched.
- Base: selecting the same model through a compatible Chat endpoint omits
  stored Anthropic provider context from that wire.
- Bad: replay visible reasoning text without its signature, persist arbitrary
  provider metadata, or attach hidden state after context selection.

### 6. Tests Required

- Factory/fetch: flag, direct, New API, Hosted and unknown endpoints; exact URL,
  direct/dual headers, stream/non-stream `Accept`, function-only tools,
  disabled compensation, timeout/abort, CORS/mixed content, and pre-fetch
  rejection.
- Resolver/runtime: `default|off|auto|effort`, adaptive/budget wire fields,
  sampling/max-token constraints, text, reasoning, image, usage, Tavily two-step
  continuation, semantic deduplication, 401/429/5xx, cancellation, no retry,
  no log, and no fallback.
- Schema/context/storage: streaming/non-streaming signature and redacted data,
  UTF-8 and aggregate limits, step/block ordering, Token pruning,
  branch/cutoff/regeneration, durability checkpoints, IndexedDB reload, full
  backup, and ordinary-export isolation.
- Wire isolation: compatible Chat, Responses, Google, and auxiliary title
  requests contain none of the Anthropic fixture unless the native Anthropic
  converter owns that request.
- Browser/build: Chromium, Mobile Chrome, Firefox, and WebKit cover direct/New
  API, Tavily, reload, and stop; the `ai-sdk/anthropic` marker stays in an async
  chunk absent from `/page` `entryJSFiles`; static output contains no real/test
  Key or hidden fixture.

### 7. Wrong vs Correct

```ts
// Wrong: visible reasoning cannot authenticate a later Anthropic request.
const replay = { type: "reasoning", text: part.text };

// Correct: only the Anthropic converter restores provider-owned state.
const replay = {
  type: "reasoning",
  text: part.text,
  providerOptions: { anthropic: { signature: part.signature } },
};

// Wrong: trust the SDK to serialize disabled thinking in provider 3.0.71.
providerOptions.anthropic.thinking = { type: "disabled" };

// Correct: the shared resolver selects off; the locked fetch injects the one
// verified wire field without rewriting unrelated request content.
const settings = resolveAnthropicRequestSettings(request);
createAnthropicAgentProviderOptions(
  connection,
  request.model,
  timeoutPolicy,
  settings.thinking?.type === "disabled",
);
```
