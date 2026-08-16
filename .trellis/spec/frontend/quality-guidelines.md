# Frontend Quality Guidelines

## Verification Tiers

### During Development

- Run `npm run test:related -- <changed-source-paths>` for the current code
  change. Use `test:node`, `test:indexeddb`, or `test:dom` when an environment
  group is the clearer boundary.
- Run only the affected Playwright spec or test title. Chat workflows are split
  into `e2e:chat-core`, `e2e:chat-models`, and `e2e:chat-data-tools`.
- Documentation-only changes run `docs:check` and `test:scripts`; they do not
  require browser regression unless they also change executable scripts or UI.

### Before A Local Commit

```text
npm run format:check
npm run lint -- --max-warnings=0
npm run typecheck
npm run test:related -- <all task-changed source paths>
npx playwright test <affected specs or grep> --project=chromium
```

The final local check covers the complete impact surface of the current task,
not only the latest edited file. Escalate to `test:coverage`, production build,
bundle scan, audits, and the full browser matrix when changing shared schemas,
security boundaries, persistence migrations, dependencies/lockfiles, test
infrastructure, build configuration, or other high-fan-out contracts.

### Before Push, PR, Or Release

The full repository gate remains authoritative in CI: formatting, docs, Lint,
TypeScript, Vitest coverage, script regressions, licenses, production build,
client-bundle canary scan, production and complete audits, then the Chromium and
Mobile Chrome matrix. A local release rehearsal uses one Playwright worker for
reproducibility. Firefox and WebKit are optional compatibility evidence and may
only be reported as passed when their browsers are installed and actually run.
Remote checks use `PLAYWRIGHT_BASE_URL`; this workstation also requires
`PLAYWRIGHT_PROXY_SERVER` for external requests.

## Test Placement

- Pure runtime, repository, and renderer behavior: colocated Vitest files.
- Cross-layer user behavior, persistence, accessibility, and responsive layout:
  `tests/e2e/`.
- Every bug fix gets a regression assertion that would fail if the bug returned.
  For the settings auth error, the assertion scopes `role="alert"` to the dialog.

## Test Retention Policy

- A test passing once is not a reason to remove it. Existing tests protect
  active contracts from later shared dependency, schema, and refactor changes.
- Remove a test only when its feature/contract is deleted, the same risk boundary
  has genuinely duplicate coverage, or a stronger test is documented as an
  equivalent replacement.
- A deletion identifies the removed contract or replacement test in the change
  description. Never lower coverage thresholds to justify deleting tests.

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

## Scenario: Tiered Test Verification

### 1. Scope / Trigger

Use this contract when adding or moving tests, changing `package.json` test
commands, editing Vitest/Playwright configuration, or choosing the verification
surface for development, commit, Push, PR, or release.

### 2. Signatures

```text
npm run test:related -- <changed-source-paths...>
npm run test:node -- [test-path]
npm run test:indexeddb -- [test-path]
npm run test:dom -- [test-path]
npm run test:coverage
npm run e2e:chat-core
npm run e2e:chat-models
npm run e2e:chat-data-tools
```

Vitest project names are `node`, `indexeddb`, and `dom`. The complete
Playwright gate keeps the `chromium` and `mobile-chrome` projects.

### 3. Contracts

- New tests default to the Node project. Add a test to `domTests` only when it
  uses React Testing Library, DOM globals, browser storage, or another jsdom
  boundary; keep this as an exact file allowlist rather than a directory glob.
- Storage tests use the IndexedDB project and `tests/setup-indexeddb.ts` unless
  they also need DOM globals. DOM tests use `tests/setup.ts`, which includes
  Testing Library matchers, Fake IndexedDB, and browser API stubs.
- `test:related` receives source paths explicitly and follows Vitest's static
  import graph. Configuration, shared type, lockfile, setup, and test-runner
  changes are not reliably bounded by that graph and upgrade to the complete
  affected project or `test:coverage`.
- Chat E2E files own the `core`, `models`, and `data-tools` behavior domains and
  reuse `tests/e2e/chat-test-helpers.ts`. Splitting a file may move tests and
  helpers but must preserve every title and assertion.
- Local Playwright uses four workers; CI uses one. Worker count changes runtime
  scheduling only and never reduce the Chromium/Mobile Chrome release matrix.
- Test deletion follows the retention policy above. A previously passing test
  remains active unless its contract is removed or an equivalent stronger test
  is named.

### 4. Validation & Error Matrix

| Condition | Required action |
| --- | --- |
| Pure logic test | Keep in `node`; no jsdom setup |
| Dexie/Fake IndexedDB only | Add to `indexeddb` |
| React, DOM, or browser storage | Add exact path to `domTests` |
| Test needs DOM and IndexedDB | Use `dom`; its setup provides both |
| Source paths map cleanly | Run `test:related` during development |
| Config/setup/lockfile or high-fan-out contract changes | Run complete coverage and affected E2E |
| E2E title/count differs after a split | Reject the split until parity is restored |
| Coverage falls below an existing threshold | Reject the change; do not lower the threshold |

### 5. Good / Base / Bad Cases

- **Good:** a pure TSX helper test reports the `node` project, while a component
  interaction test appears once in `dom`.
- **Base:** a narrow runtime change uses `test:related` and the affected E2E
  behavior during development, then the task's complete impact surface before
  commit.
- **Bad:** include all `src/components/**/*.test.tsx` in jsdom, treat a related
  run as proof for test-runner configuration, or delete old regressions merely
  because they passed previously.

### 6. Tests Required

- Run each Vitest project independently and assert that every selected file is
  assigned once to the intended project.
- Run a representative pure TSX test through `test:node` and confirm the output
  identifies the `node` project.
- Run `test:coverage` after project-membership changes; assert the complete file
  and test counts remain stable and every configured threshold passes.
- After E2E file moves, compare old/new titles and `playwright --list` counts,
  then run each affected Chromium domain plus the one-worker complete matrix.
- Keep CI workflow coverage, build, bundle scan, audit, Chromium, and Mobile
  Chrome jobs unchanged.

### 7. Wrong vs Correct

```ts
// Wrong: every component-directory TSX test pays for jsdom, including pure logic.
const domTests = ["src/components/**/*.test.tsx"];

// Correct: environment membership follows the APIs the test actually uses.
const domTests = [
  "src/components/chat/model-selector.test.tsx",
  "src/features/chat/use-chat-controller.test.tsx",
];
```

## Controlled Browser Request Synchronization

When a Playwright route handler waits on a test-owned release callback, first
assert that the request entered the handler before clicking Stop, aborting, or
calling the release callback. UI generation state can appear before a dynamic
runtime import reaches `page.route`; releasing an uninitialized no-op callback
leaves the intercepted request pending and can block the retry.

Local Playwright concurrency is bounded by `playwright.config.ts` to avoid
resource-contention failures. CI intentionally uses one worker and bounded
retries. Targeted runs prove only their affected behavior; the complete
Chromium/Mobile Chrome matrix remains the Push/PR/release gate. Maximum local
worker concurrency is not a separate correctness requirement.

An interaction that intentionally performs several full navigations or reloads
may use a local `test.slow()` after repeated bounded-concurrency evidence shows
that the scenario exceeds the shared test timeout. Keep every assertion, scope
the marker to that test, and still run the affected gate; do not raise the global
timeout or use `test.slow()` to hide an unresolved wait.

After `page.reload()`, persistence tests wait for the visible
`[data-settings-trigger]` to have the expected localized accessible name and to
be enabled before continuing. The `<html>` theme class can restore before the
chat controller finishes initialization, so it is not an application-ready
signal by itself.

Review local/remote evidence separately. A local mock pass is not evidence that a
Vercel environment variable, Function log, or browser network path is correct.

## Scenario: Chat Image Generation Interaction

### 1. Scope / Trigger

Use this contract when changing the composer image mode, image settings,
reference-image controls, generated-message rendering, retry, or cancellation.

### 2. Signatures

```ts
setComposerMode("chat" | "image");
saveImageGenerationSettings(settings);
addImageReferences(files);
addStoredImageReference(attachmentId);
reorderImageReferences(activeId, overId);
removeImageReference(attachmentId);
regenerateAssistant(assistantId);
stop();
```

### 3. Contracts

- Image mode owns a separate ordered draft of at most sixteen references;
  ordinary chat keeps its three-image attachment limit and state.
- Size and quality are explicit controls. Submit persists an
  `image_generation` snapshot before the request so retry/reload uses the
  original model, parameters, connection scope, and reference order.
- Generated output is displayed from local `image_ref` attachments. “Use as
  reference” reuses the existing attachment record and never copies its blob.
- BYOK settings expose URL/Key/model fields. Hosted shows server-derived
  capability only and never places deployment credentials or upstream URLs in
  React state.

### 4. Validation & Error Matrix

| Condition | UI behavior |
| --- | --- |
| Empty prompt or missing BYOK Key | Do not start; show localized action error |
| Reference count reaches 16 | Reject further additions without changing order |
| Generation active | Show Stop; prevent duplicate send |
| User stops | Persist `stopped`, create no child output attachment |
| Timeout/provider/invalid response | Persist stable error state and allow retry |
| Completed output | Render image/download/use-as-reference actions |

### 5. Good / Base / Bad Cases

- **Good:** reorder two references, send, reload, and retry; every projection
  uses the same reference order and saved parameters.
- **Base:** switch to image mode, enter a prompt, choose size/quality, and
  receive one local generated attachment.
- **Bad:** share `pendingAttachments` with chat, infer parameters from prompt
  text, retry from current global settings, or render a remote provider URL.

### 6. Tests Required

- Component: localized mode entry, BYOK/Hosted settings, size/quality, reference
  add/remove/reorder/count, busy/stop/error states, and use-as-reference.
- Hook integration: real controller plus Fake IndexedDB for settings save,
  stored references, URL/Base64 result persistence, timeout, cancellation,
  retry, and model-cache coexistence.
- Browser: desktop and Mobile Chrome composer layout, paste/drop/sort, reload,
  backup round-trip, and no regression to ordinary chat/search/attachments.
- DOM response fixtures that represent binary images use an `ArrayBuffer`.
  Passing a jsdom `Blob` directly to Node's `Response` can stringify it and
  create a false image-format failure.

### 7. Wrong vs Correct

```ts
// Wrong: retry follows transient settings and remote URLs remain durable.
generate({ ...currentImageSettings, references: currentDraft });

// Correct: retry reads the persisted message snapshot and output is a local
// attachment linked to that message.
generateFromSnapshot(imageGenerationPart);
```
