# CherryChat documentation

[Project home](../README.md) · [Live demo](https://cherrychat-xi.vercel.app) ·
[简体中文入口](../README_CN.md) ·
[Contributing](../CONTRIBUTING.md) · [License](../LICENSE)

CherryChat is a lightweight, privacy-first, self-hostable web AI client for
individuals and small teams. The project is currently a Preview-stage MVP. This
directory contains the technical sources of truth that would make the main
README too dense.

## Start here

- [Deployment and connection modes](./DEPLOYMENT.md) — local setup, BYOK,
  Hosted access, environment variables, Vercel, and release checks.
- [Model and protocol compatibility](./MODEL_COMPATIBILITY.md) — endpoint
  routing, provider adapters, model-aware reasoning controls, and compatibility
  limits.
- [Security](./SECURITY.md) — credential boundaries, public deployment risks,
  content safety, and private vulnerability reporting.
- [Data and backup behavior](./DATA.md) — browser storage, deletion, Backup v2,
  import validation, and single-chat export.
- [Roadmap and deferred boundaries](./ROADMAP.md) — intentionally deferred
  product and security work.
- [Open-source licenses and attribution](../LICENSES.md) — notable dependency
  licenses and clean-room reference boundaries.

## Project maturity

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
- Detailed technical documentation is maintained in English as the single
  source of truth.
- Public statements must match current code and tests. Provider-specific claims
  are scoped to the reviewed endpoint and request format.
- Security vulnerabilities belong in
  [GitHub Security Advisories](https://github.com/lin-z-z/CherryChat/security/advisories/new),
  not public Issues.
- Historical internal audits and local Trellis task/session state are not part
  of the public documentation surface.
