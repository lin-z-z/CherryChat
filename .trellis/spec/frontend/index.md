# Frontend Development Guidelines

CherryChat is a Next.js App Router application with one client-side chat shell.
The frontend owns presentation, browser interaction, i18n, and orchestration of
the typed runtime and storage services. Protocol parsing and persistence rules do
not belong in React components.

## Guides

| Guide | Local responsibility |
| --- | --- |
| [Directory Structure](./directory-structure.md) | App, component, feature, runtime, and storage boundaries |
| [Component Guidelines](./component-guidelines.md) | React composition, local errors, styling, and accessibility |
| [Hook Guidelines](./hook-guidelines.md) | `useChatController` lifecycle and async ownership |
| [State Management](./state-management.md) | UI, runtime, persistent, and server-derived state |
| [Quality Guidelines](./quality-guidelines.md) | Required checks and regression coverage |
| [Type Safety](./type-safety.md) | Strict TypeScript and runtime validation boundaries |
| [Model Capability Adapters](./model-capability-adapters.md) | Model truth, endpoint intersection, reasoning choices, and wire serialization |
| [Tool Runtime](./tool-runtime.md) | Ordered tool messages, Tavily execution, cancellation, and safe errors |

## Pre-Development Checklist

1. Read the guide for every layer being changed.
2. Search `src/runtime/` and `src/storage/` before adding logic to a component.
3. Search `src/i18n/resources.ts` before adding visible text.
4. Identify whether an error belongs to a dialog/action or to the global chat
   runtime before choosing its state owner.

## Quality Check

During development, run related Vitest files and affected Playwright behavior.
Before a local commit, run format, zero-warning Lint, strict type-check, and the
current task's complete impact surface. Full coverage, build, audits, bundle
scan, and the Chromium/Mobile Chrome matrix belong to Push/PR/release, unless a
high-risk local change requires earlier escalation. A browser-facing bug fix
requires an assertion at the interaction boundary, not only a unit test of an
implementation detail.
