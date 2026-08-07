# Frontend Quality Guidelines

## Required Checks

```text
npm run format:check
npm run lint -- --max-warnings=0
npm run typecheck
npm run test:coverage
npx playwright test --project=chromium --project=mobile-chrome
npx playwright test --project=firefox --workers=1
npm run build
```

WebKit is part of the declared matrix but may only be reported as passed when its
Playwright browser is installed and actually run. Remote checks use
`PLAYWRIGHT_BASE_URL`; this workstation also requires
`PLAYWRIGHT_PROXY_SERVER` for external requests.

## Test Placement

- Pure runtime, repository, and renderer behavior: colocated Vitest files.
- Cross-layer user behavior, persistence, accessibility, and responsive layout:
  `tests/e2e/`.
- Every bug fix gets a regression assertion that would fail if the bug returned.
  For the settings auth error, the assertion scopes `role="alert"` to the dialog.

## Bilingual Public Documentation

- Every formal English document under `docs/` has a complete Simplified Chinese
  counterpart named `<NAME>_CN.md`. This includes the documentation index,
  deployment, model compatibility, security, data, and roadmap documents.
- Each document links to its language counterpart at the top. The English and
  Chinese root READMEs link to the matching-language documentation set.
- English is the correction baseline when translations disagree, but the Chinese
  document must preserve the same heading structure and public product, security,
  and deployment boundaries; it must not become a summary.
- `npm run docs:check` enforces file pairs, reciprocal language links, heading
  levels, a minimum translation-size guard, local links, screenshots, and private
  path exclusions. `npm run test:scripts` covers the failure cases.
- Exact comparison-project research belongs in ignored local Trellis task
  evidence. Public docs, runtime metadata, tests, and specs use contract-focused
  wording; required third-party license attribution remains in `LICENSES.md`.
- Public READMEs and the deployment pair define Bring Your Own Key (BYOK),
  Hosted access, and self-hosting in terms of credential owner, provider cost,
  request path, and visitor input. Never use `Host` as the connection-mode label,
  and never imply that self-hosting automatically means Hosted access.

## Forbidden Patterns

- `any`, `@ts-ignore`, unchecked external JSON, or broad ESLint suppression.
- Raw fixed UI strings in components.
- `console.log`/`console.debug` in product code.
- Model-generated raw HTML execution.
- Tests that only assert a mocked helper without exercising the behavior that the
  user reported.
- Browser-native methods such as `requestAnimationFrame`, `cancelAnimationFrame`,
  `fetch`, and observer methods must not be detached and later invoked as object
  fields. Wrap them through `globalThis` or bind the owning browser object, and
  add a browser-boundary regression; jsdom callbacks alone do not prove the
  receiver is valid in Chrome.
- Every shared settings primitive needs an interaction assertion for its
  accessible role and state. For Radix selects, cover trigger, option,
  keyboard opening, callback value, and disabled behavior.
- When fixed copy changes, update both language assertions and any renderer or
  E2E flow that reaches the changed surface; do not leave tests tied to removed
  developer terminology.

## Coverage Baseline Contract

`vitest.config.ts` enforces project-wide minimums of 80% statements/lines, 75%
branches, and 80% functions. It also protects orchestration boundaries that can
be hidden by the total: `src/proxy.ts` remains at 100% in all four dimensions;
`use-chat-controller.ts` stays at or above 40% statements/lines, 60% branches,
and 75% functions; `connection-controller.ts` stays at or above 90%
statements/lines, 75% branches, and 100% functions. Do not enable automatic
threshold updates. A threshold change requires a passing coverage run and one
CLI-only higher-threshold check that exits non-zero without rewriting config.

## Controlled Browser Request Synchronization

When a Playwright route handler waits on a test-owned release callback, first
assert that the request entered the handler before clicking Stop, aborting, or
calling the release callback. UI generation state can appear before a dynamic
runtime import reaches `page.route`; releasing an uninitialized no-op callback
leaves the intercepted request pending and can block the retry.

Use default Chromium worker concurrency for the final gate. Single-worker or
targeted repeats are diagnostic evidence only and cannot replace the full
concurrent project run.

An interaction that intentionally performs several full navigations or reloads
may use a local `test.slow()` after repeated default-concurrency evidence shows
that the scenario exceeds the shared test timeout. Keep every assertion, scope
the marker to that test, and still run the unchanged default-concurrency gate;
do not raise the global timeout or use `test.slow()` to hide an unresolved wait.

After `page.reload()`, persistence tests wait for the visible
`[data-settings-trigger]` to have the expected localized accessible name and to
be enabled before continuing. The `<html>` theme class can restore before the
chat controller finishes initialization, so it is not an application-ready
signal by itself.

Review local/remote evidence separately. A local mock pass is not evidence that a
Vercel environment variable, Function log, or browser network path is correct.
