# Roadmap and deferred boundaries

**English** · [简体中文](./ROADMAP_CN.md)

[Documentation](./README.md) · [Security](./SECURITY.md) ·
[Deployment](./DEPLOYMENT.md) · [Project home](../README.md)

## Restricted CORS proxy

The MVP deliberately does not proxy arbitrary BYOK Base URLs. If real usage
shows that browser CORS blocks important providers, a restricted proxy requires a
separate security review and must include, at minimum:

- An explicit deployment-managed HTTPS hostname allowlist.
- Only `/v1/models` GET and `/v1/chat/completions` POST operations.
- Rejection of URL credentials, non-standard ports, redirects, loopback,
  private, link-local, cloud-metadata, and non-public DNS results.
- DNS-rebinding defenses that validate the address used for the connection.
- Request/response size limits, timeouts, concurrency and cost controls,
  minimal redacted audit data, and an abuse-response plan.
- An explicit user choice before a browser-direct API Key is sent through the
  CherryChat deployment. There must be no silent fallback.

Do not extend the existing fixed-target route with a client URL parameter or an
`x-base-url` header.

## Other deferred work

- Accounts, cloud synchronization, teams, billing, and shared history.
- User-triggered visible conversation compaction and long-term memory.
- Voice, arbitrary plugins/MCP, general-purpose autonomous agents, and non-image
  file processing.
- Globally consistent or account-aware access-code quotas backed by shared
  application state; the current regional Vercel WAF and process-local Guard
  intentionally do not provide this.
- Multiple named BYOK connection profiles and cross-device credential handling.
- A custom production domain and any deployment-funded Hosted configuration,
  including verified Firewall, spending-limit, and operating notes.
- A maintained release/version policy beyond the latest `main` state.

Each item should enter a new requirements and security review rather than being
added as an untested switch in the current Chat Completions runtime.

OpenAI Chat Completions, OpenAI Responses, native Anthropic and Gemini
transports, and the bounded built-in Tavily web-search tool are current product
capabilities rather than deferred roadmap items.

## Product boundary

CherryChat currently targets individuals and small teams that want a focused,
self-hostable web client. Accounts, shared cloud state, organization controls,
central audit, and billing require a different trust and data model; they are
not implied by the current access-code feature.
