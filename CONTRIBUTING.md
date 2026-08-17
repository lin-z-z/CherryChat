# Contributing to CherryChat

[Project home](./README.md) · [Documentation](./docs/README.md) ·
[Security](./docs/SECURITY.md) · [License](./LICENSE)

Thank you for helping improve CherryChat. The project welcomes focused bug
fixes, tests, documentation improvements, compatibility evidence, and scoped
features that fit a lightweight, privacy-first, self-hostable web client.

## Before opening an Issue

- Search existing Issues for the same behavior.
- Confirm the problem against the latest `main` state when practical.
- Separate local behavior from a provider, gateway, Vercel, domain, or Firewall
  configuration problem.
- Remove API keys, access codes, cookies, private prompts, personal
  conversations, local paths, and private domains from all evidence.
- Report vulnerabilities privately through
  [GitHub Security Advisories](https://github.com/lin-z-z/CherryChat/security/advisories/new),
  not a public Issue.

## Development setup

The repository baseline is Node.js 22 and npm 11.9.0.

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. A BYOK-only local instance works without an
environment file. Use `.env.local` only for test values needed by a fixed
same-origin upstream or Hosted access, and never commit that file.

## Repository structure

- `src/app/` — Next.js entry points, Route Handlers, metadata, and global CSS.
- `src/components/` — renderable UI and component tests.
- `src/features/` — browser feature orchestration.
- `src/runtime/` — protocol, model, stream, tool, and transport logic.
- `src/server/` — deployment configuration, authentication, security, and fixed
  upstream routes.
- `src/storage/` — IndexedDB/localStorage repositories, backup, and export.
- `tests/e2e/` — cross-layer browser workflows.
- `docs/` — public technical documentation.
- `.trellis/spec/` and `.trellis/scripts/` — public project workflow and coding
  guidance.

Local Trellis tasks, journals, workspaces, runtime files, and session logs are
development state. Do not add `.trellis/tasks/`, `.trellis/workspace/`, local
agent logs, generated reports, or machine-specific metadata to a Pull Request.

## Change workflow

1. Read the relevant files under `.trellis/spec/` before changing a runtime
   layer.
2. Search for existing helpers, constants, and tests before adding a new one.
3. Keep protocol parsing, storage rules, and server security out of presentation
   components.
4. Add a regression assertion at the boundary where a user would observe the
   behavior.
5. Update both README languages when product positioning, setup, deployment, or
   public behavior changes.
6. Keep detailed deployment, security, data, and compatibility rules in their
   English source-of-truth documents.

## Quality checks

Run the checks relevant to your change. Before a broad Pull Request, run the
full repository gate:

```powershell
npm run docs:check
npm run format:check
npm run lint -- --max-warnings=0
npm run typecheck
npm run test:coverage
npm run test:scripts
npm run build
npx playwright test --project=chromium
npx playwright test --project=mobile-chrome
npm audit --omit=dev
npm audit
npm run security:scan-client-bundle
```

The client-bundle scan requires the synthetic environment values used by CI and
is normally run after the production build. Do not use real credentials as
canaries.

If a browser binary is missing, install only the required Playwright browser.
Do not report a browser project as passed unless it actually ran.

## Documentation and screenshots

Run the deterministic documentation checks after changing Markdown, repository
metadata, or public images:

```powershell
npm run docs:check
```

The README screenshots are generated from the current local application with
mocked model endpoints:

```powershell
npm run docs:screenshots
```

The script uses English, light theme, fictional data, and blocks unexpected
external requests. Review all four resulting files under `docs/images/`
visually before committing them. Do not commit Playwright reports, traces, test
screenshots, or temporary server output.

## Pull Requests

Keep a Pull Request narrow enough to review. The description should explain:

- The user problem and intended boundary.
- Important design or security decisions.
- Tests and commands that actually ran.
- Anything not verified, especially external providers or Vercel state.
- Documentation and translation updates required by the change.

Do not mix unrelated formatting, dependency, feature, and refactor work. Preserve
the user's existing working-tree changes and stage exact paths when the tree is
not clean.

## Commit and data hygiene

Never commit:

- `.env` files or real provider/search credentials.
- Access codes, `AUTH_SECRET`, cookies, or Authorization headers.
- Private conversation content or user attachments.
- Vercel linkage, production logs, deployment exports, or environment dumps.
- `node_modules`, `.next`, coverage, Playwright reports, test results, caches,
  or editor/system files.
- Local Trellis task, workspace, developer identity, runtime, or session state.

Use stable error codes and sanitized fixtures in tests. A credential-like test
value must be visibly synthetic and must never be copied from a real service.

## License

By contributing, you agree that your contribution may be distributed under the
repository's [MIT License](./LICENSE). Record any copied or adapted third-party
code and its license before submitting it; behavioral inspiration alone must not
be presented as copied implementation.
