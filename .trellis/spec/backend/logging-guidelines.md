# Logging Guidelines

CherryChat currently has no application logging library and product code should
not add ad-hoc `console.log`/`console.debug`. Vercel request metadata and build
output are the normal operational evidence. ESLint permits only warning/error
console methods (`eslint.config.mjs`), and those still require the redaction
rules below.

## Safe Diagnostic Shape

If a future operational event must be logged, emit a small structured object with
a stable event name, route/operation, status or stable error code, and timing.
Log counts or byte sizes rather than content. A request/trace ID may be included
only when it is not a credential.

## Never Log

- `OPENAI_API_KEY`, BYOK keys, Authorization/Cookie headers, or session tokens.
- Access codes, normalized codes, HMAC digests, or `AUTH_SECRET`.
- Full request/response bodies, prompts, model replies, custom parameters, or
  Base64/blob image data.
- User-configured Base URLs when an error can be described by a stable code.
- Environment dumps or raw thrown errors that may embed any value above.

Use stable HTTP error codes for user diagnostics and redact upstream text with
the proxy's known secret values (`src/server/upstream-proxy.ts`). Production
verification scans Vercel log JSON as data and reports only record counts,
paths/statuses, and sensitive-pattern hit counts; an empty/failed log query is
not evidence of zero hits.
