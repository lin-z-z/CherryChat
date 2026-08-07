<div align="center">
  <img src="./public/icon-192.png" alt="CherryChat logo" width="96" height="96" />
  <h1>CherryChat</h1>
  <p><strong>A lightweight, privacy-first, self-hostable web client for AI conversations.</strong></p>
  <p>Built for individuals and small teams that prefer browser-local data, Bring Your Own Key (BYOK) connections, and a simple Vercel deployment.</p>
  <p><strong>English</strong> · <a href="./README_CN.md">简体中文</a></p>
  <p>
    <a href="https://github.com/lin-z-z/CherryChat/actions/workflows/ci.yml"><img src="https://github.com/lin-z-z/CherryChat/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/status-Preview-f59e0b.svg" alt="Preview status" />
  </p>
</div>

> [!IMPORTANT]
> CherryChat is a Preview-stage MVP under active verification. It does not yet
> provide accounts, cloud sync, organization permissions, centralized audit, or
> billing controls. Review the [security](./docs/SECURITY.md) and
> [deployment](./docs/DEPLOYMENT.md) boundaries before sharing a hosted-key
> instance.

<p align="center">
  <a href="https://cherrychat-xi.vercel.app"><strong>Try the BYOK-only Demo</strong></a>
  ·
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flin-z-z%2FCherryChat"><strong>Deploy to Vercel</strong></a>
  ·
  <a href="./docs/README.md"><strong>Documentation</strong></a>
  ·
  <a href="./CONTRIBUTING.md"><strong>Contribute</strong></a>
</p>

Try the verified [public BYOK-only demo](https://cherrychat-xi.vercel.app). It
uses a stable Vercel Production alias but has no project-owned model, Hosted
access, or Tavily credential. Visitors configure their own provider in the
browser. The Vercel target does not change CherryChat's Preview-stage product
status.

![CherryChat desktop conversation](./docs/images/cherrychat-desktop.png)

## Why CherryChat

- **Privacy-first browser storage** — conversations, branches, attachments, and
  settings stay in the current browser. Backups exclude API keys, access codes,
  cookies, and credential digests.
- **Bring your own provider** — connect directly to supported APIs with your own
  key, or use a deployment-fixed same-origin proxy when browser CORS is not the
  right fit.
- **Small-team hosted access** — a Vercel deployment can protect one fixed
  OpenAI-compatible upstream with access codes and signed HttpOnly sessions.
- **Multiple protocol adapters** — OpenAI Chat Completions, OpenAI Responses,
  native Anthropic, native Gemini, New API endpoint metadata, and generic
  OpenAI-compatible chat endpoints.
- **Useful chat workflows** — streaming, reasoning display, image input, Tavily
  web search, message branches, local search, assistants, backup, import, export,
  print, and an installable Web App manifest.
- **English and Simplified Chinese** — the interface follows browser language on
  first use and keeps the selected language locally.

## BYOK, Hosted access, and self-hosting

These terms describe different responsibilities:

- **Bring Your Own Key (BYOK)** means each user enters an API key issued by
  their model provider. Provider usage is charged to that user's provider
  account; CherryChat does not supply model credit. The key is saved in the
  current browser for convenience and may be sent either directly to the
  provider or through the deployment's fixed same-origin route.
- **Hosted access** means the deployment operator configures a provider key in
  the server environment. Visitors enter a CherryChat access code instead of a
  provider API key. Requests use the operator's fixed model allowlist and
  provider account, so the operator owns the usage cost and abuse risk.
- **Self-hosting** only means running your own CherryChat deployment. It is not a
  credential mode: a self-hosted instance can be BYOK-only, Hosted access, or
  expose both choices.

Do not shorten **Hosted access** to **Host**: “host” may mean a server, domain,
or the act of deploying the application. See the
[plain-language comparison](./docs/DEPLOYMENT.md#terms-in-plain-language) for
the request paths and credential boundaries.

## Product tour

### Connection and model settings

Configure the API type, base URL, credential, discovered models, default model,
and model-aware controls from one settings workspace.

![CherryChat connection and model settings](./docs/images/cherrychat-settings.png)

### Responsive mobile workspace

The same browser-local conversation workspace adapts to a compact mobile layout.

![CherryChat mobile conversation](./docs/images/cherrychat-mobile.png)

## Connection modes

| Mode             | Credential owner    | Network path                                                                                                |
| ---------------- | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Browser BYOK     | The current browser | An absolute Base URL is called directly and requires provider CORS.                                         |
| Same-origin BYOK | The current browser | An empty Base URL uses `/api/models` and `/api/chat`, which can reach only the deployment-fixed `BASE_URL`. |
| Hosted access    | The deployment      | Signed-in visitors use the deployment key through the fixed OpenAI-compatible Chat Completions route.       |

Hosted access does not turn CherryChat into an arbitrary provider proxy. Native
Anthropic, Gemini, OpenAI Responses, and New API endpoint routing are BYOK
features; Hosted access remains on the deployment-fixed Chat Completions
adapter. See [Deployment and connection modes](./docs/DEPLOYMENT.md) for the
complete boundary.

## Quick start

Requirements: Node.js 22 or newer and npm 11.9.0.

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. A BYOK-only local instance works without an
environment file. Open **Settings → Model service**, choose an API type, enter
your credential and model, then save the connection.

Copy `.env.example` to `.env.local` only when testing a deployment-fixed
upstream or Hosted access. Never commit real API keys, access codes, or
`AUTH_SECRET` values.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flin-z-z%2FCherryChat)

A BYOK-only deployment needs no provider credential in Vercel. Hosted access
requires the complete `OPENAI_API_KEY`, `MODELS`, `ACCESS_CODE`, and
`AUTH_SECRET` configuration. Optional deployment-funded search additionally
uses `TAVILY_API_KEY`.

Before sharing a Hosted deployment, configure an upstream spending limit and a
Vercel Firewall rate-limit rule for `POST /api/auth`. CherryChat's process-local
guards are defense in depth, not a global quota or billing ledger.

Read the full [Vercel and environment guide](./docs/DEPLOYMENT.md) before
deploying. The checked-in `.vercelignore` is the source-upload boundary for
direct CLI deployments.

## Documentation

- [Documentation index](./docs/README.md)
- [Deployment and connection modes](./docs/DEPLOYMENT.md)
- [Model and protocol compatibility](./docs/MODEL_COMPATIBILITY.md)
- [Security model and vulnerability reporting](./docs/SECURITY.md)
- [Data storage, deletion, backup, and export](./docs/DATA.md)
- [Roadmap and deferred boundaries](./docs/ROADMAP.md)
- [Open-source licenses and attribution](./LICENSES.md)

## Security and data boundaries

- Browser-saved credentials are convenience storage, not an encrypted vault.
  Malicious same-origin JavaScript can read them.
- Custom absolute BYOK URLs are browser-direct. CherryChat does not silently
  reroute failed CORS requests through an arbitrary server proxy.
- Hosted credentials stay server-side, but public deployments still need
  firewall, upstream spending, dependency, and log review.
- Raw model HTML is not executed. Remote Markdown images require explicit user
  loading, and external links use safe browser attributes.
- Full backups and ordinary exports intentionally omit credentials.

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/lin-z-z/CherryChat/security/advisories/new),
not through a public Issue. Read the [security policy](./docs/SECURITY.md) before
including reproduction material.

## Contributing

Bug reports, focused feature proposals, documentation fixes, tests, and scoped
Pull Requests are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md), run
the documented quality commands, and remove credentials, private conversations,
logs, local workflow state, and generated reports before submitting changes.

## License

CherryChat is independently implemented and released under the
[MIT License](./LICENSE). Notable third-party dependencies and their licenses
are listed in [LICENSES.md](./LICENSES.md).
