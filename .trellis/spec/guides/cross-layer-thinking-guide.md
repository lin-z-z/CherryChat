# Cross-Layer Thinking Guide

> **Purpose**: Think through data flow across layers before implementing.

---

## The Problem

**Most bugs happen at layer boundaries**, not within layers.

Common cross-layer bugs:

- API returns format A, frontend expects format B
- Database stores X, service transforms to Y, but loses data
- Multiple layers implement the same logic differently

---

## Before Implementing Cross-Layer Features

### Step 1: Map the Data Flow

Draw out how data moves:

```
Source → Transform → Store → Retrieve → Transform → Display
```

For each arrow, ask:

- What format is the data in?
- What could go wrong?
- Who is responsible for validation?

### Step 2: Identify Boundaries

| Boundary              | Common Issues                     |
| --------------------- | --------------------------------- |
| API ↔ Service         | Type mismatches, missing fields   |
| Service ↔ Database    | Format conversions, null handling |
| Backend ↔ Frontend    | Serialization, date formats       |
| Component ↔ Component | Props shape changes               |

### Step 3: Define Contracts

For each boundary:

- What is the exact input format?
- What is the exact output format?
- What errors can occur?

---

## Common Cross-Layer Mistakes

### Mistake 1: Implicit Format Assumptions

**Bad**: Assuming date format without checking

**Good**: Explicit format conversion at boundaries

### Mistake 2: Scattered Validation

**Bad**: Validating the same thing in multiple layers

**Good**: Validate once at the entry point

### Mistake 3: Leaky Abstractions

**Bad**: Component knows about database schema

**Good**: Each layer only knows its neighbors

### Mistake 4: Every Consumer Parses The Same Payload

**Bad**: A command reads JSONL events and casts fields inline:

```typescript
const thread = (ev as { thread?: string }).thread;
const labels = (ev as { labels?: string[] }).labels;
```

This looks local, but it means every consumer owns a private version of the
event contract. The next field change will update one command and miss another.

**Good**: Decode once at the event boundary, then export typed projections:

```typescript
if (!isThreadEvent(ev)) return false;
return ev.thread === filter.thread;
```

**Rule**: For append-only logs, JSON streams, RPC payloads, or config files,
create one owner for:

- event / payload type definitions
- type guards and normalization from `unknown`
- metadata projections used by UI commands
- reducers that replay state from the source of truth

Rendering code may format fields, but it must not redefine the payload contract.

---

## Checklist for Cross-Layer Features

Before implementation:

- [ ] Mapped the complete data flow
- [ ] Identified all layer boundaries
- [ ] Defined format at each boundary
- [ ] Decided where validation happens

After implementation:

- [ ] Tested with edge cases (null, empty, invalid)
- [ ] Verified error handling at each boundary
- [ ] Checked data survives round-trip
- [ ] Checked that consumers import shared decoders / projections instead of
      casting payload fields locally
- [ ] Checked that derived state points back to the source event identifier
      (`seq`, `id`, `version`) instead of inventing a second cursor

### Optional-Field Round-Trip Probe

When a persisted record gains an optional field, trace the field through every
boundary, not only its schema:

```
store -> export -> validate -> remap -> bulkPut -> resolve
```

- [ ] Seed a non-default value and assert it survives export and import.
- [ ] Check every remapping object explicitly spreads or copies the field.
- [ ] For read-modify-write saves, preserve fields not owned by the current
      form instead of replacing the whole record with a partial projection.

### Persisted Default Evolution Probe

When a generated catalogue, built-in registry, or inferred default changes,
trace all three timelines instead of checking only the new resolver:

```text
current resolution -> future sparse writes -> historical persisted snapshots
```

- [ ] Identify whether older versions persisted resolved defaults as user data.
- [ ] Add a record-format version before the next automatic-default change.

### Compatible API Minimum-Payload Probe

When implementing a named-compatible provider or gateway, distinguish the
official API's full schema from the smaller contract proven by the reference
client:

- [ ] Compare URL construction, authentication, headers, and the exact request
      body against the current working reference implementation.
- [ ] Start with the smallest proven field set. Optional official fields need
      an explicit provider capability before entering a shared compatibility
      request.
- [ ] Assert the complete serialized body in a contract test; a permissive Mock
      that accepts any superset only proves the implementation agrees with itself.
- [ ] For multi-step tools, diff both the initial tool-definition request and
      the continuation request. A first step can pass while extra fields in the
      `assistant`/`tool` messages make only the second step fail.
- [ ] If provider metadata is required for continuation, exercise both streaming
      and non-streaming SDK paths. Middleware that rebuilds tool calls must copy
      metadata in `wrapStream` and `wrapGenerate`.
- [ ] For hidden state needed after reload, do not treat visible answer text as
      durability evidence. Checkpoint validated state before later tokens make
      the UI appear complete, then test an immediate browser reload.
- [ ] Check whether a model family emits tool calls in provider-specific text
      markup as well as native fields. If so, verify split chunks, malformed
      fallback, non-streaming responses, and IDs that stay unique across turns.
- [ ] Compare the model-facing tool result separately from the UI/storage
      envelope. A reference may send a compact array even when the local app
      stores query metadata around that array.
- [ ] Compare function-schema metadata such as `strict`, required fields,
      maximum lengths, and `additionalProperties`; a visually identical tool
      description is not an equivalent provider request.
- [ ] Trace credentials and billing source together with the active connection
      mode. A valid inactive Session or saved Key must not silently fund another
      mode unless the product contract explicitly allows it.
- [ ] When a working reference succeeds but this app gets 4xx/5xx, diff the
      requests before blaming the credential, URL, network, or upstream health.
- [ ] Use one different live request after the fix and record both the original
      stable error and the successful response without exposing credentials.

### Origin And Authentication Status Probe

When a state-changing same-origin route runs behind a framework or proxy, trace
the browser authority and the framework URL separately:

```text
address bar -> Origin + Host -> framework-normalized request.url -> route
            -> HTTP status -> controller error code -> localized message
```

- [ ] Require a valid `Origin`; compare it to the request URL and, when they
      differ, to the request URL protocol plus the validated HTTP `Host`.
- [ ] Do not trust request-body targets or forwarded host headers as origin
      overrides unless the deployment has an explicit trusted-proxy contract.
- [ ] Test `localhost`, `127.0.0.1`, and a public-host-shaped request where the
      framework URL is normalized.
- [ ] Preserve `401`, `403`, `404`, `429`, and `5xx` through the client error
      taxonomy. Do not collapse every non-2xx status into the most common user
      message.
- [ ] Reproduce the reported browser URL against a production build; a passing
      test on a different hostname is not evidence that the reported path works.

### Model Identity Alias Probe

When a provider returns a model ID that differs from the catalogue only by a
provider prefix or lifecycle suffix, trace identity through the whole path:

```text
provider model ID -> catalogue alias -> resolved capability
  -> persisted override -> settings form -> chat toolbar
```

- [ ] Prefer exact canonical and bare-name matches before derived aliases.
- [ ] Derive `*-preview[-variant]` aliases only when every candidate capability
      is identical; conflicting candidates must fall back conservatively.
- [ ] Re-evaluate legacy complete snapshots so old empty/default fields do not
      mask newly precise catalogue data.
- [ ] Test the exact provider-returned model name in both the resolver and a
      browser interaction that exposes the affected control.
- [ ] Define a lazy or database migration that removes only reconstructable old
      defaults and preserves genuine user differences.
- [ ] Preserve adjacent settings not owned by the migrated form.
- [ ] Seed a pre-upgrade record in an integration/browser test, reload the app,
      and assert both rendered values and the rewritten durable record.

### Async Derived-State Probe

When remote results update both durable cache and UI state, trace identity and
ordering across the entire path:

```text
request start -> response -> queued storage mutation -> React state
```

- [ ] Give each request an epoch or identity tied to its connection scope.
- [ ] Re-check identity when a queued storage mutation executes, not only when
      the response arrives.
- [ ] Serialize save and clear operations that target the same cache record.
- [ ] Invalidate the target scope when credentials or connection identity
      changes; never store raw credentials or weak fingerprints in cache keys.
- [ ] Add an integration test where old A finishes after current B.

### Best-Effort Enhancement Idempotency Probe

When a send starts optional background work such as a title, summary, preview,
telemetry event, or sync attempt, distinguish "attempted" from "succeeded":

- [ ] Persist the attempt/idempotency marker before the remote request begins.
- [ ] Keep failure fallback state separate from the attempt marker.
- [ ] Verify a second foreground action while the first enhancement is pending
      or failed does not start a duplicate request.
- [ ] Use an end-to-end two-action test; a pure eligibility unit test cannot
      prove durable ordering across controller, storage, and network layers.

### Custom Error Clone Probe

When a custom `Error` subclass crosses `structuredClone`, postMessage, worker,
IndexedDB, or JSON boundaries, treat it as a data-contract conversion:

- [ ] Identify which stable fields downstream consumers require.
- [ ] Project those fields to a plain validated record before persistence.
- [ ] Do not assume subclass fields survive because `name/message/stack` do.
- [ ] Test through the real intermediary wrapper, not only by calling the final
      persistence adapter directly.
- [ ] Assert sensitive `message/detail` content is absent from durable output.

### Browser Native Receiver Probe

When a browser-native function is injected or stored for later scheduling,
trace both its arguments and its receiver:

- [ ] Is the method safe when detached from `window`, `globalThis`, an observer,
      or a stream reader?
- [ ] If unsure, wrap it as `(...args) => globalThis.method(...args)` or bind the
      owner explicitly.
- [ ] Add a test whose fake records `this`, then run the affected workflow in a
      real browser. A jsdom unit pass does not catch Chrome `Illegal invocation`.
- [ ] Preserve the last valid runtime snapshot if scheduling or persistence
      fails, so the error path does not erase partial user-visible content.

### Capability-to-Affordance Probe

When stored or inferred model metadata controls visible chat actions, trace the
identity and meaning across the whole path:

```text
model ID -> user override / built-in registry / inference -> controller state
         -> active-model identity check -> visible action or status
```

- [ ] Keep "feature supported" separate from "feature has adjustable options".
- [ ] Test canonical, provider-prefixed, dated, quantized, and separator-variant
      model IDs. Normalize only the lookup key; preserve the original ID for
      the transport request and reject ambiguous normalized collisions.
- [ ] Confirm the settings editor targets the active model rather than a nearby
      global default with a different scope.
- [ ] Hide actions that the active model cannot perform; disable only actions
      that are temporarily unavailable because the app is busy or offline.
- [ ] Reject stale capability state whose `modelId` differs from the active
      connection model.
- [ ] Add an E2E that saves a capability override and observes the resulting
      toolbar state without reloading.
- [ ] After capability lookup is correct, intersect the model affordance with
      the selected API type's request format. A visible reasoning level is not
      proof that a New API or arbitrary OpenAI-compatible gateway accepts the
      same field as Gemini, Anthropic, or OpenAI Responses.

---

## Cross-Platform Template Consistency

In Trellis, command templates (e.g., `record-session.md`) exist in **multiple platforms** with identical or near-identical content. This is a cross-layer boundary.

### Checklist: After Modifying Any Command Template

- [ ] Find all platforms with the same command: `find src/templates/*/commands/trellis/ -name "<command>.*"`
- [ ] Update all platform copies (Markdown `.md` and TOML `.toml`)
- [ ] For Gemini TOML: adapt line continuations (`\\` vs `\`) and triple-quoted strings
- [ ] Run `/trellis:check-cross-layer` to verify nothing was missed

**Real-world example**: Updated `record-session.md` in Claude to use `--mode record`, but forgot iFlow, Kilo, OpenCode, and Gemini — caught by cross-layer check.

---

## Generated Runtime Template Upgrade Consistency

Some generated files are both documentation and runtime input. In Trellis,
`.trellis/workflow.md` is parsed by `get_context.py`, `workflow_phase.py`,
SessionStart filters, and per-turn hooks. Template changes must be validated
against both fresh init and upgrade paths.

### Checklist: After Modifying A Runtime-Parsed Template

- [ ] Identify every runtime parser that reads the template, not just the file
      writer that installs it
- [ ] Check whether relevant syntax lives outside obvious managed regions
      such as tag blocks
- [ ] Verify fresh `init` output and a versioned `update` scenario that writes
      the older `.trellis/.version`
- [ ] Add an upgrade regression using an older pristine template fixture, then
      assert the installed file reaches the current packaged shape
- [ ] Update the backend spec that owns the runtime contract

---

## Versioned Documentation Boundary

Versioned documentation is a cross-layer boundary: source paths, `docs.json`
version routing, and the rendered version selector must all describe the same
release line.

### Checklist: Before Editing Versioned Docs

- [ ] Identify the target release line: stable, beta, or RC
- [ ] Verify the edited MDX path matches that line:
  - stable: `docs-site/{start,advanced,...}` and `docs-site/zh/{start,advanced,...}`
  - beta: `docs-site/beta/**` and `docs-site/zh/beta/**`
  - RC: `docs-site/rc/**` and `docs-site/zh/rc/**`
- [ ] Verify `docs.json` navigation points the version label to the same paths
- [ ] Grep the opposite tree for release-line-specific terms before committing
- [ ] Treat beta content appearing under root release paths as a source-path bug,
      not a rendering bug

**Real-world example**: A beta-only task workflow change documented
`prd.md` + `design.md` + `implement.md`, task-creation consent, and Codex
mode banners under root `start/` and `advanced/` paths. The docs site then
served 0.6 beta behavior under the Release selector. The fix was to restore root
release docs, move the 0.6 content to `beta/` and `zh/beta/`, and add a grep
audit for beta markers against the root release tree.

**Real-world example**: Codex inline mode changed workflow platform markers from
`[Codex]` / `[Kilo, Antigravity, Windsurf]` to `[codex-sub-agent]` /
`[codex-inline, Kilo, Antigravity, Windsurf]`. Fresh init was correct, but
`trellis update` only merged `[workflow-state:*]` blocks and preserved stale
markers outside those blocks. Result: upgraded projects got new hook scripts
but old workflow routing, so `get_context.py --mode phase --platform codex`
could return empty Phase 2.1 detail.

---

## Mode-Detection Probe Checklist

When a CLI auto-detects a mode by probing a remote resource (e.g., checking if `index.json` exists to decide marketplace vs direct download):

### Before implementing:

- [ ] Probe runs in **ALL** code paths that use the result (interactive, `-y`, `--flag` combos)
- [ ] 404 vs transient error are distinguished — don't treat both as "not found"
- [ ] Transient errors **abort or retry**, never silently switch modes
- [ ] Shared state (caches, prefetched data) is **reset** when context changes (e.g., user switches source)
- [ ] **Shortcut paths** (e.g., `--template` skipping picker) must have the same error-handling quality as the probed path — check that downstream functions don't call catch-all wrappers

### After implementing:

- [ ] Trace every path from probe result to the mode-decision branch — no fallthrough
- [ ] External format contracts (giget URI, raw URLs) are tested or at least documented as comments
- [ ] Metadata reads consume a complete response or use a streaming parser — never parse a fixed-size prefix as full JSON
- [ ] When reconstructing a composite identifier from parsed parts, verify **all** fields are included and in the **correct position** (e.g., `provider:repo/path#ref` not `provider:repo#ref/path`)
- [ ] Verify that **action functions** called after a shortcut don't internally use the old catch-all fetch — they must use the probe-quality variant when error distinction matters

**Real-world example**: Custom registry flow had 8 bugs across 3 review rounds: (1) probe only ran in interactive mode, (2) transient errors fell through to wrong mode, (3) giget URI had `#ref` in wrong position, (4) prefetched templates leaked across source switches, (5) `--template` shortcut bypassed probe but `downloadTemplateById` internally used catch-all `fetchTemplateIndex`, turning timeouts into "Template not found".

**Real-world example**: Agent-session update hints fetched npm `latest` metadata with `response.read(4096)` and then parsed it as complete JSON. The `@mindfoldhq/trellis` package metadata exceeded 4 KB, so the JSON was truncated, parse failed silently, and the first session injection showed no update hint. Fix: read the complete response before parsing, and add a regression where `version` is followed by an 8 KB metadata tail.

---

## Cross-Platform Template Consistency

In Trellis, command templates (e.g., `record-session.md`) exist in **multiple platforms** with identical or near-identical content. This is a cross-layer boundary.

### Checklist: After Modifying Any Command Template

- [ ] Find all platforms with the same command: `find src/templates/*/commands/trellis/ -name "<command>.*"`
- [ ] Update all platform copies (Markdown `.md` and TOML `.toml`)
- [ ] For Gemini TOML: adapt line continuations (`\\` vs `\`) and triple-quoted strings
- [ ] Run `/trellis:check-cross-layer` to verify nothing was missed

**Real-world example**: Updated `record-session.md` in Claude to use `--mode record`, but forgot iFlow, Kilo, OpenCode, and Gemini — caught by cross-layer check.

---

## Generated Runtime Template Upgrade Consistency

Some generated files are both documentation and runtime input. In Trellis,
`.trellis/workflow.md` is parsed by `get_context.py`, `workflow_phase.py`,
SessionStart filters, and per-turn hooks. Template changes must be validated
against both fresh init and upgrade paths.

### Checklist: After Modifying A Runtime-Parsed Template

- [ ] Identify every runtime parser that reads the template, not just the file
  writer that installs it
- [ ] Check whether relevant syntax lives outside obvious managed regions
  such as tag blocks
- [ ] Verify fresh `init` output and a versioned `update` scenario that writes
  the older `.trellis/.version`
- [ ] Add an upgrade regression using an older pristine template fixture, then
  assert the installed file reaches the current packaged shape
- [ ] Update the backend spec that owns the runtime contract

**Real-world example**: Codex inline mode changed workflow platform markers from
`[Codex]` / `[Kilo, Antigravity, Windsurf]` to `[codex-sub-agent]` /
`[codex-inline, Kilo, Antigravity, Windsurf]`. Fresh init was correct, but
`trellis update` only merged `[workflow-state:*]` blocks and preserved stale
markers outside those blocks. Result: upgraded projects got new hook scripts
but old workflow routing, so `get_context.py --mode phase --platform codex`
could return empty Phase 2.1 detail.

---

## Mode-Detection Probe Checklist

When a CLI auto-detects a mode by probing a remote resource (e.g., checking if `index.json` exists to decide marketplace vs direct download):

### Before implementing:
- [ ] Probe runs in **ALL** code paths that use the result (interactive, `-y`, `--flag` combos)
- [ ] 404 vs transient error are distinguished — don't treat both as "not found"
- [ ] Transient errors **abort or retry**, never silently switch modes
- [ ] Shared state (caches, prefetched data) is **reset** when context changes (e.g., user switches source)
- [ ] **Shortcut paths** (e.g., `--template` skipping picker) must have the same error-handling quality as the probed path — check that downstream functions don't call catch-all wrappers

### After implementing:
- [ ] Trace every path from probe result to the mode-decision branch — no fallthrough
- [ ] External format contracts (giget URI, raw URLs) are tested or at least documented as comments
- [ ] Metadata reads consume a complete response or use a streaming parser — never parse a fixed-size prefix as full JSON
- [ ] When reconstructing a composite identifier from parsed parts, verify **all** fields are included and in the **correct position** (e.g., `provider:repo/path#ref` not `provider:repo#ref/path`)
- [ ] Verify that **action functions** called after a shortcut don't internally use the old catch-all fetch — they must use the probe-quality variant when error distinction matters

**Real-world example**: Custom registry flow had 8 bugs across 3 review rounds: (1) probe only ran in interactive mode, (2) transient errors fell through to wrong mode, (3) giget URI had `#ref` in wrong position, (4) prefetched templates leaked across source switches, (5) `--template` shortcut bypassed probe but `downloadTemplateById` internally used catch-all `fetchTemplateIndex`, turning timeouts into "Template not found".

**Real-world example**: Agent-session update hints fetched npm `latest` metadata with `response.read(4096)` and then parsed it as complete JSON. The `@mindfoldhq/trellis` package metadata exceeded 4 KB, so the JSON was truncated, parse failed silently, and the first session injection showed no update hint. Fix: read the complete response before parsing, and add a regression where `version` is followed by an 8 KB metadata tail.

---

## When to Create Flow Documentation

Create detailed flow docs when:

- Feature spans 3+ layers
- Multiple teams are involved
- Data format is complex
- Feature has caused bugs before

---

## Event Log / Projection Boundary

Append-only logs are cross-layer contracts. A single event travels through:

```
CLI input → event writer → events.jsonl → reader → filter → reducer → display
```

### Checklist: After Adding A New Event Kind Or Field

- [ ] Add the event kind to the central event taxonomy
- [ ] Add a typed event variant or type guard at the event layer
- [ ] Add normalization helpers for array/object fields that come from
      user input or JSON
- [ ] Keep `seq` / `id` assignment in the event writer only
- [ ] Make filters and reducers consume the typed event guard, not local casts
- [ ] Make display code consume reducer output or typed events, not raw JSON
- [ ] Add at least one regression that proves history replay and live filtering
      use the same filter model

**Real-world example**: Thread channels added `kind: "thread"`, `description`,
`context`, labels, and `lastSeq`. The first implementation replayed thread
state correctly, but several commands still re-parsed event payload fields with
local casts. The fix was to make the core event layer own `ThreadChannelEvent`
and `isThreadEvent`, make `reduceChannelMetadata` the only channel metadata
projection, and make `reduceThreads` the only thread replay reducer.
