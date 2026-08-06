# Backend Directory Structure

```text
src/app/api/*/route.ts       HTTP boundary adapters
src/server/config.ts         Environment parsing and public projection
src/server/auth.ts           Access-code HMAC and signed sessions
src/server/security.ts       Same-origin and bounded-body checks
src/server/http.ts           JSON/error response shape
src/server/hosted-session.ts Shared signed-session guard
src/server/upstream-proxy.ts Fixed-target OpenAI-compatible forwarding
src/server/hosted-web-search.ts Fixed-target authenticated Tavily execution
src/runtime/transport/       Browser transport and stable chat errors
src/storage/                 IndexedDB/localStorage repositories
```

Route Handlers remain thin: load validated configuration, call one server owner,
and map unexpected configuration failures to a generic safe response. The
reference routes are `src/app/api/chat/route.ts` and
`src/app/api/config/route.ts`.

Business rules belong in `src/server/` or deterministic `src/runtime/` modules,
not in `route.ts`. Browser storage rules belong in repositories, not Route
Handlers or React components. Tests are colocated with each server/storage owner;
cross-route behavior is covered by `src/server/routes.test.ts`.

Use kebab-case files, named exports for reusable helpers, and the `@/` alias
across directories. Do not add a generic proxy route or a second protocol parser
inside an endpoint.
