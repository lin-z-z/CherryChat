# Backend Quality Guidelines

## Security Invariants

- Hosted chat and search Keys, Provider URLs, Grok model, and Grok X Search are
  read only on the server and never enter public config or client bundles.
- Access codes are normalized, bounded, HMAC-SHA-256 digested, and compared over
  every configured code with `timingSafeEqual` (`src/server/auth.ts`).
- State-changing auth routes require an exact same-origin `Origin`. Accept an
  exact match against either the framework request URL or the request URL's
  protocol plus the validated HTTP `Host` authority, because Next.js may
  normalize a local/LAN hostname internally. Do not use a client-selected
  target or `X-Forwarded-Host` as an origin override.
- Server proxy targets come only from validated `BASE_URL`,
  `TAVILY_BASE_URL`, `EXA_BASE_URL`, or `GROK_RESPONSES_URL`; client headers,
  query parameters, and bodies cannot override any target.
- Request bodies are streamed through byte and UTF-8 limits before parsing.
- Hosted model IDs are restricted to the configured allowlist.

## Required Tests

Configuration combinations and public projection live in `config.test.ts`;
HMAC/session behavior in `auth.test.ts`; auth/config routes in `routes.test.ts`;
proxy target, redaction, abort, streaming, and allowlist behavior in
`upstream-proxy.test.ts`. Storage changes require transaction, migration, quota,
or integrity tests as applicable.
Hosted search additionally requires fixed-target, session, origin, bounded-body,
timeout/cancel, upstream error, and secret-isolation tests in
`hosted-web-search.test.ts`.

During development, run the affected tests above through `test:related` or a
direct test path. A local commit also requires format, zero-warning Lint, strict
type-check, and the task's complete backend impact surface. Full coverage,
production build, `.next/static` canary scan, audits, and browser matrix belong
to Push/PR/release unless the change touches security, dependencies, build/test
configuration, migrations, or another high-fan-out contract. Never apply a force
fix that downgrades Next.js or adds an unverified override.

## Forbidden Patterns

- Arbitrary target URL headers such as `x-base-url`.
- Logging request bodies, headers, credentials, access-code digests, or images.
- Buffering the complete upstream SSE response before returning it.
- Returning raw thrown errors from Route Handlers.
- Partial multi-table writes or unvalidated imported/local JSON.

## Scenario: Hosted Vercel Access

### 1. Scope / Trigger

Use this contract whenever changing Vercel environment wiring, hosted login,
session cookies, public configuration, or same-origin model/chat/search routes.

### 2. Signatures

- `GET /api/config` returns public deployment metadata plus authentication state.
- `POST /api/auth` accepts `{ accessCode: string }`; `DELETE /api/auth` signs out.
- `GET /api/models` and `POST /api/chat` use `x-cherrychat-mode: byok | hosted`.
- `POST /api/web-search` accepts the strict
  `{ query, maxResults, provider }` shape after same-origin and signed-session
  validation. `provider` is only an allowed Provider ID; the server selects the
  complete Tavily, Exa, or Grok configuration from its validated env mapping.
- `parseServerConfig(process.env)` is the only environment-to-domain adapter.
- `TITLE_MODEL?: string` is the deployment default for automatic chat titles.

### 3. Contracts

Hosted mode requires `OPENAI_API_KEY`, `ACCESS_CODE`, and `AUTH_SECRET` together,
plus at least one comma-separated `MODELS` entry. `BASE_URL` defaults to
`https://api.openai.com`; `DEFAULT_MODEL` defaults to the first allowed model;
`TITLE_MODEL` defaults to `DEFAULT_MODEL`; both model IDs must belong to
`MODELS`. `DISABLE_BYOK` is exactly `true` or `false`.

The public response contains only `byokEnabled`, `hostedEnabled`,
`hostedWebSearchEnabled`, `hostedWebSearchProvider`,
`hostedWebSearchProviders`, `models`, `defaultModel`, `titleModel`,
`authenticated`, and the
validated millisecond `requestTimeouts` policy. Server Keys, access codes,
secrets, raw environment strings, fixed upstream URLs, and signed tokens never
enter that response or client bundles.

Hosted sign-in preserves the HTTP failure class at the browser boundary. A
`401` maps to an invalid access code; a `403` maps to a rejected connection.
The controller must not report every non-2xx `/api/auth` response as an invalid
code.

`WEB_SEARCH_PROVIDER` is exactly `tavily | exa | grok`, defaults to Tavily, and
is the only source of the Hosted default. An omitted
`WEB_SEARCH_ALLOWED_PROVIDERS` locks Hosted search to that default. An explicit
allowlist is comma-separated, normalized, de-duplicated in first-seen order,
non-empty, contains the default, and requires a complete configuration for
every entry. List order controls only Settings display order; configured Keys
outside the list remain unavailable. Each Provider Key is optional, trimmed,
validated as 8 through 2048 characters, and accepted only with the complete
Hosted trio. Without an explicit allowlist, a missing default-Provider Key
disables only Hosted search; with an explicit allowlist, any incomplete entry
is a configuration error.

`TAVILY_BASE_URL` defaults to `https://api.tavily.com` and `EXA_BASE_URL`
defaults to `https://api.exa.ai`; either accepts a base or trailing `/search`
URL. `GROK_RESPONSES_URL` is a complete endpoint and defaults to
`https://api.x.ai/v1/responses`; `GROK_MODEL` defaults to `grok-4.5` and
`GROK_X_SEARCH` defaults to `false`. URLs are absolute credential-free HTTP(S)
without query/fragment and use HTTPS in production; only explicit loopback
development may use HTTP.

The search route accepts only the requested Provider ID from the browser. It
never accepts a target, Authorization header, Key, URL, model, X Search value,
or another extra body field. The route rejects a missing, unknown, or disallowed
Provider before acquiring a concurrency lease or fetching upstream. A malformed
Cookie is an invalid session, not a configuration failure. Tavily, Exa, and
Grok adapters own their exact upstream bodies; only their normalized
`WebSearchToolOutput` is returned.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Partial Key/code/secret trio | `CONFIGURATION_ERROR` |
| `AUTH_SECRET` shorter than 32 UTF-8 bytes | `CONFIGURATION_ERROR` |
| Any access code over 256 UTF-8 bytes | `CONFIGURATION_ERROR` |
| Hosted mode with an empty model list | `CONFIGURATION_ERROR` |
| Default model outside the allowlist | `CONFIGURATION_ERROR` |
| Configured title model outside the allowlist | `CONFIGURATION_ERROR` |
| `DISABLE_BYOK=true` without complete hosted config | `CONFIGURATION_ERROR` |
| Missing, invalid, or cross-origin `Origin` on auth mutation | `403 FORBIDDEN` |
| Browser Origin matches HTTP Host while `request.url` uses a normalized hostname | Accept as same-origin |
| Wrong access code or invalid session | `401 UNAUTHORIZED` |
| Hosted model outside the allowlist | `403 MODEL_NOT_ALLOWED` |
| Any search Provider Key without complete Hosted config | `CONFIGURATION_ERROR` |
| `WEB_SEARCH_PROVIDER` is not Tavily, Exa, or Grok | `CONFIGURATION_ERROR` |
| Allowlist omitted and default Provider has no Key | Hosted search disabled; Hosted chat remains available |
| Explicit allowlist is empty, unknown, or omits the default | `CONFIGURATION_ERROR` |
| Explicit allowlist contains an incomplete Provider | `CONFIGURATION_ERROR` |
| Any configured Provider URL is unsafe or malformed | `CONFIGURATION_ERROR` |
| Empty/overlong Grok model | `CONFIGURATION_ERROR` |
| Search route without valid same-origin Session | `401 UNAUTHORIZED` before Provider fetch |
| Provider is missing, unknown, or not in the allowlist | `400 INVALID_REQUEST`; no lease or Provider fetch |
| Browser adds Key/URL/model/X Search or another extra field | `400 INVALID_REQUEST`; no Provider fetch |
| Deployment Provider Key rejected upstream | `502 TOOL_AUTH_FAILED`, never `401` |
| Provider 429 / timeout / 5xx | `429 TOOL_RATE_LIMITED` / `504 TOOL_REQUEST_TIMEOUT` / `503 TOOL_SERVICE_UNAVAILABLE` |

### 5. Good / Base / Bad Cases

- **Good:** complete hosted variables plus `DISABLE_BYOK=false` expose BYOK and
  hosted access; a signed HttpOnly cookie authorizes fixed-target chat.
- **Good:** `TITLE_MODEL` selects another allowed Hosted model for first-use
  title generation; a browser-saved title choice overrides it.
- **Base:** no hosted secret trio plus `DISABLE_BYOK=false` produces a working
  BYOK-only deployment with no external database.
- **Bad:** a client sends a target host, deployment Key, or disallowed model; the
  server ignores/rejects it before upstream fetch.
- **Good:** a signed-in visitor in Hosted mode uses the fixed hosted route;
  Custom API mode bypasses it and requires the selected personal Provider
  source. Failures never change mode or billing source.
- **Good:** Hosted Grok uses env-selected `grok-4.5` with Web Search always on;
  X Search appears upstream only when `GROK_X_SEARCH=true`.
- **Good:** default Tavily plus allowlist `grok,tavily` displays Grok first but
  still resolves Tavily until the browser saves an allowed Grok preference.
- **Base:** omit the allowlist to preserve the legacy single-Provider locked UI
  and request path with no migration.
- **Bad:** expose a search proxy with no Session because the client tool runner
  already limits calls. Client limits are not deployment-wide abuse controls.

### 6. Tests Required

- `src/server/config.test.ts`: Hosted trio combinations, search Provider
  default, absent/empty/unknown/de-duplicated allowlists, every Key/URL,
  Grok model/X Search validation, default/title allowlist validation,
  normalization, ordered public Provider IDs, and secret-free projection.
- `src/server/auth.test.ts`: normalization, HMAC comparison, expiry, and tampering.
- `src/server/routes.test.ts`: public fields, wrong/correct code, Cookie,
  logout, and a browser Host that differs from the normalized request URL.
- `src/server/security.test.ts`: request-URL match, Host-authority match,
  missing/malformed Origin, malformed Host, and cross-origin rejection.
- `src/server/upstream-proxy.test.ts`: fixed target, allowlist, redaction, abort.
- `src/server/hosted-web-search.test.ts`: origin/session, strict required
  Provider body, unknown/disallowed Provider rejection before lease/fetch,
  environment-selected target for all three Providers, client Key/URL/model/
  X Search rejection, 401/403/429/5xx, timeout, abort, response bound,
  redaction, and each exact upstream body.
- `tests/e2e/chat-core.spec.ts`: BYOK-disabled UI and connection-method state.
- `tests/e2e/chat-data-tools.spec.ts`: `403` remains a rejected-connection message and
  `401` remains an invalid-code message.
- `tests/e2e/chat-data-tools.spec.ts`: login becomes usable without reload, personal Key
  wins, clearing it restores hosted search, and expired auth cannot silently
  send a tool-free answer while search still appears enabled.
- Real Preview evidence: both deployment shapes, browser network paths, and
  credential-free Vercel logs after authenticated traffic.

### 7. Wrong vs Correct

```typescript
// Wrong: the browser chooses a server-side proxy target or sends the hosted Key.
fetch("/api/chat", {
  headers: { "x-base-url": userUrl, Authorization: `Bearer ${deploymentKey}` },
});

// Correct: mode is declared; the server selects its validated deployment target
// and injects the hosted Key only after verifying the signed session.
fetch("/api/chat", {
  headers: { "x-cherrychat-mode": "hosted" },
});

// Correct: hosted search sends only the allowed Provider ID, never its bundle.
fetch("/api/web-search", {
  method: "POST",
  body: JSON.stringify({ query, maxResults, provider }),
});

// Wrong: expose an unchecked deployment title model to the browser.
const titleModel = environment.TITLE_MODEL;

// Correct: validate it against MODELS and project only the model ID.
const titleModel = configuredTitleModel ?? defaultModel;
```

## Scenario: Hosted Stateless Abuse Guard

### 1. Scope / Trigger

Use this contract whenever changing Hosted sign-in, `/api/chat`,
`/api/web-search`, Chat Completions request fields, tool payloads, or response
stream forwarding. The goal is bounded single-instance defense without adding a
database, Redis, accounts, or a misleading global quota claim.

### 2. Signatures

```ts
hostedChatRequestSchema.safeParse(value: unknown);

class HostedRequestGuard {
  tryAcquire(kind: "chat" | "web-search"): HostedRequestLease | null;
  loginRetryAfterSeconds(request: Request, authSecret: string): number | null;
  recordLoginFailure(request: Request, authSecret: string): number | null;
  recordLoginSuccess(request: Request, authSecret: string): void;
}

handleChatProxy(request, config, fetchImplementation?, requestGuard?);
handleHostedWebSearch(
  request,
  config,
  fetchImplementation?,
  timeoutMs?,
  requestGuard?,
);
```

### 3. Contracts

- Hosted Chat accepts only the wire fields emitted by CherryChat:
  `model`, `messages`, optional `stream`, `temperature`, `top_p`, `max_tokens`,
  `tools`, `tool_choice`, `thinking`, `enable_thinking`, and
  `reasoning_effort`. Assistant `reasoning_content` is the only additional
  message field. Every owning object is strict. BYOK keeps its
  OpenAI-compatible passthrough but cannot change the deployment-fixed target.
- AI SDK non-streaming requests may omit `stream`; Hosted normalizes that exact
  omission to `false` before forwarding. A present non-boolean value remains an
  invalid request.
- DeepSeek V4 Flash/Pro is matched from the model ID with the shared normalized
  model helper, never from hostname or deployment configuration. The accepted
  top-level shapes are exact: model default omits `thinking` and effort; Off
  sends disabled thinking and may include Temperature/Top P; an explicit level
  sends enabled thinking plus one reviewed effort and must omit sampling fields.
  Flash accepts Low/High/Max and Pro accepts High/Max.
- Reviewed GLM text models use the same normalized model-only decision. GLM
  default omits all control fields; Off sends only disabled thinking; explicit
  On/High/Max requires `thinking.enabled` and `clear_thinking:false`.
  Switch-style GLM forbids effort, while GLM-5.2 requires High or Max. Every GLM
  shape may keep valid Temperature and Top P.
- Reviewed Qwen models use the shared normalized matcher. Qwen3.8 Max default
  omits controls, Off sends only `enable_thinking:false`, and Low/Medium/XHigh
  sends only the exact effort; preview forbids Off. Other reviewed hybrid Qwen
  accepts only default or one boolean `enable_thinking` switch. Qwen keeps valid
  Temperature and Top P and never accepts `thinking_budget`.
- Kimi matching is limited to normalized `kimi-k3`. Default omits controls;
  Low/High/Max sends only the exact effort. Every Kimi shape rejects
  `enable_thinking`, `thinking`, Temperature, and Top P, and there is no Off
  state.
- Bounded non-empty Assistant `reasoning_content` is accepted only for matched
  DeepSeek V4, reviewed GLM, Qwen3.8, or Kimi K3. DeepSeek/GLM require Assistant
  tool-call history, and GLM also requires explicit retained thinking in the
  same request. Qwen3.8/Kimi accept bounded ordinary Assistant history. GPT,
  ordinary hybrid Qwen, and other models may keep their existing valid fields,
  but cannot borrow another family's control or Chat reasoning content.
- Hosted limits are 128 messages, 1 MiB characters per text field, 8 user
  content parts, 3 Base64 JPEG/PNG/WebP images per message, 16 tools, 16 tool
  calls per Assistant message, 128 KiB tool JSON, depth 16, 2048 JSON nodes,
  and `max_tokens` from 1 through 65536.
- One instance admits at most 8 active Hosted chats and 4 active Hosted
  searches. A Chat lease stays held until its response body completes, errors,
  or is cancelled; returning a `Response` is not completion.
- Five client failures in 60 seconds block that HMAC-derived client key for 60
  seconds. One hundred total failures in 60 seconds block new sign-ins on that
  instance for 60 seconds. The client map has at most 1024 entries.
- Access codes, Cookies, Authorization values, raw IP/User-Agent values, and
  their unhashed concatenations are never Map keys or log fields.
- Instance restarts and horizontal scaling reset or split this state. It is not
  a global rate limit, spending budget, or billing ledger.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Hosted unknown or oversized request field | `400 INVALID_REQUEST` before fetch |
| AI SDK omits `stream` for non-streaming generation | Normalize to `stream:false`, then forward |
| DeepSeek default or enabled thinking includes Temperature/Top P | `400 INVALID_REQUEST` before fetch |
| DeepSeek `thinking.enabled` omits effort, or disabled thinking includes effort | `400 INVALID_REQUEST` before fetch |
| DeepSeek Pro receives Low, or any V4 model receives Auto/Medium/XHigh | `400 INVALID_REQUEST` before fetch |
| DeepSeek reasoning content has no Assistant tool-call history or exceeds bounds | `400 INVALID_REQUEST` before fetch |
| GLM default includes an effort, or enabled thinking omits `clear_thinking:false` | `400 INVALID_REQUEST` before fetch |
| Switch-style GLM includes an effort, or GLM-5.2 enabled thinking is not High/Max | `400 INVALID_REQUEST` before fetch |
| GLM default/Off includes Assistant `reasoning_content` | `400 INVALID_REQUEST` before fetch |
| Qwen3.8 Max Off includes effort, or preview receives Off | `400 INVALID_REQUEST` before fetch |
| Qwen3.8 receives an unsupported effort or combines effort with `enable_thinking` | `400 INVALID_REQUEST` before fetch |
| Hybrid Qwen combines `enable_thinking` with effort/thinking or sends reasoning content | `400 INVALID_REQUEST` before fetch |
| Kimi K3 receives Off/On/Medium/XHigh, thinking, `enable_thinking`, Temperature, or Top P | `400 INVALID_REQUEST` before fetch |
| Qwen3.8/Kimi reasoning content exceeds bounds or crosses model ownership | `400 INVALID_REQUEST` before fetch |
| Non-reviewed model includes `thinking`, `enable_thinking`, or Assistant `reasoning_content` | `400 INVALID_REQUEST` before fetch |
| Hosted model outside `MODELS` | `403 MODEL_NOT_ALLOWED` before fetch |
| Chat/Search slot unavailable | `429 HOSTED_CONCURRENCY_LIMIT` |
| Login failure threshold reached | `429 AUTH_RATE_LIMITED` with `Retry-After` |
| Upstream failure before a stream | Release the Chat lease before returning |
| Stream completes, errors, or is cancelled | Release the Chat lease exactly once |
| BYOK provider extension field | Preserve it while forwarding to fixed `BASE_URL` |

### 5. Good / Base / Bad Cases

- **Good:** an AI SDK tool request and its Assistant/Tool continuation both
  pass the Hosted schema, while `providerContext`, `n`, target URLs, and extra
  credentials fail before fetch.
- **Good:** streaming and non-streaming DeepSeek V4 tool loops both pass; the
  latter arrives without `stream` and is normalized to explicit `false`.
- **Good:** GLM-5.2 High with retained tool history passes with sampling fields;
  GLM-4.7 On passes without an effort, and both remain on the fixed target.
- **Good:** Qwen3.8 XHigh passes with its own ordinary reasoning history;
  hybrid Qwen On passes with only `enable_thinking:true`, and Kimi High passes
  with its own ordinary reasoning history and no sampling fields.
- **Base:** DeepSeek model default omits control and sampling fields; GPT keeps
  its pre-existing `reasoning_effort` contract. GLM/Qwen default omits controls
  but keeps sampling preferences; Kimi default omits controls and sampling.
- **Base:** a normal Hosted text request uses one temporary Chat slot and
  releases it after `[DONE]`; a normal BYOK request preserves a provider
  extension.
- **Bad:** release the Chat slot as soon as the Route Handler returns the
  streaming `Response`, use an access code/Cookie as a Map key, or describe the
  process-local counters as deployment-wide cost control.
- **Bad:** allow `thinking.enabled` without an effort, allow sampling while
  DeepSeek thinking is default/enabled, or accept arbitrary provider metadata.
- **Bad:** accept GLM `reasoning_content` in default mode, infer a provider from
  `BASE_URL`, or silently strip an unsupported GLM field before forwarding.
- **Bad:** let arbitrary Qwen prefixes borrow `enable_thinking`, allow Kimi
  sampling, or accept one family's `reasoning_content` for another model.

### 6. Tests Required

- `hosted-chat-request.test.ts`: real text/image/reasoning/tool shapes, omitted
  non-streaming flag normalization, exact DeepSeek default/Off/effort matrices,
  exact GLM default/Off/On/High/Max matrices, provider isolation, sampling
  combinations, exact Qwen3.8/hybrid and Kimi matrices, ordinary reasoning
  history, unknown fields, aggregate limits, UTF-8 byte limits, and iterative
  JSON depth.
- `ai-sdk-openai-compatible-runtime.test.ts`: validate both the initial tool
  request and the Assistant/Tool continuation against the Hosted schema in
  streaming and non-streaming DeepSeek/GLM tool flows plus Qwen/Kimi ordinary
  and tool flows.
- `hosted-request-guard.test.ts`: idempotent leases, client/global windows,
  expiry, capacity eviction, success cleanup, and fixed-length HMAC keys.
- `upstream-proxy.test.ts`: fetch-before-reject assertions, BYOK passthrough,
  stream cancel/completion release, timeout release, allowlist, and redaction.
- `hosted-web-search.test.ts` and `routes.test.ts`: 429 contracts and release on
  success, upstream failure, timeout, and caller cancellation.
- Full coverage, production build, Chromium Hosted-default regression, and a
  synthetic high-entropy server-marker scan of `.next/static`.

### 7. Wrong vs Correct

```ts
// Wrong: one permissive schema lets Hosted callers add arbitrary cost fields.
const chatSchema = z.object(requiredFields).passthrough();

// Correct: Hosted is strict; BYOK owns the compatibility passthrough.
const parsed =
  mode === "hosted"
    ? hostedChatRequestSchema.safeParse(value)
    : byokChatRequestSchema.safeParse(value);

// Wrong: an SDK omission is treated as malformed even though OpenAI defines it
// as non-streaming.
const requiredStreamSchema = z.boolean();

// Correct: only omission is normalized; invalid present values still fail.
const hostedStreamSchema = z.boolean().optional().default(false);

// Wrong: one newly allowed field becomes valid for every Hosted model.
const enableThinking = z.boolean().optional();

// Correct: strict shape parsing is followed by the shared model-aware matrix;
// an unsupported field rejects before fetch instead of being stripped.
validateHostedChatModelFields(parsedRequest);

// Wrong: the request counter is released before the client consumes the stream.
const lease = guard.tryAcquire("chat");
return forwardUpstream(request).finally(() => lease?.release());

// Correct: transfer ownership and release from pipe completion/cancel/error.
const response = pipeUpstreamBody(upstream, () => lease?.release());
return response;
```

## Scenario: Vercel Deployment Input And Hosted Sign-In WAF

### 1. Scope / Trigger

Use this contract whenever changing direct Vercel CLI deployment input,
`.vercelignore`, Hosted sign-in client identification, or the project Firewall
rule for `POST /api/auth`. The goal is to keep local Secrets out of deployment
artifacts and provide a regional edge request budget in front of the
process-local failure-aware Guard.

### 2. Signatures

```text
.vercelignore:
  .env*
  !.env.example
  .vercel/
  node_modules/
  .next/

Vercel Firewall rule "Rate limit hosted sign-in":
  method eq POST
  path eq /api/auth
  key ip
  fixed_window 5 requests / 60 seconds
  exceeded action deny for 1 minute

deriveHostedLoginClientKey(request: Request, authSecret: string): string
```

### 3. Contracts

- Direct CLI deployment input must contain `.env.example` and must not contain
  `.env`, `.env.local`, `.env.*.local`, `.vercel/`, local build output, reports,
  or dependencies. `.gitignore` is not the Vercel upload contract.
- The application client key is HMAC-SHA-256 over the normalized first
  platform-provided client address only. User-Agent, access codes, Cookies, and
  raw addresses are not key material or log fields.
- The published Firewall rule matches only `POST /api/auth`, counts every
  matching request, uses the source IP as its key, and has no environment
  variable or application Secret.
- Firewall counters are regional. Shared NAT users share one request budget;
  rotating source IPs can evade it. The application failure Map remains
  process-local and neither layer is a user quota, billing ledger, or provider
  spending cap.
- Publishing is a project-level mutation. Before `firewall publish`, inspect
  the draft and stop unless the diff contains only the intended rule. Keep a
  tested disable-and-publish rollback command available.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Deployment source contains a real `.env*` file | Release blocked; do not deploy |
| Same address changes only User-Agent after four failures | Fifth failure returns application `429 AUTH_RATE_LIMITED` |
| First five malformed matching POST requests | Application `400 INVALID_REQUEST` |
| Sixth request in the same WAF window | Vercel mitigation before the Function; currently `403` with `x-vercel-mitigated: deny` |
| `GET /api/config` or `DELETE /api/auth` during mitigation | Not matched by this rule |
| Firewall diff contains an unrelated draft | Do not publish any draft |

The provider-owned WAF status/body is operational evidence, not a stable
CherryChat JSON error contract. Assert the mitigation header and the absence of
the sixth request from Function logs instead of mapping it to an application
error code.

### 5. Good / Base / Bad Cases

- **Good:** a direct CLI Preview uploads `.env.example` only; five malformed
  sign-in POSTs reach the Route Handler and the sixth is denied at the edge.
- **Base:** local development has no Vercel WAF and relies on the bounded
  process-local Guard while preserving the same auth response contracts.
- **Bad:** rely on `.gitignore`, include User-Agent in the HMAC client key,
  describe the rule as globally consistent, or publish while another draft is
  pending.

### 6. Tests Required

- Unit: same address with different User-Agent values derives the same
  fixed-length HMAC key; different `AUTH_SECRET` values derive different keys.
- Route: changing User-Agent does not reset the five-failure budget, and the
  response remains `429 AUTH_RATE_LIMITED` with `Retry-After` and no credential
  echo.
- Deployment: inspect the uploaded source file list and assert that only
  `.env.example` is present among environment files.
- Firewall: `rules inspect` must show the exact method/path/IP/fixed-window
  configuration and `firewall diff` must be empty after publishing.
- Live Preview: send malformed JSON so the application failure bucket is not
  incremented; assert five `400` responses, then provider mitigation, while
  `/api/config` and logout remain healthy. Scan logs for credential names,
  credential shapes, and the Automation Bypass value without printing them.

### 7. Wrong vs Correct

```gitignore
# Wrong: Git exclusion alone did not prevent direct CLI upload.
# .gitignore
.env

# Correct: Vercel source upload has its own explicit contract.
# .vercelignore
.env*
!.env.example
```

```typescript
// Wrong: a trivial User-Agent change creates a fresh failure bucket.
const material = `${clientAddress}\n${request.headers.get("user-agent")}`;

// Correct: normalize the platform address and HMAC only that stable boundary.
const address = normalizeHostedLoginAddress(rawPlatformAddress);
return createHmac("sha256", authSecret).update(address).digest("base64url");
```

## Scenario: Framework Transitive Security Override

### 1. Scope / Trigger

Use this contract when a safe Next.js patch still installs a production
PostCSS, Sharp, or other transitive version covered by an active advisory.

### 2. Signatures

`package.json` is the single executable contract:

```json
{
  "dependencies": { "next": "<exact-safe-version>" },
  "devDependencies": {
    "eslint-config-next": "<same-exact-version>",
    "postcss": "<exact-safe-version>"
  },
  "overrides": {
    "postcss": "$postcss",
    "sharp": "<reviewed-safe-version>"
  }
}
```

### 3. Contracts

- `next` and `eslint-config-next` use the same exact version.
- A direct package reused through `$package` is exact, so npm has one reviewed
  version source instead of an invalid nested copy.
- A semver-incompatible Sharp override is allowed only when the current Node
  engine, production build, and Next image optimizer probe all pass.
- Do not use `npm audit fix --force` or upgrade unrelated dependencies in the
  same change.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| `npm audit --omit=dev` reports the targeted node | Release blocked |
| `npm ls next postcss sharp --all` reports invalid/extraneous | Override rejected |
| Next and ESLint config versions differ | Version alignment failure |
| Production build fails | Override or framework patch rolled back |
| Next `optimizeImage` cannot process an in-memory image | Sharp override rejected |
| High-entropy server test markers appear in `.next/static` | Client secret leak; release blocked |

### 5. Good / Base / Bad Cases

- **Good:** the actual tree contains one safe PostCSS, the reviewed Sharp,
  production audit is zero, and build/image probes pass.
- **Base:** the framework patch already ships safe transitive versions; omit
  overrides and keep the dependency graph smaller.
- **Bad:** add an override because the advisory suggests it, but ignore an
  invalid npm tree or validate only `next build` without exercising Sharp.

### 6. Tests Required

- Direct `src/proxy.test.ts` coverage when the advisory affects Middleware or
  Proxy behavior, including nonce propagation and response security headers.
- `npm ls next postcss sharp --all` with exit code zero.
- `npm audit --omit=dev` with zero targeted production vulnerabilities.
- Full TypeScript, Vitest coverage, production build, and a real Chromium smoke
  test.
- Invoke Next's installed `optimizeImage` with an in-memory generated image and
  assert it returns non-empty encoded output.
- Rebuild with temporary high-entropy server-only markers and assert zero
  matches under `.next/static`; short real values are not reliable scan probes
  because they collide with minified application text.

### 7. Wrong vs Correct

```json
// Wrong: nested override leaves npm's installed tree invalid.
{
  "overrides": { "next": { "postcss": "8.5.25" } }
}

// Correct: one exact direct source is reused throughout the tree.
{
  "devDependencies": { "postcss": "8.5.25" },
  "overrides": { "postcss": "$postcss" }
}
```

## Scenario: Untrusted Pull Request CI

### 1. Scope / Trigger

Use this contract whenever adding or changing `.github/workflows/ci.yml`,
quality commands, Node/npm versions, GitHub Action dependencies, or any future
deployment workflow. Untrusted PR validation and credentialed deployment are
separate trust domains.

### 2. Signatures

```yaml
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 30
  browser:
    needs: quality
    strategy:
      matrix:
        project: [chromium, mobile-chrome]
```

Both jobs use Node 22, npm 11.9.0, and `npm ci`. The quality job runs repository
checks, production and complete dependency audits, the license query, and a
canary client-bundle scan. The browser matrix runs Chromium Desktop and Mobile
Chrome after quality succeeds.

### 3. Contracts

- Never use `pull_request_target` to check out or build a PR head.
- Validation declares only `contents: read`, sets
  `persist-credentials: false`, and does not reference Secrets, OIDC,
  environments, deployment tokens, Preview APIs, or write permissions.
- Every `uses:` dependency is pinned to a reviewed 40-character Commit SHA;
  retain the human-readable major-version comment beside it.
- Toolchain is Node 22 and exact npm 11.9.0, matching `engines` and
  `packageManager`. Dependencies come from `npm ci` and `package-lock.json`.
- Format, zero-warning Lint, strict TypeScript, Vitest coverage, production
  build, script regressions, the production license query, client-bundle scan,
  production audit, and complete dependency audit are sequential blocking
  steps. Do not add `continue-on-error` to a gate.
- Build with explicit non-production values for `OPENAI_API_KEY`, `ACCESS_CODE`,
  `AUTH_SECRET`, `TAVILY_API_KEY`, `TAVILY_BASE_URL`, `EXA_API_KEY`,
  `EXA_BASE_URL`, `GROK_API_KEY`, `GROK_RESPONSES_URL`, and `GROK_MODEL`, then
  scan only `.next/static` for all ten exact values. Missing canaries, a missing
  build directory, or any match fails; output contains only environment names
  and hit counts, never canary values.
- Browser validation is a separate job that depends on quality and runs
  `chromium` plus `mobile-chrome`. It uses the same toolchain, owns no Secrets,
  and uses single-worker execution with bounded retries. Local development uses
  bounded workers for affected browser behavior; the complete CI matrix is the
  final repository regression gate.
- Disable Next telemetry. CI validates only; deployment belongs in a separate
  trusted workflow if introduced later.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| External PR | Run read-only validation without Secrets |
| Push to `main` | Run the same validation job |
| `pull_request_target` appears | Security review fails |
| Action uses a tag instead of a full SHA | Supply-chain review fails |
| Checkout persists credentials | Security review fails |
| Canary is empty or `.next/static` is missing | Bundle scan fails closed |
| Configured canary appears in a client file | Fail with name/count only |
| Complete or production dependency audit finds a vulnerability | Quality job fails |
| Chromium Desktop or Mobile Chrome fails | Browser matrix fails |
| Any quality command exits nonzero | Job fails and blocks completion |
| A deployment token or step enters CI | Split it into a trusted workflow |

### 5. Good / Base / Bad Cases

- **Good:** a fork PR installs and executes its code with no repository write
  token or deployment Secret, scans non-production canaries after build, and
  runs both browser projects only after quality passes.
- **Base:** a push to `main` runs the identical job and benefits from the npm
  cache without uploading artifacts; complete and production audits both report
  zero vulnerabilities.
- **Bad:** use `pull_request_target`, check out `github.event.pull_request.head.sha`,
  and run `npm ci` or `next build` while Vercel Secrets are available.
- **Bad:** scan environment variable names instead of exact high-entropy values,
  print a matched value, or let the browser job reference deployment Secrets.

### 6. Tests Required

- Parse the workflow as YAML and run Prettier over it.
- Assert the raw workflow contains no `pull_request_target`, `secrets.*`, OIDC,
  deployment permission, or write permission.
- Assert exactly the expected Action references are pinned to 40-character
  SHAs and Checkout disables credential persistence.
- Run `npm ci --dry-run` locally, then format, Lint, TypeScript, coverage,
  production build, `npm audit --omit=dev`, and complete `npm audit` on the same
  source revision.
- Run the scanner CLI against clean, matched, missing-canary, and missing-build
  fixtures. The matched fixture exits nonzero and its combined output does not
  contain the canary value.
- Run `npm run licenses:list` on Windows and let the same package script run on
  Linux CI. Run the target reload regression three times, then the complete
  single-worker Chromium and Mobile Chrome matrix.
- GitHub-hosted execution remains the final Linux/Actions-runtime proof after
  the workflow is pushed; local Windows validation is not a substitute for the
  remote run.

### 7. Wrong vs Correct

```yaml
# Wrong: privileged event plus mutable Action tag and deployment Secret.
on: pull_request_target
steps:
  - uses: actions/checkout@v4
  - run: npm ci && npm run build
    env:
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}

# Correct: unprivileged event, read-only token, pinned Action, no Secrets.
on:
  pull_request:
permissions:
  contents: read
steps:
  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
    with:
      persist-credentials: false
```

## Scenario: Hosted Session And Upstream Response Boundaries

### 1. Scope / Trigger

Use this contract when changing access-code authentication, signed Sessions,
Hosted upstream URLs, model-list/native JSON readers, or OpenAI-compatible SSE
inspection. These paths must remain stateless and bounded without Redis or a
server database.

### 2. Signatures

```ts
interface SessionPayload {
  version: 2;
  expiresAt: number;
  codeId: string;
}

authenticateAccessCode(candidate, hosted): string | null;
verifySessionToken(token, hosted): boolean;
readLimitedResponseJson(response, maximumBytes, signal?): Promise<unknown>;
validateChatCompletionStream(response, limits?): Response;
```

### 3. Contracts

- `codeId` is base64url HMAC-SHA-256 over purpose `access-code-id` plus the
  normalized code. Tokens never contain the access code or a reversible form.
- Session verification accepts only the exact v2 payload and checks `codeId`
  against every currently active code. Removing code A invalidates only A's
  Sessions; v1 and unknown versions fail closed.
- Production Hosted `BASE_URL` and every configured search Provider URL require
  HTTPS. Outside production, `ALLOW_INSECURE_LOCAL_UPSTREAM=true` allows HTTP
  only for localhost, `.localhost`, IPv4 127/8, or IPv6 loopback.
- Error bodies are 64 KiB, model lists are 4 MiB and 2,000 items, and native
  JSON is 16 MiB. Limit failures cancel the Reader and map to stable safe errors.
- Chat Completions SSE limits are 64 MiB total, 1 MiB per line, 2 MiB per
  event, 256 data lines per event, and 100,000 events. Fragmented-line byte
  accounting is incremental O(n); never re-encode the full accumulated line for
  every network chunk.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| v1, expired, tampered, or removed-code Session | `401 UNAUTHORIZED` |
| Production Hosted HTTP upstream | `CONFIGURATION_ERROR` |
| Dev HTTP private IP or ordinary hostname | `CONFIGURATION_ERROR` |
| Content-Length or streamed bytes exceed a reader limit | Cancel Reader; `STREAM_PROTOCOL_ERROR` |
| SSE line/event/count/UTF-8 violation | Cancel upstream stream; `STREAM_PROTOCOL_ERROR` |
| Normal stream ends without a terminal event | Append the safe truncated terminal event |

### 5. Good / Base / Bad Cases

- Good: codes A and B sign in; removing A leaves B authenticated.
- Base: a normal HTTPS Hosted deployment and ordinary model list use the shared
  readers without changing response behavior.
- Bad: keep accepting v1, allow a client-selected HTTP target, call
  `response.json()` on an unbounded model list, or measure a fragmented line by
  encoding the whole accumulated string after every chunk.

### 6. Tests Required

- Auth/routes: A/B revocation, v1 rejection, expiry, tampering, strict fields,
  and absence of the normalized code in the Token/error.
- Config: production HTTPS plus explicit dev loopback coverage for OpenAI,
  Tavily, Exa, and Grok; reject credentials, query, fragment, private IP, and
  production flag bypass.
- Reader/provider: Content-Length and streamed overflow, invalid UTF-8, model
  count, every SSE dimension, observable Reader cancellation, normal terminal
  compatibility, and highly fragmented line input with bounded encode calls.
- Full coverage, production build, production audit, and high-entropy
  server-marker scan under `.next/static`.

### 7. Wrong vs Correct

```ts
// Wrong: one old token stays valid after its access code is removed.
return verifySignature(token, authSecret);

// Correct: signature, strict v2 payload, expiry, and active codeId all pass.
return verifySessionToken(token, { authSecret, accessCodes });

// Wrong: repeated full-buffer encoding makes tiny chunks quadratic.
lineBytes = encoder.encode(accumulatedLine).byteLength;

// Correct: count each raw byte once and reset at LF boundaries.
trackLineBytes(chunk);
```

## Scenario: Manual GitHub Stable Release Workflow

### 1. Scope / Trigger

Use this contract when changing `scripts/release.mjs`,
`scripts/release.test.mjs`, `.github/workflows/release.yml`, the release
Changelog, or the version/release policy. Release publication is a trusted
default-branch operation and must remain separate from untrusted PR CI.

### 2. Signatures

```ts
validatePackageVersions({
  packageVersion,
  lockVersion,
  lockRootVersion,
}): { version: string; tagName: string };
extractChangelogSection(content, version): string;
waitForSuccessfulCi({
  getWorkflowRuns,
  sha,
  timeoutMs?,
  pollIntervalMs?,
  now?,
  sleep?,
}): Promise<WorkflowRun>;
createReleaseWithRecovery({ createRelease, readState, expectedSha }): Promise<{
  release: unknown;
  recovered: boolean;
}>;
```

The executable entry point is `node scripts/release.mjs`; it accepts no
command-line overrides and reads only GitHub Actions context variables.

### 3. Contracts

- `.github/workflows/release.yml` declares only `workflow_dispatch`, runs on
  the default branch, and uses the trigger's `GITHUB_SHA` as the immutable
  target. It must not accept a user-selected version or SHA.
- The workflow has only `actions: read` and `contents: write`, uses a fixed
  repository-level concurrency lock with `cancel-in-progress: false`, pins
  checkout/setup-node to reviewed 40-character SHAs, and sets
  `persist-credentials: false`.
- `package.json`, root `package-lock.json`, and its `packages[""].version`
  must contain the same stable three-part SemVer. The release Tag is
  `v${version}` and the title is `CherryChat v${version}`.
- The current English and Chinese Changelog sections must exist and contain
  structured `###` notes. The body includes the English section, target SHA,
  same-tag Chinese Changelog link, and GitHub-generated notes.
- Before the single Create Release request, the script rejects any existing
  Tag or Release and waits for the exact SHA's `CI` push run to conclude with
  `success`. The request uses `draft: false`, `prerelease: false`, and
  `make_latest: "true"`; GitHub creates the Tag at the locked SHA.
- API errors are reduced to method/status messages. Never print the token,
  Authorization header, or response body. Public Tags are immutable; later
  fixes use a new patch version.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Local execution or non-default branch | Stop before any GitHub write |
| Package/lock versions differ, invalid SemVer, or Changelog section missing | Stop before any GitHub write |
| Target Tag or Release already exists | Stop before CI wait and Create Release |
| Exact `CI` push run is queued/in progress | Poll until success or timeout |
| Exact run fails, cancels, times out, or stays missing | Stop without creating Tag/Release |
| Generate-notes fails or returns no body | Stop before Create Release |
| Create response is ambiguous and matching Tag plus Release exist | Treat as recovered success |
| No objects exist after ambiguous Create response | Fail and allow a later retry |
| Only one object exists or Tag points elsewhere | Fail and require manual review |

### 5. Good / Base / Bad Cases

- **Good:** an approved `main` workflow reads matching `1.0.0` metadata,
  reuses successful CI for the exact SHA, creates one ordinary non-prerelease
  Latest Release, and verifies the Tag and public URL.
- **Base:** a local `node scripts/release.mjs` invocation is rejected safely;
  local tests exercise pure logic and mocked API state without remote writes.
- **Bad:** accept arbitrary SHA input, publish from a feature branch, rerun
  the full quality suite with deployment credentials, move an existing Tag,
  or expose GitHub API response details in logs.

### 6. Tests Required

- Unit tests must cover matching/mismatched versions, stable SemVer rejection,
  structured Changelog extraction, body/payload composition, and exact
  push-SHA CI selection across queued, running, success, failure, cancel, and
  timeout states.
- API tests must cover absent/pre-existing/inconsistent Tag and Release state,
  one Create request, ambiguous-response recovery, retry-safe absence, and
  manual-review mismatch. Assert error messages contain no token or response
  body.
- Workflow contract tests must assert manual-only triggering, no inputs,
  least-privilege permissions, serialized concurrency, default-branch check,
  pinned Actions, disabled credential persistence, and the script entry point.
- Before merging, run `npm run test:scripts`, `npm run format:check`,
  `npm run docs:check`, the full repository quality gates, and `git diff --check`.

### 7. Wrong vs Correct

```yaml
# Wrong: caller-controlled target and mutable publishing Action.
on:
  workflow_dispatch:
    inputs:
      sha:
        required: true
steps:
  - uses: some/publish-action@v1

# Correct: lock the trigger SHA and let the reviewed script validate metadata.
on:
  workflow_dispatch:
steps:
  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
    with:
      ref: ${{ github.sha }}
      persist-credentials: false
  - run: node scripts/release.mjs
```

## Scenario: OpenAI-Compatible Image Generation

### 1. Scope / Trigger

Use this contract when changing image-generation environment variables, the
Hosted image route, OpenAI-compatible image transport, generated attachments,
message snapshots, or backup/import behavior.

### 2. Signatures

```text
POST /api/image-generation
Content-Type: application/json | multipart/form-data

JSON: { profileId?, model, prompt, size, quality, output_format,
        output_compression?, n: 1 }
Multipart: profileId?, model, prompt, size, quality, output_format,
           output_compression?, n=1, ordered image[] fields

ImageGenerationTransport.generate(request, signal?)
ConversationRepository.completeImageGeneration(messageId, images)
selectImageGenerationProfile(profileId)
setImageGenerationParameters({ resolutionTier?, aspectRatio?, quality?,
                               outputFormat?, outputCompression? })
```

`ImageGenerationConfiguration` owns `profiles`, `defaultProfileId`, separate
BYOK/Hosted active Profile IDs, and per-Profile parameters. The durable
`image_generation` message part contains the immutable Profile/model identity,
resolved `size`, resolution tier, aspect ratio, quality, output format,
conditional compression, and ordered `referenceAttachmentIds`. Generated and
reference images are ordinary `AttachmentRecord` rows linked by
`messageAttachments`.

### 3. Contracts

- Composer mode is explicit: selecting a chat model never enters image mode,
  and selecting an image Profile never mutates the chat model, reasoning, or
  web-search state. A settings-page Profile picker is component-local editing
  state and must not call `selectImageGenerationProfile`; only the image
  composer changes the active runtime Profile.
- BYOK stores each Profile URL, Key, model, size mode, and recent parameters
  independently. Zero references use JSON generations; one through sixteen
  references use multipart edits with repeated ordered `image[]` fields.
- Hosted browsers call only same-origin `/api/image-generation`. The server
  resolves `profileId` from its allowlist and ignores the caller's model as a
  routing choice. `IMAGE_GENERATION_PROFILES` is a JSON array of
  `{ id, name, apiKey, generationUrl, editUrl, model, sizeMode }` and
  `IMAGE_GENERATION_DEFAULT_PROFILE` selects its default. The legacy Key/URL/
  edit URL/model quartet remains an all-or-none single-Profile input and cannot
  be combined with the JSON list. Optional timeout and request-byte env values
  remain server bounded.
- Public config exposes only safe Profile identity/capabilities, the default
  Profile ID, availability, timeout, and request-byte limit. It never exposes
  a deployment Key or upstream URL.
- `gpt-image-2` accepts resolved custom dimensions from the supported
  resolution-tier/aspect-ratio matrix; conservative legacy/unknown Profiles
  use fixed supported sizes. PNG never carries `output_compression`; JPEG and
  WebP may carry an integer from 0 through 100.
- Upstream `data[0].b64_json` is accepted directly. BYOK may download
  `data[0].url` with credentials omitted. Hosted accepts a URL only when its
  protocol and origin match the selected fixed upstream, rejects redirects,
  validates MIME/size, and converts the result to Base64 before returning it.
- Generated images become local blobs before message completion. The
  repository saves attachments, message links, status, and output `image_ref`
  parts in one transaction. Backup import remaps both output IDs and ordered
  snapshot reference IDs.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Partial image env quartet | `CONFIGURATION_ERROR` |
| Profile JSON combined with the legacy quartet | `CONFIGURATION_ERROR` |
| Invalid/duplicate Profile ID or missing default Profile | `CONFIGURATION_ERROR` |
| Image env quartet without Hosted access | `CONFIGURATION_ERROR` |
| Unsafe active upstream URL | `CONFIGURATION_ERROR` |
| Missing Session or cross-origin request | `401` / `403` before fetch |
| Hosted `profileId` is outside the allowlist | `400 INVALID_REQUEST` |
| Profile does not support the resolved size | `400 INVALID_REQUEST` |
| PNG request contains `output_compression` | `400 INVALID_REQUEST` |
| More than 16 references or invalid multipart | `400 INVALID_REQUEST` |
| Request exceeds configured byte limit | `413 INVALID_REQUEST` |
| Caller aborts | `499 ABORTED`; lease released |
| Image timeout | `504 REQUEST_TIMEOUT`; lease released |
| Oversized/invalid upstream response | `502 UPSTREAM_ERROR` |
| Hosted URL crosses origin or redirects | `502 UPSTREAM_ERROR` |
| Upstream detail contains a Key/Bearer token | Return only redacted detail |
| Attachment write or link fails | Roll back the whole completion transaction |

### 5. Good / Base / Bad Cases

- **Good:** `gpt-image-2 + 2K + 9:16 + WebP` resolves once, reaches the selected
  Profile with conditional compression, and survives reload/retry/backup with
  two references in their original order.
- **Base:** a prompt without references uses the default Profile, sends one JSON
  request, and persists one generated image returned as Base64 or a safe URL.
- **Bad:** infer composer mode from a model name, let the settings editor change
  the runtime Profile, accept a browser-supplied Hosted target/Key, expose an
  env URL/Key in `/api/config`, or persist only a short-lived remote image URL.

### 6. Tests Required

- Options/UI: explicit mode isolation, settings-editor/runtime Profile
  separation, `gpt-image-2` 1K/2K/4K ratios, legacy fixed-size fallback,
  conditional compression, and desktop/mobile overflow.
- Transport: exact Profile/format/compression JSON and multipart fields,
  ordered references, Base64, URL download, invalid/empty response, MIME/size,
  abort, and response limits.
- Server: multi-Profile env parsing/default validation, allowlist selection,
  fixed generation/edit targets, deployment model override, Session, Origin,
  byte/reference limits, timeout/cancel, safe URL download, redirect/cross-
  origin rejection, redaction, and lease release.
- Storage: transactional generated-output save, SHA-256 de-duplication,
  attachment reference cleanup, and backup round-trip with at least two ordered
  references, ID remapping, and complete `messageAttachments` links.
- Build security: set process-local canaries for all four image env values, run
  `npm run build`, then `npm run security:scan-client-bundle`.

### 7. Wrong vs Correct

```ts
// Wrong: the browser selects where the Hosted deployment sends its secret and
// silently changes mode because a model name looks image-capable.
await fetch("/api/image-generation", {
  body: JSON.stringify({ targetUrl, apiKey, model, prompt }),
});
setComposerMode(isImageModel(model) ? "image" : "chat");

// Correct: UI mode is explicit; the route resolves a validated allowlisted
// Profile and the browser sends only its ID plus strict generation parameters.
setComposerMode("image");
await fetch("/api/image-generation", {
  body: JSON.stringify({
    profileId,
    model,
    prompt,
    size,
    quality,
    output_format,
    n: 1,
  }),
});
```
