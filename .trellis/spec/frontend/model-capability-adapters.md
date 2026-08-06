# Model Capability And Endpoint Adapter Contract

Model metadata answers what a model can do. An endpoint profile answers what
the selected API type can encode. Keep these two sources separate and intersect
them before rendering controls or building a request.

## Scenario: Endpoint-Aware Model Capabilities

### 1. Scope / Trigger

Use this contract when adding model-family rules, changing capability
resolution, adding an API type, changing a reasoning control, or serializing a
model parameter to an upstream request. These changes cross catalogue, storage,
controller, UI, request-builder, and transport boundaries.

### 2. Signatures

```ts
type ReasoningChoice =
  | { mode: "default" }
  | { mode: "on" }
  | { mode: "auto" }
  | { mode: "off" }
  | { mode: "effort"; effort: ReasoningEffortLevel };

getEndpointProfile(apiType: ChatApiType): EndpointProfile;
getConnectionEndpointProfile(connection: {
  mode: ConnectionMode;
  apiType: ChatApiType;
  endpointType?: ChatEndpointType;
}): EndpointProfile;

resolveModelEndpointType(
  connection: Pick<ConnectionDraft, "mode" | "apiType">,
  modelId: string,
  descriptors: readonly ModelDescriptor[],
): ChatEndpointType | undefined;

resolveEffectiveModelCapability(input: {
  modelCapability: ResolvedModelCapability;
  endpointProfile: EndpointProfile;
}): EffectiveModelCapability;

buildChatCompletionsRequest(
  input: BuildChatRequestInput,
  estimator: TokenEstimator,
): Promise<BuiltChatRequest>;

getDeepSeekV4Variant(modelId: string): "flash" | "pro" | null;
getGlmReasoningVariant(modelId: string): "glm-5.2" | "switch" | null;
getQwenChatReasoningVariant(
  modelId: string,
):
  | "qwen3.8-max"
  | "qwen3.8-max-preview"
  | "hybrid-default-on"
  | "hybrid-default-off"
  | null;
isKimiK3Model(modelId: string): boolean;

encodeOpenAIChatReasoning(
  modelId: string,
  choice?: ReasoningChoice,
): {
  thinking?: {
    type: "enabled" | "disabled";
    clear_thinking?: false;
  };
  enableThinking?: boolean;
  reasoningEffort?: string;
  suppressSampling: boolean;
};
```

The six user-visible API types are `openai`, `openai-responses`, `anthropic`,
`gemini`, `new-api`, and `openai-compatible`. Hosted mode always uses the
same-origin OpenAI Chat endpoint profile, regardless of the stored custom API
type.

### 3. Contracts

- Preserve the raw model ID for discovery, persistence scope, and upstream
  requests. Normalize only a lookup key for catalogue and family matching.
- New API model discovery preserves `supported_endpoint_types` in
  `ModelDescriptor` and `modelListCache.v2`. Endpoint aliases map `openai`,
  `openai-response`, `anthropic`, and `gemini` to the four transport families;
  unknown aliases are ignored. The first valid entry wins, matching the New API
  order consumed by Cherry Studio. Missing metadata falls back to OpenAI Chat.
- Endpoint selection always receives the target model ID explicitly. Settings,
  title generation, and normal chat may target three different models and must
  never reuse `connection.modelId` implicitly.
- Resolve intrinsic capability before endpoint capability: exact correction,
  catalogue, reviewed family profile, conservative inference, sparse user
  override, then endpoint intersection.
- `default`, `on`, `auto`, and `off` are different domain choices. `on` is an
  explicit provider switch; `auto` is an adaptive provider mode. Never encode
  either as `null`, an empty string, or one shared sentinel.
- Components consume `EffectiveModelCapability`; they must not reproduce API
  type checks. The request builder validates the selected choice and creates a
  canonical `reasoning` field. Only the selected transport creates wire fields.
- Runtime selection has no rollout flag. It intersects connection mode, API
  type, and the explicit target model's resolved endpoint. BYOK
  `openai-responses` and New API models resolved to `openai-responses` use the
  native Responses provider; direct BYOK `gemini` and New API models resolved
  to `gemini` use the native Google provider; direct BYOK `anthropic` and New
  API models resolved to `anthropic` use the native Anthropic provider. A model
  family name alone is not enough, missing New API endpoint metadata uses
  compatible Chat, and Hosted remains on the compatible runtime regardless of
  stored API type.
- Generic OpenAI Chat, New API `openai-chat`, and OpenAI Compatible models use
  the existing OpenAI `reasoning_effort` mapping. DeepSeek V4 Flash/Pro is the
  model-aware exception on the same endpoint format: default omits controls,
  Off sends `thinking.disabled`, and explicit levels send `thinking.enabled`
  plus `reasoning_effort`. Reviewed GLM text models are the second exception:
  default omits all controls, Off sends only `thinking.disabled`, and explicit
  On/High/Max sends `thinking.enabled` plus `clear_thinking:false`; only
  GLM-5.2 also sends High/Max as `reasoning_effort`. Qwen3.8 Max/preview uses
  reviewed `reasoning_effort` levels, with `enable_thinking:false` available
  only on non-preview Max; reviewed hybrid Qwen uses only the boolean
  `enable_thinking` switch. Kimi K3 uses Low/High/Max `reasoning_effort`, cannot
  be disabled, and always suppresses Temperature and Top P. OpenAI Responses
  uses `reasoning.effort`; Anthropic uses `thinking` and optional
  `output_config`; Gemini uses `generationConfig.thinkingConfig`.
- DeepSeek V4 Flash exposes default/Off/Low/High/Max and Pro exposes
  default/Off/High/Max only when the effective wire format is `openai-chat`.
  Default and enabled thinking suppress Temperature and Top P; Off restores
  those user preferences. The same model matcher is shared by capability,
  transport, and Hosted validation, while the original model ID is sent
  upstream unchanged.
- GLM-5.2 exposes default/Off/High/Max; GLM-5.1, GLM-5, GLM-5-Turbo, and
  reviewed GLM-4.5/4.6/4.7 text variants expose default/Off/On. Vision,
  multimodal, unknown suffixes, and unreviewed future families do not match.
  GLM always keeps valid Temperature and Top P. `clear_thinking:false` means
  the caller owns complete, ordered `reasoning_content` replay.
- Qwen3.8 Max exposes default/Off/Low/Medium/XHigh; preview exposes the same
  levels without Off. Reviewed hybrid Qwen exposes default/Off/On with separate
  default-on and default-off UI copy. Coder, Instruct, Vision, ASR, TTS,
  Embedding, Reranker, always-thinking, and unknown future IDs do not borrow
  these controls. Ordinary hybrid Qwen never sends `thinking_budget`.
- Kimi matching is limited to normalized `kimi-k3` aliases. It exposes
  default/Low/High/Max, never Off, and marks Temperature and Top P unsupported.
  Do not extend the rule to K2.x or unknown K3 suffixes without a reviewed
  contract.
- Gemini 3/3.1 uses `thinkingLevel`. Gemini 2.5 uses `thinkingBudget`; `auto`
  is `-1`, Flash `off` is `0`, and Pro does not offer `off`. Never send both
  Gemini fields in one request.
- `nativeReasoningOnly` families retain intrinsic reasoning metadata but become
  fixed on generic stage-one endpoints. DeepSeek V4, reviewed GLM text, reviewed
  Qwen Chat, and Kimi K3 families are model-aware exceptions: their reviewed
  Chat Completions fields are sent optimistically through every `openai-chat`
  endpoint without hostname, provider, or channel-name inference. The same
  models become fixed/none on non-Chat endpoints.
- Stored capability records use `capabilityVersion: 2`. Read version 1 lazily,
  remove only reconstructable stale defaults, preserve user choices and model
  preferences, then rewrite the record as version 2.
- The generated catalogue projects `models.dev.tool_call` to intrinsic
  `tools`. Users may override this boolean for an unknown Custom API model.
  Network-search availability and tool definitions require the effective model
  capability to keep `tools=true` after endpoint intersection.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Choice is `default` | Valid for every control; omit upstream reasoning fields |
| DeepSeek V4 Flash uses `off` | Send only `thinking: { type: "disabled" }`; sampling preferences may be sent |
| DeepSeek V4 Flash uses Low/High/Max | Send enabled thinking plus the exact effort; omit Temperature and Top P |
| DeepSeek V4 Pro uses Low, Auto, Medium, or XHigh | Reject locally with `INVALID_REQUEST`; do not fetch |
| DeepSeek V4 uses a non-Chat endpoint | Effective control is fixed/none; never emit Chat-specific fields |
| GLM-5.2 uses `default` | Omit `thinking`, `reasoning_effort`, and `clear_thinking`; keep sampling preferences |
| GLM-5.2 uses High/Max | Send enabled retained thinking plus the exact effort; keep sampling preferences |
| Switch-style GLM uses `on` | Send enabled retained thinking without `reasoning_effort` |
| GLM uses Auto or an unsupported level | Reject locally with `INVALID_REQUEST`; do not fetch |
| GLM uses a non-Chat endpoint | Effective control is fixed/none; never emit Chat-specific fields |
| Qwen3.8 Max uses Off | Send only `enable_thinking:false`; keep sampling preferences |
| Qwen3.8 preview uses Off or an unsupported effort | Reject locally with `INVALID_REQUEST`; do not fetch |
| Reviewed hybrid Qwen uses On/Off | Send only the exact `enable_thinking` boolean; never send an effort or budget |
| Kimi K3 uses Low/High/Max | Send only the exact effort and omit Temperature/Top P |
| Kimi K3 uses Off/On/Auto/Medium/XHigh | Reject locally with `INVALID_REQUEST`; do not fetch |
| Qwen or Kimi uses a non-Chat endpoint | Effective control is fixed/none; never emit Chat-specific fields |
| Choice is absent from the effective control | Throw `RequestValidationError` with `INVALID_REASONING_CHOICE` |
| Endpoint marks reasoning unsupported | Effective control is `none`; hide the toolbar control |
| Native-only family uses a generic endpoint | Effective control is `fixed`; send no adjustable native field |
| Gemini API type receives a non-Gemini family | Effective wire format is `none` |
| Gemini transport receives an unknown model/choice directly | Throw `ChatTransportError` with `INVALID_REQUEST` |
| Gemini 2.5 Pro receives `off` | Reject; do not silently omit or convert it |
| Endpoint marks image input unsupported | Effective `vision` is false and attachment validation rejects images |
| Active model has `tools=false` | Search cannot be enabled and no tool definition is sent |
| New API descriptor has multiple valid endpoints | Use the first valid endpoint in returned order |
| Settings/title model differs from active model | Resolve transport and capability from the explicit target model ID |
| Version 1 stores an empty stale effort list | Remove it only when automatic capability now has reviewed efforts |
| New API target resolves to `openai-responses` | Select native Responses and serialize `providerOptions.openai` |
| Direct Anthropic or New API target resolves to `anthropic` | Select native Anthropic and serialize `providerOptions.anthropic` |
| Model name looks like GPT but endpoint resolves to `openai-chat` | Keep the compatible Chat runtime; do not infer Responses from the name |

### 5. Good / Base / Bad Cases

- Good: `gemini-3.1-pro` on the Gemini API exposes Low/Medium/High and the
  native Google runtime receives `thinkingLevel: "medium"`.
- Good: `gemini-2.5-flash` on the Gemini API sends `thinkingBudget: 1228` for
  Low and never sends `thinkingLevel`.
- Base: `default` leaves provider behavior untouched and survives model/API
  switching as the safe fallback.
- Good: Qwen3.8 Max on Hosted, New API `openai-chat`, or a Custom compatible
  endpoint sends XHigh as `reasoning_effort:"xhigh"`; ordinary Qwen On sends
  only `enable_thinking:true`.
- Good: Kimi K3 High sends only `reasoning_effort:"high"` and suppresses both
  sampling fields on every compatible Chat path.
- Base: Qwen/Kimi default omits model controls, while a non-Chat endpoint keeps
  intrinsic reasoning as fixed/none and never emits their Chat fields.
- Good: one New API list contains a Gemini model and a Responses model; each
  request uses its own descriptor even when the other model is active in chat.
- Good: a direct `openai-responses` GPT sends `reasoning.effort` through the
  native provider while the same model on an `openai-chat` endpoint sends the
  compatible Chat field and never receives hidden Responses context.
- Good: `deepseek-v4-flash` on Hosted, official DeepSeek, New API
  `openai-chat`, or a Custom compatible URL exposes the same reviewed levels;
  selecting High sends enabled thinking plus `reasoning_effort: "high"`.
- Base: DeepSeek model default omits both control fields while the UI explains
  the official default as thinking enabled at High; a third-party gateway may
  still apply its own default.
- Good: `glm-5.2` on Hosted, official Z.AI/BigModel, New API `openai-chat`, or a
  Custom compatible URL exposes the same four choices; High sends retained
  thinking, `reasoning_effort:"high"`, and the user's sampling preferences.
- Base: GLM model default omits every GLM control field while the UI documents
  the official default; a third-party gateway may still override that default.
- Bad: exposing a level because a model supports it without checking the API
  type, or serializing `reasoning_effort` in the common request builder.
- Bad: branch on DeepSeek hostname, add a protocol environment variable, or
  map DeepSeek Off to OpenAI's `reasoning_effort: "none"`.
- Bad: reuse `auto` as visible GLM On, infer a Zhipu adapter from its URL, or
  silently retry a rejected GLM request without the selected fields.
- Bad: resolve a settings or title model through the current chat model's
  descriptor, producing a valid request on the wrong wire protocol.

### 6. Tests Required

- Family projection: canonical, provider-prefixed, dated, quantized, preview,
  and behavior-bearing suffixes for GPT, Claude, Gemini, Grok, Qwen, DeepSeek,
  and GLM.
- Effective resolver: hard endpoint limits, Hosted profile selection,
  native-only controls, unknown Gemini models, and every reasoning choice.
- Transport units: assert exact JSON fields and absence of foreign/internal
  fields for OpenAI Chat, Responses, Anthropic, Gemini 3/3.1, and Gemini 2.5.
- DeepSeek Chat units: Flash/Pro aliases, default/Off/allowed levels, rejected
  levels, Temperature/Top P suppression, GPT compatibility, and title requests.
- GLM Chat units: exact reviewed aliases and exclusions, default/Off/On or
  High/Max matrices, retained-thinking ownership, sampling preservation,
  rejected cross-family choices, GPT/DeepSeek compatibility, and title requests.
- Qwen/Kimi Chat units: exact normalized aliases and exclusions, default and
  allowed-choice matrices, Qwen sampling preservation, Kimi sampling
  suppression, rejected cross-family choices, and title requests.
- Browser: Hosted, New API `openai-chat`, and Custom compatible controls;
  capture exact DeepSeek, GLM, Qwen, and Kimi bodies and model/endpoint-switch
  fallback.
- Storage: seed version 1, resolve it, assert the version 2 durable record and
  preserved preferences; verify backup v1/v2 import and export.
- Browser: discover `gemini-3.1-pro` and a Gemini 2.5 model, select a level,
  send a message, and assert the captured request payload. Run Chromium,
  Mobile Chrome, and affected Firefox workflows.
- New API: parse endpoint aliases, preserve descriptors across refresh/failure/
  backup restore, and assert an explicit non-active target resolves correctly.
- Runtime factory: combine mode, API type, explicit target descriptor, and
  endpoint type; assert native Responses, Google, and Anthropic are never
  chosen by model name alone and missing New API metadata selects compatible
  Chat.
- Tools: catalogue true/false, unknown-model user override, effective endpoint
  intersection, and composer visibility after a model switch.

### 7. Wrong vs Correct

```ts
// Wrong: model truth is treated as proof that the endpoint accepts the field.
const showReasoning = modelCapability.reasoning;
request.reasoning_effort = selectedValue;

// Correct: UI and validation share one endpoint-aware projection.
const effective = resolveEffectiveModelCapability({
  modelCapability,
  endpointProfile: getConnectionEndpointProfile(connection),
});
const request = await buildChatCompletionsRequest({
  ...input,
  capability: effective,
  reasoning: selectedChoice,
});

// Correct: the transport owns the provider-specific wire representation.
const wireRequest = encodeForSelectedEndpoint(request);

// Wrong: DeepSeek Off reuses the generic OpenAI sentinel.
const wrongDeepSeekOff = { reasoning_effort: "none" };

// Correct: one model-aware Chat encoder owns the reviewed DeepSeek shape.
const deepSeekOff = encodeOpenAIChatReasoning("deepseek-v4-flash", {
  mode: "off",
});

// Wrong: an adaptive choice is reused as GLM's explicit binary switch.
const wrongGlmOn = { mode: "auto" } as const;

// Correct: the domain keeps explicit On distinct until the GLM encoder.
const glmOn = encodeOpenAIChatReasoning("glm-4.7", { mode: "on" });

// Wrong: one generic OpenAI effort invents a numeric control for hybrid Qwen.
const wrongQwenOn = { reasoning_effort: "high" };

// Correct: the reviewed Qwen variant owns its exact boolean wire field.
const qwenOn = encodeOpenAIChatReasoning("qwen3-32b", { mode: "on" });

// Correct: Kimi effort suppresses unsupported sampling in both transports.
const kimiHigh = encodeOpenAIChatReasoning("kimi-k3", {
  mode: "effort",
  effort: "high",
});

// Correct: every non-chat caller states which model owns endpoint selection.
const endpointType = resolveModelEndpointType(connection, titleModelId, models);

// Wrong: select a provider from a model-family guess.
const runtime = modelId.startsWith("gpt-") ? "responses" : "chat";

// Correct: the resolved endpoint, not the family name, owns provider choice.
const runtime = resolveAgentRuntimeKind({
  mode: connection.mode,
  apiType: connection.apiType,
  endpointType,
});
```
