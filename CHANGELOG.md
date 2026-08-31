# Changelog

**English** · [简体中文](./CHANGELOG_CN.md)

This file records tracked CherryChat releases. The English version is the
release-note baseline; the Simplified Chinese version must preserve the same
capabilities and limitations.

## [Unreleased]

## [1.2.1] - 2026-08-31

### Summary

`v1.2.1` is a patch release that fixes a Hosted authentication state defect: a
delayed request carrying a replaced access code could report the browser as
unauthenticated after a newer code had already been verified successfully.

### Fixed

- Hosted authentication state is now owned by the request that started it.
  Model refresh, chat generation, image generation, and automatic title
  requests each bind the authentication epoch that was current when they began,
  and only that epoch may report the browser as unauthenticated. A rejected
  code that arrives after a newer code was verified no longer clears the newer
  result.
- An automatic title request that receives a Hosted authentication error now
  updates authentication state. Previously the error was discarded, so a
  genuinely revoked access code produced no signal on that path. Title
  generation remains a silent non-critical enhancement and still reports no
  error of its own.
- Hosted image generation reads the access code and binds the epoch together,
  immediately before the request. Reference-image loading is asynchronous, so
  the previous ordering could pair one request with a code the user had since
  replaced and discard a genuine rejection.
- A Hosted authentication error that arrives after switching to BYOK no longer
  changes Hosted authentication state.
- Hosted web search treats only a Hosted-specific rejection as a failed access
  code. An origin `FORBIDDEN` and the deployment's own upstream `UNAUTHORIZED`
  still fail the search call without reporting the access code as invalid.

Authentication failures continue to preserve the locally stored access code so
it can be re-verified from settings. Upstream and BYOK 401, 429, 5xx, timeout,
and cancellation remain isolated from Hosted authentication state.

### Known limitations

- The automatic title path shares the same authentication projection as the
  other request paths but has no dedicated regression test; its behavior is
  covered indirectly through the model refresh and web search paths.
- Every limitation listed under `v1.2.0` still applies. This release changes no
  authentication protocol, request header, server configuration, or stored data.

### Upgrade and backup

This release adds no IndexedDB schema migration and no configuration change.
Local conversations, settings, and the stored access code are preserved, and no
deployment credential needs to be updated.

Because `v1.2.0` already ships the refresh prompt, a long-lived page can prompt
for its own update to this release.

## [1.2.0] - 2026-08-30

### Summary

`v1.2.0` makes Hosted authentication stateless and adds original-image previews
and downloads, on top of the browser-local, BYOK, Hosted access, search, image
generation, backup, and deployment contracts established by `v1.1.0`.

### Highlights

- Hosted access is validated on every request against the current `ACCESS_CODE`
  allowlist. The browser resubmits its stored code in the
  `X-CherryChat-Access-Code` header, so a still-valid code survives cookie
  expiry, redeploys, and host changes instead of depending on a 7-day session.
- A missing header reports `HOSTED_AUTH_REQUIRED` and a rejected code reports
  `ACCESS_CODE_INVALID`, both as HTTP 401, so Hosted authentication failures
  stay distinguishable from upstream and BYOK API key failures.
- Generated images open in an accessible original-size preview and can be saved
  as timestamped local downloads.
- The About page reports the running deployment version, and a long-lived page
  prompts for a refresh once a newer version is published; refreshing reloads
  only the document and keeps local conversations and settings.

### Changed

- Removed Hosted session issuance and verification. `POST /api/auth` only
  verifies a code for the settings page and returns a boolean; `DELETE
/api/auth` only clears the legacy `cherrychat_session` cookie left by earlier
  releases.
- **Revoking Hosted access is now an `ACCESS_CODE` change.** Removing or
  replacing a code takes effect on that code's next request. Rotating
  `AUTH_SECRET` no longer signs clients out; it changes only digest derivation
  and the rate-limit client fingerprint.
- The access code header is percent-encoded because HTTP headers cannot carry
  the non-ASCII codes the configuration allows. A malformed encoding counts as
  invalid rather than missing, so it cannot bypass throttling.
- A rejected code on any Hosted route now counts toward the same per-client and
  global failure window that protects explicit sign-in, and a throttled client
  receives HTTP 429 with `Retry-After`. `GET /api/config` is the exception: it
  never fails for authentication and reports `authenticated: false` while
  throttled, so a page still loads and the endpoint is not a brute-force oracle.
- Resubmitting an unchanged Hosted access code is allowed, so the settings
  dirty-state gate can no longer block re-verification.
- Fixed a startup ordering defect where a valid stored access code read as
  unauthenticated because `GET /api/config` was requested before the stored
  connection resolved.

### Known limitations

- The access code header is attached only to same-origin CherryChat routes and
  is never forwarded to an upstream model, search, or image service. It is a
  deployment-shared credential, not a per-user account: CherryChat still
  provides no accounts, cloud synchronization, global usage ledger, billing
  control, or hosted-service SLA.
- Authentication-failure and concurrency guards are process-local. On a
  serverless platform they are not a globally consistent quota. A public Hosted
  deployment still needs an upstream spending limit and an abuse-response plan.
- The refresh prompt compares only `major.minor.patch` and ignores prerelease
  metadata. It is checked when a page regains focus or visibility, not on a
  timer, so a page that never loses focus will not observe a new deployment.

### Upgrade and backup

This release does not add an IndexedDB schema migration, and local
conversations, settings, and the stored access code are preserved.

A browser still running a pre-`v1.2.0` bundle does not send the access code
header and will receive `HOSTED_AUTH_REQUIRED` on Hosted requests until it
reloads. Reloading is sufficient; the stored access code does not need to be
re-entered. Because the refresh prompt ships in this release, a page loaded
before it cannot display that prompt for itself. Deployment operators should
expect to reload any long-lived tab once after updating.

Create a full backup before updating an existing deployment or browser profile;
credentials remain intentionally excluded.

### Deployment and security

No new deployment credential is required, and existing `ACCESS_CODE` values
continue to work. Operators who previously relied on rotating `AUTH_SECRET` to
sign clients out must now remove or replace the shared `ACCESS_CODE`. Access
codes are normalized, bounded to 256 UTF-8 bytes, HMAC-SHA-256 digested, and
compared against every configured code with timing-safe comparison; they are not
written to responses, error details, or logs.

## [1.1.0] - 2026-08-18

### Summary

`v1.1.0` adds integrated image generation and reference-image editing to the
stable browser-local, BYOK, Hosted access, search, backup, and deployment
contracts established by `v1.0.0`.

### Highlights

- A dedicated image-generation mode with a built-in `gpt-image-2` BYOK
  connection and configurable resolution, aspect-ratio, quality, format, and
  compression controls.
- Generation from prompts or up to 16 ordered reference images through
  compatible OpenAI-style generation and edit endpoints.
- Deployment-owned Hosted image generation through one legacy configuration or
  an allowlisted set of server-side Profiles, without exposing upstream
  credentials or URLs to access-code users.
- Persisted generation snapshots, local generated-image attachments, Backup v2
  round trips, and JSON/Markdown export support for image-generation messages.

### Changed

- Simplified browser BYOK image settings to one service URL and API Key while
  keeping the model fixed to `gpt-image-2`; multiple Profiles remain a Hosted
  deployment capability.
- Normalized image service roots and `/v1` bases to the standard
  `/v1/images/generations` and `/v1/images/edits` endpoints, with bounded image
  responses and stricter Hosted URL validation.
- The About page now reads the application version from Package metadata and
  links to the repository; user-message presentation and inline editing were
  refined.
- Local development uses Webpack for more stable startup on Windows.

### Known limitations

- CherryChat does not include image-generation credits or a Provider service.
  BYOK users and deployment operators own Provider availability, cost, rate
  limits, and content-policy compliance.
- Browser-direct image generation requires Provider CORS. Compatibility
  depends on the configured service supporting the documented OpenAI-style
  endpoints and options; compatible services may implement only a subset.
- Generated images remain in the current browser and can materially increase
  IndexedDB and Backup v2 size. CherryChat still provides no account, cloud
  synchronization, global usage ledger, billing control, or hosted-service SLA.

### Upgrade and backup

This release does not add an IndexedDB schema migration. Backup v2 now
round-trips generated images and ordered reference relationships. Create a full
backup before updating an existing deployment or browser profile; credentials
remain intentionally excluded.

### Deployment and security

BYOK-only image generation requires no deployment credential. Hosted image
generation requires complete Hosted access configuration plus either one
legacy image configuration or an allowlisted Profile set. Before enabling it
for other users, independently verify the fixed upstream, spending limit,
Firewall policy, Function logs, and real generation/edit behavior; repository
CI cannot prove those deployment properties.

## [1.0.0] - 2026-08-12

### Summary

`v1.0.0` is the first stable release of CherryChat: a lightweight,
privacy-first, self-hostable web client for AI conversations. It stabilizes the
documented browser-local, BYOK, Hosted access, search, backup, and deployment
contracts while retaining the limitations listed below.

### Highlights

- Browser-local conversations, branching, attachments, assistants, local
  search, printing, and import/export workflows.
- BYOK connections for OpenAI Chat Completions, OpenAI Responses, native
  Anthropic, native Gemini, New API endpoint metadata, and generic
  OpenAI-compatible Chat endpoints.
- Model-aware reasoning controls, streaming answer/reasoning display, and image
  input.
- Tavily, Exa, and Grok web search. Grok defaults to `grok-4.5` and supports an
  operator-configured compatible URL, model, and optional X Search.
- Optional deployment-owned Hosted access through a fixed upstream, access
  codes, signed HttpOnly sessions, model and search-provider allowlists, and
  bounded server routes. Hosted users may choose among configured search
  providers without receiving provider credentials or server-only options.
- Backup v2 with validated import and credential-free exports.
- Formatting, documentation, lint, strict TypeScript, coverage, script,
  production-build, dependency-audit, client-secret-scan, and Chromium/mobile
  browser quality gates.

### Known limitations

- No accounts, cloud synchronization, organization roles, centralized audit,
  global usage ledger, billing controls, or enterprise support commitment.
- Browser-saved BYOK credentials are convenience storage, not an encrypted
  vault; conversations and settings remain local to the current browser.
- Hosted model access supports the deployment-fixed OpenAI-compatible Chat
  Completions path. Native providers, OpenAI Responses, and New API endpoint
  routing remain BYOK capabilities.
- Hosted search providers, credentials, URLs, Grok model, and X Search behavior
  are configured by the deployment operator. The browser can select only from
  the server allowlist.
- A passing repository CI run does not verify a specific Vercel domain,
  environment, Firewall rule, spending limit, or upstream provider.
- There is no security response SLA, bug bounty, long-term-support branch, or
  guaranteed maintenance window for older releases.

### Upgrade and backup

This release does not introduce a new data-schema migration. Before updating a
deployment or browser installation, create a full Backup v2 export and keep it
outside the browser profile. Backups and ordinary exports intentionally omit
API keys, access codes, cookies, and credential digests.

Read [Data and backup behavior](./docs/DATA.md) before importing into an existing
browser profile.

### Deployment and security

BYOK-only deployments do not require provider credentials in Vercel. Hosted
access requires the complete server-side configuration and operator-owned
Firewall and spending controls. A Vercel Production alias does not establish a
hosted-service uptime, security-response, or enterprise-support commitment.

Read the [deployment guide](./docs/DEPLOYMENT.md),
[security policy](./docs/SECURITY.md), and
[release policy](./docs/RELEASES.md) before publishing an instance or release.
