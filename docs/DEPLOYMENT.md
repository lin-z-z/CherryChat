# Deployment and connection modes

**English** · [简体中文](./DEPLOYMENT_CN.md)

[Documentation](./README.md) · [Live demo](https://cherrychat-xi.vercel.app) ·
[Security](./SECURITY.md) ·
[Model compatibility](./MODEL_COMPATIBILITY.md) · [Project home](../README.md)

CherryChat runs as one Next.js application. A BYOK-only deployment does not
need Postgres, Redis, object storage, or a deployment-owned model credential.
Hosted access adds a fixed server-side OpenAI-compatible upstream protected by
access codes and signed browser sessions.

## Terms in plain language

**Bring Your Own Key (BYOK)** means the model-provider credential belongs to
the user. It does not mean free model access: the provider charges the account
that issued the key. CherryChat is the client that sends requests; it does not
create a provider account or grant model credit.

**Hosted access** is CherryChat's name for a different credential arrangement.
The deployment operator owns the provider key and stores it in the server
environment. A visitor supplies only a CherryChat access code. The operator's
provider account pays for successful upstream usage. This is shared access to a
fixed deployment, not an individual CherryChat account, team role, or billing
system.

**Self-hosting** answers where CherryChat runs, not who owns the provider key.
A self-hosted deployment can use either credential arrangement or expose both.
Do not shorten Hosted access to “Host”; that word can also mean the server,
domain, or deployment action.

| Mode             | Who supplies the provider key | Who pays the provider | What the visitor enters                   |
| ---------------- | ----------------------------- | --------------------- | ----------------------------------------- |
| Browser BYOK     | Each user                     | Each user's account   | API key, API type, Base URL, and model    |
| Same-origin BYOK | Each user                     | Each user's account   | API key and model; Base URL is left empty |
| Hosted access    | Deployment operator           | Operator's account    | CherryChat access code                    |
| Self-hosting     | Not a credential mode         | Depends on mode       | Means running the deployment yourself     |

In same-origin BYOK, the user's key passes through the CherryChat Route Handler
only for the deployment-fixed `BASE_URL`; it is not read from the deployment
environment as an operator-owned credential. The verified public Demo is
self-hosted on Vercel but BYOK-only, so it holds no project-owner model key.

## Choose a connection mode

### Browser BYOK

The user selects an API type and stores an API key, Base URL, and model in the
current browser.

- An absolute Base URL is called directly by the browser. The provider receives
  the user's key and must allow browser CORS.
- CherryChat does not silently retry a failed CORS request through a server
  proxy.
- OpenAI Responses, native Anthropic, native Gemini, New API endpoint routing,
  and custom OpenAI-compatible Chat connections are available through BYOK.
- Browser-saved credentials are convenience storage, not an encrypted vault.

### Same-origin BYOK

For an OpenAI-compatible Chat connection, leaving the Base URL empty sends
`/api/models` and `/api/chat` requests to the CherryChat origin. The server can
forward only to its validated deployment `BASE_URL`; the browser cannot provide
a target host through a header, query parameter, or request body.

The browser still owns and sends the BYOK key for this mode. This is a fixed
target proxy, not an arbitrary CORS relay.

### Hosted access

Hosted access requires a complete deployment configuration. A visitor enters an
access code and receives a signed HttpOnly cookie. The server then injects the
deployment-owned API key for requests to the fixed OpenAI-compatible Chat
Completions upstream.

Hosted access has these important limits:

- It always uses the fixed `/v1/models` and `/v1/chat/completions` server
  boundary.
- It does not route visitors to native Anthropic, native Gemini, OpenAI
  Responses, or arbitrary New API endpoint types.
- Hosted models must be present in the deployment `MODELS` allowlist.
- Removing one access code invalidates sessions created by that code. Rotating
  `AUTH_SECRET` invalidates every session.
- Process-local concurrency and login guards reset or split across serverless
  instances. They are not a global user quota, daily budget, or billing ledger.

## Local development

Requirements:

- Node.js 22 or newer
- npm 11.9.0

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. No environment file is required for a BYOK-only
local run.

Copy `.env.example` to `.env.local` only when you need to test same-origin BYOK,
Hosted access, or deployment-funded web search. Keep real values out of Git,
logs, screenshots, Issues, and browser test artifacts.

## Environment variables

| Variable                          | Required      | Purpose                                                                  |
| --------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `BASE_URL`                        | No            | Fixed OpenAI-compatible upstream; defaults to `https://api.openai.com`.  |
| `ALLOW_INSECURE_LOCAL_UPSTREAM`   | No            | Allows loopback HTTP outside production when exactly `true`.             |
| `OPENAI_API_KEY`                  | Hosted access | Deployment-owned upstream key.                                           |
| `MODELS`                          | Hosted access | Comma-separated hosted model allowlist.                                  |
| `DEFAULT_MODEL`                   | No            | Hosted default; must be in `MODELS`.                                     |
| `TITLE_MODEL`                     | No            | Deployment title model; must be in `MODELS`.                             |
| `ACCESS_CODE`                     | Hosted access | Comma-separated visitor codes, each at most 256 UTF-8 bytes.             |
| `AUTH_SECRET`                     | Hosted access | HMAC/session secret of at least 32 UTF-8 bytes.                          |
| `WEB_SEARCH_PROVIDER`             | No            | Fixed Hosted provider: `tavily`, `exa`, or `grok`; defaults to `tavily`. |
| `TAVILY_API_KEY`                  | No            | Deployment-funded Tavily key when that provider is selected.             |
| `TAVILY_BASE_URL`                 | No            | Hosted Tavily-compatible base; defaults to `https://api.tavily.com`.     |
| `EXA_API_KEY`                     | No            | Deployment-funded Exa key when that provider is selected.                |
| `EXA_BASE_URL`                    | No            | Hosted Exa-compatible base; defaults to `https://api.exa.ai`.            |
| `GROK_API_KEY`                    | No            | Deployment-funded xAI-compatible key when Grok is selected.              |
| `GROK_RESPONSES_URL`              | No            | Complete Grok Responses endpoint; defaults to xAI's official endpoint.   |
| `GROK_MODEL`                      | No            | Hosted Grok model; defaults to `grok-4.5`.                               |
| `GROK_X_SEARCH`                   | No            | Adds Grok's X Search tool when `true`; defaults to `false`.              |
| `DISABLE_BYOK`                    | No            | Exactly `true` exposes Hosted access only.                               |
| `MODEL_LIST_TIMEOUT_SECONDS`      | No            | Model-list limit; default 30 seconds.                                    |
| `CHAT_FIRST_BYTE_TIMEOUT_SECONDS` | No            | Wait for response headers; default 300 seconds.                          |
| `CHAT_IDLE_TIMEOUT_SECONDS`       | No            | Maximum idle time between body chunks; default 300 seconds.              |
| `CHAT_TOTAL_TIMEOUT_SECONDS`      | No            | Whole chat request limit; default 1800 seconds.                          |

`OPENAI_API_KEY`, `ACCESS_CODE`, and `AUTH_SECRET` must be configured together,
and Hosted access also requires at least one `MODELS` entry. Partial Hosted
configuration fails closed. `DISABLE_BYOK=true` also fails closed without that
complete configuration.

`ACCESS_CODE` values are normalized, trimmed, deduplicated, and bounded. Short
values remain accepted for compatibility, but a public deployment should use
long random values. Generate `AUTH_SECRET` independently; never reuse an API
key or access code.

Timeout values are whole seconds from `0` through `86400`. `0` disables only
that individual timer. The total timer does not reset while streaming; the idle
timer resets after each body chunk.

Production OpenAI, Tavily, Exa, and Grok upstreams must use HTTPS. The insecure-local
exception is limited to loopback hosts outside production; it does not allow LAN
or ordinary remote HTTP targets.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flin-z-z%2FCherryChat)

1. Import `https://github.com/lin-z-z/CherryChat` into Vercel.
2. Keep the deployment environment empty for BYOK-only, or add the complete
   Hosted variables for a shared fixed upstream.
3. Deploy to Preview first.
4. Inspect `/api/config`; it should contain only public feature flags, allowed
   model IDs, authentication state, and timeout policy.
5. Verify the browser network path for the selected connection mode.
6. Review the Vercel source-file list, Function logs, and client-bundle secret
   scan before assigning a production alias or custom domain.

Direct Vercel CLI uploads use the checked-in `.vercelignore`. It excludes local
environment files, `.vercel` linkage, Trellis/Agent tooling, dependencies,
build output, reports, caches, and logs while retaining `.env.example`.

## BYOK-only demo profile

The verified public demo is
[https://cherrychat-xi.vercel.app](https://cherrychat-xi.vercel.app). It uses a
stable Vercel Production alias while CherryChat remains a Beta product.
At the time of verification, the project had no environment variables and
`/api/config` reported BYOK enabled, Hosted access disabled, Hosted web search
disabled, and no deployment models.

A BYOK-only demo must not set:

- `OPENAI_API_KEY`
- `ACCESS_CODE`
- `AUTH_SECRET`
- `TAVILY_API_KEY`
- `EXA_API_KEY`
- `GROK_API_KEY`

This keeps the demo on user-funded BYOK paths and prevents anonymous visitors
from consuming project-owner model or search credit. The current Demo URL was
published only after the deployed source list, environment names,
`/api/config`, browser-local BYOK settings flow, and client bundle boundary had
been verified.

If the operator later adds Hosted variables or a custom domain, repeat the
Hosted release checklist and update the public Demo description. A deployment
with project-owned credentials is no longer BYOK-only even when BYOK remains
enabled.

## Public Hosted hardening

For a shared Hosted deployment:

1. Publish a Vercel Firewall rate-limit rule matching exactly
   `POST /api/auth`.
2. Use client IP, a fixed 60-second window, five matching requests, and a
   one-minute deny period as the starting repository recommendation.
3. Remember that regional counters and shared public IPs affect the result.
4. Set an upstream account spending limit; CherryChat does not provide a global
   spend ledger.
5. Use long random access codes and rotate `AUTH_SECRET` when every session must
   be revoked.
6. Review credential-free logs after authenticated traffic.

The application also applies best-effort per-instance login and concurrency
guards. Treat them as defense in depth only.

## Release checklists

### BYOK-only

- No deployment-owned OpenAI, Hosted access, or web-search credential is configured.
- `/api/config` reports BYOK enabled and Hosted access disabled.
- Direct provider requests go only to the user-selected absolute URL.
- Same-origin BYOK can reach only the deployment-fixed `BASE_URL`.
- Browser-saved credentials are absent from backups and generated client files.

### Hosted access

- The Hosted variable group is complete and model IDs are allowlisted.
- Wrong, correct, removed, and rotated access-code scenarios are verified.
- The session cookie is HttpOnly, SameSite Strict, and Secure on HTTPS.
- Vercel Firewall and upstream spending controls are published separately.
- Hosted chat and search never accept browser-selected server targets.
- `WEB_SEARCH_PROVIDER` fixes one of Tavily, Exa, or Grok; access-code users cannot
  override its key, URL, model, or X Search setting.
- Grok always supplies Web Search. X Search is separate, disabled by default, and
  may add xAI model/tool charges when enabled.
- Function logs and the client bundle contain no configured secret values.

Local tests cannot prove these Vercel settings. Record local, Preview, and
production evidence separately.
