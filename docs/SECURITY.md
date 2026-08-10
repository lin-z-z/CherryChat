# Security policy and model

**English** · [简体中文](./SECURITY_CN.md)

[Documentation](./README.md) · [Deployment](./DEPLOYMENT.md) ·
[Data behavior](./DATA.md) · [Project home](../README.md)

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/lin-z-z/CherryChat/security/advisories/new).
Do not include vulnerability details, credentials, private conversations, or a
working exploit in a public Issue or Discussion.

Include the affected commit or deployment shape, a concise impact statement,
reproduction steps, and sanitized evidence. Use test-only credentials and remove
tokens, cookies, private domains, prompt content, and user data from screenshots
or logs.

CherryChat is currently a Beta project without a security response SLA
or bug bounty. Security fixes target the latest `main` state; older release
branches are not currently maintained. If GitHub Private Vulnerability
Reporting is unavailable, do not publish the details while the repository owner
enables the private channel.

## Threat model

CherryChat is a browser-local AI client with optional Vercel Route Handlers. It
does not claim to be an encrypted credential vault, multi-tenant account system,
global rate limiter, or billing platform.

Primary trust boundaries are:

1. The current browser profile and same-origin JavaScript.
2. The selected model/search provider for browser-direct BYOK traffic.
3. The CherryChat deployment and its environment for same-origin or Hosted
   traffic.
4. GitHub Actions and dependency installation for repository validation.

## Browser credentials and local data

BYOK API keys, access-code input, and optional personal Tavily credentials are
stored locally for convenience. They are not encrypted at rest by CherryChat.
A malicious extension, compromised dependency, injected same-origin script, or
person with access to the browser profile may read them.

Credentials are kept in separate connection records and are excluded from full
backups, chat export, search, printed output, and public configuration. Clearing
all local data removes CherryChat IndexedDB data, CherryChat-prefixed
localStorage records, in-memory previews, and the Hosted session cookie.

See [Data and backup behavior](./DATA.md) for exact deletion and export rules.

## Hosted access

Hosted access requires `OPENAI_API_KEY`, `ACCESS_CODE`, and `AUTH_SECRET`
together, plus a non-empty `MODELS` allowlist. Partial configuration fails
closed.

Access codes are normalized, bounded to 256 UTF-8 bytes, HMAC-SHA-256 digested,
and compared across every configured code with timing-safe comparison. Session
cookies contain an expiry and irreversible code identifier; they do not contain
the access code. Removing a code invalidates sessions created by that code, and
rotating `AUTH_SECRET` invalidates every session.

Authentication mutations require same-origin requests. On HTTPS/production,
the session cookie is HttpOnly, Secure, and SameSite Strict. Hosted model IDs
must belong to the deployment allowlist.

One running instance applies bounded login and concurrency guards. Vercel
Firewall can add a regional IP-based rule before the Function. Neither layer is
a globally consistent quota, per-user budget, or billing ledger. A public
Hosted deployment still needs an upstream spending limit and an abuse-response
plan.

## Network boundary

CherryChat has three relevant paths:

1. An absolute BYOK Base URL is called directly by the browser and requires
   provider CORS.
2. An empty OpenAI-compatible BYOK Base URL uses same-origin routes that can
   forward only to the validated deployment `BASE_URL`.
3. Hosted access uses the same fixed target with a server-side deployment key
   after signed-session validation.

The server does not accept an upstream target from query parameters, request
bodies, or target-host headers. Redirects are rejected. Hosted chat validates a
strict bounded request shape and model allowlist. Same-origin BYOK preserves
OpenAI-compatible extension fields but still cannot change the fixed target.

Hosted Tavily search is a separate same-origin POST route. It requires a valid
Hosted session, accepts only a bounded query and result count, and calls the
validated deployment `TAVILY_BASE_URL` with the deployment key. The browser
cannot supply a server target or credential for this route.

Production Hosted upstreams require HTTPS. The explicit insecure-local option
works only outside production and only for loopback hosts; it does not permit
LAN, private, metadata, or ordinary remote HTTP targets.

Do not add an arbitrary server-side URL fallback to solve browser CORS. The
minimum requirements for a future restricted proxy are documented in
[ROADMAP.md](./ROADMAP.md).

## Content boundary

- Raw model HTML, scripts, iframes, objects, embeds, forms, and inline event
  handlers are not executed by the Markdown renderer.
- Links use an explicit protocol policy and external targets use safe browser
  attributes.
- Remote Markdown images render a consent control before the browser loads the
  third-party URL, and the resulting request uses no referrer.
- Mermaid loads only for completed messages and uses strict security mode.
- Content Security Policy denies framing, objects, and untrusted scripts.
- Base64 image request data is not written into conversation text or application
  logs.

## Request and response limits

Server and browser transports bound request bodies, text, image data, tool
payloads, model-list responses, JSON completions, upstream error details, and
OpenAI-compatible SSE events. Timeouts and cancellation are propagated through
the transport. Exceeding a bound becomes a stable error rather than allowing
unbounded buffering.

Limits reduce accidental or opportunistic abuse; they do not replace provider
quotas or a deployment-wide budget.

## Logging and error handling

Application code must not log API keys, access codes, access-code digests,
`AUTH_SECRET`, Authorization or Cookie headers, request/response bodies, private
prompts, model output, Base64 images, or raw user-configured target URLs.

Public errors use stable codes and bounded/redacted details. Vercel log review
is still required before release because platform and deployment configuration
can change outside this repository. An empty or failed log query is not proof
that no sensitive data was emitted.

## CI and deployment boundary

The validation workflow runs on ordinary Pull Requests and pushes to `main`
with `contents: read`. Checkout credentials are not persisted. It installs
dependencies, runs repository quality gates, builds with synthetic canaries,
and scans the client bundle. It does not use deployment secrets, OIDC,
environments, Preview deployment, or production APIs.

Do not add deployment secrets to an untrusted Pull Request workflow or replace
this boundary with `pull_request_target`. A future deployment workflow must be
separate and trusted.

Direct Vercel CLI uploads are governed by `.vercelignore`, not by an assumption
that `.gitignore` is applied. Inspect the uploaded source-file list before
assigning a stable alias or domain.

## Operator checklist

- Keep Node, npm, Next.js, browser dependencies, and provider SDKs reviewed.
- Run both production-only and full dependency audits without force-fixing an
  incompatible dependency tree.
- Use synthetic secrets for bundle scans and test-only credentials for browser
  flows.
- Verify BYOK-only and Hosted configurations separately.
- Publish the Vercel Firewall rule and upstream spending limit separately from
  application deployment.
- Inspect `/api/config`, browser network paths, Function logs, and client bundle
  contents on a real Preview.
- Enable GitHub Private Vulnerability Reporting before the repository is
  announced publicly.

## Known limitations

- Browser-local credentials are readable by compromised same-origin code.
- Access codes are shared secrets, not individual accounts.
- Serverless process-local guards are not global quotas.
- An absolute browser-direct provider URL exposes the browser IP and request to
  that provider.
- Third-party OpenAI-compatible and Responses gateways can differ from the
  reviewed request and stream contracts.
- The project does not currently provide cloud backup, centralized audit,
  organization roles, or billing controls.
