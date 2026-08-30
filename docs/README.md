# CherryChat documentation

**English** · [简体中文](./README_CN.md)

[Project home](../README.md) · [Live demo](https://cherrychat-xi.vercel.app) ·
[Contributing](../CONTRIBUTING.md) · [License](../LICENSE)

CherryChat is a lightweight, privacy-first, self-hostable web AI client for
individuals and small teams. Version `v1.2.0` makes Hosted access stateless by
validating its access code on every request, on top of the stable contracts
first established by `v1.1.0`. This directory contains
the technical sources of truth that would make the main README too dense.

## Start here

- [Deployment and connection modes](./DEPLOYMENT.md) — plain-language BYOK,
  Hosted access, and self-hosting definitions, plus local setup, environment
  variables, Vercel, and release checks.
- [Image generation](./IMAGE_GENERATION.md) — BYOK and Hosted setup, prompts,
  references, profiles, parameters, compatibility, security, and local data.
- [Model and protocol compatibility](./MODEL_COMPATIBILITY.md) — endpoint
  routing, provider adapters, model-aware reasoning controls, and compatibility
  limits.
- [Security](./SECURITY.md) — credential boundaries, public deployment risks,
  content safety, and private vulnerability reporting.
- [Data and backup behavior](./DATA.md) — browser storage, deletion, Backup v2,
  import validation, and single-chat export.
- [Roadmap and deferred boundaries](./ROADMAP.md) — intentionally deferred
  product and security work.
- [Release and version policy](./RELEASES.md) — stable-version compatibility, quality
  gates, manual release automation, and immutable public tags.
- [Changelog](../CHANGELOG.md) — tracked releases, capabilities, limitations,
  backup guidance, and deployment boundaries.
- [Open-source licenses and attribution](../LICENSES.md) — notable dependency
  licenses and clean-room reference boundaries.

## Project maturity

Version `v1.2.0` extends the documented stable product contracts with stateless
Hosted access validation and is protected by repository quality gates.
It does not promise long-term support, hosted service uptime, or an enterprise
service commitment.

The current repository has automated formatting, lint, strict TypeScript,
coverage, script regression, production build, dependency audit, client-bundle
secret scan, and Chromium/mobile browser gates. A local or CI pass does not
prove that a particular Vercel project, domain, Firewall rule, environment, or
upstream provider is configured correctly; those require separate deployment
verification.

CherryChat does not currently provide accounts, cloud synchronization,
organization roles, a global usage ledger, billing, or centralized audit. Do
not describe it as an enterprise collaboration platform until those boundaries
are deliberately designed and verified.

## Documentation policy

- `README.md` and `README_CN.md` are equivalent product entry points.
- Every formal document in this directory has an English baseline and a full
  Simplified Chinese counterpart. If the two differ, the English document is
  authoritative until the translation is corrected.
- Navigation, product boundaries, and security warnings must stay aligned
  across both languages.
- Public statements must match current code and tests. Provider-specific claims
  are scoped to the reviewed endpoint and request format.
- Security vulnerabilities belong in
  [GitHub Security Advisories](https://github.com/lin-z-z/CherryChat/security/advisories/new),
  not public Issues.
- Historical internal audits and local Trellis task/session state are not part
  of the public documentation surface.
