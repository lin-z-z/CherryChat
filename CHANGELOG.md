# Changelog

**English** · [简体中文](./CHANGELOG_CN.md)

This file records tracked CherryChat releases. The English version is the
release-note baseline; the Simplified Chinese version must preserve the same
capabilities and limitations.

## [0.1.0] - 2026-08-10

### Summary

`v0.1.0` is the first tracked Beta release of CherryChat: a lightweight,
privacy-first, self-hostable web client for AI conversations. Beta means the
documented workflows are usable and protected by automated quality gates; it
does not mean Stable or enterprise support.

### Highlights

- Browser-local conversations, branching, attachments, assistants, local
  search, printing, and import/export workflows.
- BYOK connections for OpenAI Chat Completions, OpenAI Responses, native
  Anthropic, native Gemini, New API endpoint metadata, and generic
  OpenAI-compatible Chat endpoints.
- Model-aware reasoning controls, streaming answer/reasoning display, image
  input, and bounded Tavily web search.
- Optional deployment-owned Hosted access through a fixed upstream, access
  codes, signed HttpOnly sessions, a model allowlist, and bounded server routes.
- Backup v2 with validated import and credential-free exports.
- Formatting, documentation, lint, strict TypeScript, coverage, script,
  production-build, dependency-audit, client-secret-scan, and Chromium/mobile
  browser quality gates.

### Known limitations

- No accounts, cloud synchronization, organization roles, centralized audit,
  global usage ledger, or billing controls.
- Browser-saved BYOK credentials are convenience storage, not an encrypted
  vault; conversations and settings remain local to the current browser.
- Hosted access supports the deployment-fixed OpenAI-compatible Chat
  Completions path. Native providers, OpenAI Responses, and New API endpoint
  routing remain BYOK capabilities.
- A passing repository CI run does not verify a specific Vercel domain,
  environment, Firewall rule, spending limit, or upstream provider.
- There is no security response SLA, bug bounty, or maintained older-release
  branch.

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
Firewall and spending controls. A Vercel Production alias does not change the
product's Beta status.

Read the [deployment guide](./docs/DEPLOYMENT.md),
[security policy](./docs/SECURITY.md), and
[release policy](./docs/RELEASES.md) before publishing an instance or release.
