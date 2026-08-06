# Error Handling

## Error Owners

- `RequestSecurityError`: same-origin, UTF-8, and request-size failures.
- `ServerConfigurationError`: invalid environment combinations or URLs.
- `ChatTransportError`: stable chat/network/upstream codes consumed by the UI.
- `StorageError`: normalized IndexedDB/localStorage failures.

Preserve typed errors until the layer that can map them. Do not catch a stable
error and replace it with an arbitrary string earlier in the flow.

## HTTP Contract

Use `jsonResponse` and `errorResponse` from `src/server/http.ts`:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Access code is invalid" } }
```

Responses are `no-store` and `nosniff`. Map `RequestSecurityError` through
`securityErrorResponse`. Unexpected configuration errors use a generic
`CONFIGURATION_ERROR`; upstream details pass through the proxy redactor before
being returned. Never include secrets, digests, Authorization values, full
request bodies, or Base64 images in `message` or `detail`.

## UI Propagation

Translate stable error codes at the controller boundary. Preserve ownership when
displaying them: LLM request/stream errors are persisted as a safe projection on
the affected Assistant message; settings errors remain inside the relevant
form; short-lived operation failures use the shared Toast; startup or storage
degradation may use the persistent workspace warning. The regression test
scopes localized auth errors to their owning form or message.

`MessageError` contains only `code`, `status`, and `retryable`. Never persist a
raw `ChatTransportError`, upstream message/detail, request body, or credential.
Partial response parts remain on an error message and error-status messages stay
out of future model context.

Avoid status-only handling, parsing upstream prose in components, swallowing an
abort as a failure, or retrying a generation after partial output.

## Scenario: Outbound Request Timeout Policy

### 1. Scope / Trigger

Use this contract whenever changing server proxying, browser transports,
provider adapters, `/api/config`, or deployment-owned request timeouts. It keeps
Hosted, same-origin BYOK, and direct Custom API requests on the same lifecycle.

### 2. Signatures

```ts
interface RequestTimeoutPolicy {
  modelListMs: number;
  chatFirstByteMs: number;
  chatIdleMs: number;
  chatTotalMs: number;
}

fetchWithRequestTimeouts(
  input: RequestInfo | URL,
  init: RequestInit,
  timeouts: OperationTimeouts,
  fetchImplementation?: typeof fetch,
  mapTimeoutError?: (phase: RequestTimeoutPhase) => Error,
): Promise<Response>;
```

`GET /api/config` exposes `requestTimeouts: RequestTimeoutPolicy`. The browser
accepts a missing field for older responses and uses the checked-in defaults;
a present malformed field rejects startup configuration.

### 3. Contracts

- Environment values are whole seconds from `0` through `86400`:
  `MODEL_LIST_TIMEOUT_SECONDS`, `CHAT_FIRST_BYTE_TIMEOUT_SECONDS`,
  `CHAT_IDLE_TIMEOUT_SECONDS`, and `CHAT_TOTAL_TIMEOUT_SECONDS`.
- Defaults are 30 seconds for model lists, 300 seconds for chat response
  headers, 300 seconds between body chunks, and 1800 seconds total.
- `0` disables only its timer. Every body chunk resets idle time; no chunk
  resets total time.
- All adapters call the shared `fetchUpstream`/`fetchWithRequestTimeouts`
  lifecycle. Provider modules must not add independent timeout constants.
- Timeout becomes retryable `REQUEST_TIMEOUT`. User Stop remains `ABORTED` and
  has priority over timeout classification.
- A body timeout errors the response stream so existing reasoning/answer parts
  remain on the Assistant message. Native JSON parsing must rethrow an existing
  `ChatTransportError` instead of replacing it with `STREAM_PROTOCOL_ERROR`.
- Main-chat timeout values are deployment configuration, not ordinary settings
  controls. Model health-check controls, if introduced, are a separate action.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Variable absent or empty | Use the checked-in default |
| Variable is `0` | Disable that individual timer |
| Decimal, negative, non-numeric, or above `86400` | `ServerConfigurationError` without echoing the value |
| Timer expires before response headers | Abort fetch; server returns `504 REQUEST_TIMEOUT` |
| Idle or total timer expires after headers | Error response body with `REQUEST_TIMEOUT` |
| Caller aborts first | `499 ABORTED` on server; stopped message in browser |
| `/api/config.requestTimeouts` is absent | Browser uses default policy |
| Present public policy is malformed | Reject public configuration |

### 5. Good / Base / Bad Cases

- **Good:** a stream emits a chunk every four minutes, runs past five minutes,
  and completes before the 30-minute total limit.
- **Base:** a normal request uses the default 30/300/300/1800-second policy
  without any settings UI.
- **Good:** a deployment sets `CHAT_IDLE_TIMEOUT_SECONDS=0`; first-byte and total
  limits remain active.
- **Bad:** one provider uses a fixed two-minute wall-clock timer or maps an idle
  timeout to a generic network/protocol error.

### 6. Tests Required

- Shared fetch: first-byte, per-chunk idle reset, non-resetting total, disabled
  timers, cleanup, model-list phase, and caller-abort precedence.
- Server config/proxy: defaults, overrides, invalid redacted values, public
  projection, `504 REQUEST_TIMEOUT`, and `499 ABORTED`.
- Factory/adapters: every supported API type consumes the same policy.
- Streaming/persistence: partial output survives a body timeout and the stored
  error is retryable.
- Browser: a short public first-byte policy renders the localized timeout on the
  affected Assistant message, not as a global workspace error.

### 7. Wrong vs Correct

```ts
// Wrong: healthy streams die after one fixed wall-clock limit.
setTimeout(() => controller.abort(), 120_000);

// Correct: operation semantics come from one validated policy.
await fetchUpstream(
  url,
  init,
  fetchImplementation,
  isMixedContent,
  chatTimeouts(timeoutPolicy),
);
```
