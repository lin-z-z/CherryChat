# Frontend Directory Structure

## Ownership Map

```text
src/app/                 Next.js layouts, page, manifest, and global CSS
src/components/          Renderable UI and component tests
src/components/chat/     Chat and settings presentation modules
src/components/chat/settings-pages/
                         Settings page bodies driven entirely through props
src/features/chat/       Chat UI orchestration hook
src/i18n/                Language resolution and fixed UI resources
src/runtime/             Framework-independent chat, model, stream, and transport logic
src/storage/             Browser persistence ports and repositories
src/lib/                 Small presentation utilities
public/                  Static icons and other public assets
tests/e2e/               User-visible browser workflows
```

`src/app/page.tsx` remains a thin entry point that renders `ChatShell`.
`src/components/chat-shell.tsx` composes the UI but delegates protocol and data
operations to `useChatController`, `src/runtime/`, and `src/storage/`.

## Placement Rules

- Put a reusable visual renderer in `src/components/`; see
  `message-markdown.tsx`.
- Put feature orchestration that owns effects and service lifecycles in
  `src/features/<feature>/`; see `features/chat/use-chat-controller.ts`.
- Put deterministic protocol or model logic in `src/runtime/` with a colocated
  `*.test.ts`.
- Put IndexedDB/localStorage access behind `src/storage/` repositories. React
  components must not import Dexie tables.
- Put fixed user-visible strings in `src/i18n/resources.ts`, not in JSX.

Use kebab-case filenames and the `@/` alias for imports across directories.
Keep test fixtures next to the owned module for Vitest and in `tests/e2e/` for
cross-module browser behavior.

## Large Feature Decomposition

Keep `ChatShell`, `SettingsWorkspace`, and `useChatController` as the state and
lifecycle owners for their existing surfaces. Extract a module only when its
responsibility can be expressed through typed props or deterministic inputs:

- `settings-pages/` owns the six settings page bodies;
  `settings-layout.tsx` owns shared presentation controls;
  `model-settings-form.ts` and `settings-workspace-logic.ts` own component-local
  pure projections.
- `message-view.tsx`, `chat-search-dialog.tsx`, and `chat-print-view.tsx` own
  renderable chat subtrees. `chat-shell.tsx` still owns the controller instance,
  composer, scroll/follow behavior, and global dialog state.
- `chat-controller-projections.ts` owns feature-local deterministic projections.
  It must not import React, components, repositories, storage, or transports;
  `use-chat-controller.ts` remains the only Hook that writes chat state.

Dependency direction is root owner -> presentational child -> typed domain
values. A child module must not import its root owner to recover hidden state.
Preserve DOM classes, accessible names, translation keys, persistence timing,
and request behavior when moving code across these boundaries.

```tsx
// Wrong: a page recovers orchestration state through its parent module.
import { useSettingsState } from "./settings-workspace";

// Correct: the state owner passes the exact render and action contract.
<ModelServicePage draft={connectionDraft} onSave={saveConnection} />
```
