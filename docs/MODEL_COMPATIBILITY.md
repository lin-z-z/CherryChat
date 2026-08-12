# Model and protocol compatibility

**English** · [简体中文](./MODEL_COMPATIBILITY_CN.md)

[Documentation](./README.md) · [Deployment](./DEPLOYMENT.md) ·
[Security](./SECURITY.md) · [Project home](../README.md)

CherryChat separates the selected connection protocol from model capability.
An interface control is shown only when the active model and endpoint can encode
it. Provider names or Base URL hostnames are not used to silently guess a
different wire protocol.

## Protocol adapters

| API type                | Primary operation                                                         | Availability                                             |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| OpenAI Chat Completions | `POST /v1/chat/completions`                                               | BYOK direct, same-origin fixed proxy, and Hosted access. |
| OpenAI Responses        | `POST /v1/responses`                                                      | BYOK direct and New API metadata routing.                |
| Anthropic               | `POST /v1/messages`                                                       | Native BYOK direct and New API metadata routing.         |
| Gemini                  | `POST /v1beta/models/{model}:streamGenerateContent` or generate operation | Native BYOK direct and New API metadata routing.         |
| New API                 | `GET /v1/models`, then per-model endpoint routing                         | BYOK only.                                               |
| OpenAI-compatible       | `POST /v1/chat/completions`                                               | BYOK direct or same-origin fixed proxy.                  |

Hosted access always uses the fixed OpenAI-compatible Chat Completions adapter,
regardless of the API type last saved in the browser.

## Base URL rules

- Enter the provider root or its `/v1` base, not a complete operation URL.
- OpenAI Responses normalizes the base and appends `/v1/responses`.
- Anthropic appends `/v1/messages`.
- Gemini normalizes to the Google-compatible API root and builds the model
  operation path.
- OpenAI Chat and generic compatible adapters append `/v1/models` and
  `/v1/chat/completions` as needed.
- An empty Base URL is meaningful only for the fixed same-origin
  OpenAI-compatible BYOK path.

Providers and gateways can expose different URL conventions. Verify the final
browser request before assuming that a successful model-list request proves the
chat path is correct.

## New API endpoint metadata

For New API connections, CherryChat reads `supported_endpoint_types` from each
model returned by `/v1/models` and recognizes these values:

| Metadata value            | CherryChat endpoint            |
| ------------------------- | ------------------------------ |
| `openai`                  | OpenAI Chat Completions        |
| `openai-response`         | OpenAI Responses               |
| `openai-response-compact` | OpenAI Responses               |
| `anthropic`               | Native Anthropic Messages      |
| `gemini`                  | Native Gemini Generate Content |

When endpoint metadata is missing, the model falls back to OpenAI Chat
Completions. The order and accuracy of a gateway's metadata remain that
gateway's responsibility.

## Shared capabilities

The current adapters and tests cover:

- Streaming text and usage projection.
- The model-visible `web_search` tool used by the bounded Tavily, Exa, and Grok
  web-search workflows.
- Image input when the resolved model and endpoint support it.
- Reasoning display and provider-specific continuation context.
- Per-model streaming, Temperature, Top P, context-window, vision, tool, and
  reasoning capability overrides.
- Message branch regeneration, persisted conversations, backup, and export.

Support in CherryChat does not guarantee support in every compatible gateway.
A third-party service may reject provider extensions, omit stream events, or
return incomplete endpoint metadata.

## OpenAI Responses boundary

OpenAI Responses is implemented as a dedicated BYOK adapter and can also be
selected through New API endpoint metadata. CherryChat keeps its own local
conversation tree and does not expose provider-side conversation selection as a
user workflow.

The implementation is OpenAI-first. Third-party Responses-compatible services
must be tested individually, especially for reasoning stream event names,
encrypted reasoning continuation, tool-call continuation, and unsupported
request fields. Selecting Responses is not a claim that every DeepSeek, GLM,
Qwen, Kimi, or generic gateway variant is fully compatible.

## OpenAI Chat reasoning controls

The following provider-specific controls apply only when the selected endpoint
resolves to OpenAI Chat Completions. CherryChat matches reviewed model IDs and
does not infer these contracts from a hostname.

### DeepSeek V4

- DeepSeek V4 Flash: model default, Off, Low, High, and Max.
- DeepSeek V4 Pro: model default, Off, High, and Max.
- Model default omits `thinking` and `reasoning_effort`.
- Off sends disabled `thinking`.
- Explicit levels send enabled `thinking` plus the reviewed
  `reasoning_effort`.
- Model-default and enabled thinking omit Temperature and Top P because the
  reviewed DeepSeek thinking contract ignores them.
- Bounded Assistant `reasoning_content` is retained only with the required tool
  history.

### GLM

- GLM-5.2: model default, Off, High, and Max.
- Reviewed GLM-5.1, GLM-5, GLM-5-Turbo, and GLM-4.5/4.6/4.7 text variants:
  model default, Off, and On.
- Vision, dedicated multimodal, and unreviewed future variants are not assigned
  these controls automatically.
- Enabled thinking sends `thinking.enabled` and `clear_thinking:false`; GLM-5.2
  also sends the selected effort.
- GLM keeps valid Temperature and Top P preferences.
- Retained `reasoning_content` requires explicit enabled thinking and tool
  history.

### Qwen

- `qwen3.8-max`: model default, Off, Low, Medium, and XHigh.
- The reviewed preview variant omits Off.
- Other reviewed mixed-thinking Qwen models use model default, Off, and On
  without a fabricated numeric budget.
- Qwen3.8 emits either `enable_thinking:false` or the reviewed effort; other
  hybrid Qwen models emit only `enable_thinking`.
- Valid Temperature and Top P preferences remain available.
- Qwen3.8 continuation context can be retained for ordinary and tool turns when
  thinking is not Off.

### Kimi K3

- Model default, Low, High, and Max are available.
- There is no Off state.
- The adapter emits only the reviewed `reasoning_effort` and omits Temperature
  and Top P.
- Bounded continuation context can be retained for ordinary and tool turns.

Provider continuation contexts are separately owned and validated. CherryChat
does not replay one provider family's hidden data into another family.

## Compatibility reporting

When reporting a compatibility issue, include:

- API type and connection mode.
- Sanitized Base URL shape without credentials or private hostnames.
- Exact model ID returned by the provider.
- New API `supported_endpoint_types`, if applicable.
- Whether model listing, non-streaming title generation, streaming chat, tools,
  and continuation each succeed.
- Sanitized HTTP status and stable CherryChat error code.

Never attach API keys, access codes, cookies, full private prompts, raw Vercel
environment output, or unredacted provider responses to a public Issue.
