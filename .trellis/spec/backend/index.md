# Backend Development Guidelines

CherryChat has no resident application server or server database. Its backend is
the set of Next.js Route Handlers and server helpers deployed as Vercel
Functions, plus the browser persistence layer that owns durable chat data.
The concrete boundaries are `src/app/api/`, `src/server/`, and `src/storage/`.

## Guides

| Guide | Local responsibility |
| --- | --- |
| [Directory Structure](./directory-structure.md) | Route, server, runtime, and storage boundaries |
| [Database Guidelines](./database-guidelines.md) | Dexie schema, transactions, migrations, and fallback |
| [Error Handling](./error-handling.md) | Stable error codes and safe HTTP responses |
| [Quality Guidelines](./quality-guidelines.md) | Security and verification requirements |
| [Logging Guidelines](./logging-guidelines.md) | Vercel-safe, credential-free diagnostics |

## Pre-Development Checklist

1. Read the guide matching the changed server/storage boundary.
2. Identify every secret and user-controlled value entering the flow.
3. Preserve the fixed upstream target; clients must not select a server proxy
   host through headers, query parameters, or request bodies.
4. Add tests for error status/code, redaction, cancellation, and transaction
   rollback where applicable.

## Quality Check

During development, run related unit/integration tests. A local commit adds
Lint, strict type-check, and every contract affected by the task. Full coverage,
production build, client-bundle scan, audits, and complete browser workflows run
before Push/PR/release or earlier for high-risk security, dependency, migration,
build, and test-infrastructure changes. Vercel behavior must be reported from a
real Preview separately from local Route Handler tests.
