# State Management

CherryChat does not use a general global-state library. State is split by
ownership rather than collected in one store.

## Categories

- **Component-local drafts:** dialog fields, open/closed state, export options,
  and action errors. These use `useState` in the rendering component.
- **Feature runtime state:** active conversation, messages, stream state, public
  config, and controller errors. `useChatController` owns and exposes these.
- **Persistent state:** connections, credentials, conversations, messages,
  attachments, settings, and capability overrides. Repositories in
  `src/storage/` own writes; IndexedDB is primary and the connection store may
  fall back to localStorage.
- **Derived state:** active message path, branch usage, context estimates, and
  capability projections. Recompute from canonical records instead of storing a
  second total or flattened copy.
- **Server-derived state:** `/api/config` exposes only safe deployment metadata,
  the deployment `appVersion`, whether the submitted access code authenticates,
  and a hosted-search availability boolean. A Hosted Key itself never enters
  React state.

## Mutation Rules

Use repository transactions for related writes, reload the affected projection
after a successful mutation, and never mutate React state objects in place.
Persist throttled stream updates through `stream-persistence.ts`, then commit the
terminal state transactionally.

Errors follow the same ownership rule: settings save errors stay in the settings
workspace; LLM failures belong to the persisted Assistant message; transient
copy/image/navigation failures use the shared Toast; storage degradation stays
in the persistent workspace warning. The controller error is reserved for
startup or cross-workspace failures with no narrower owner. Do not promote a
local form or message error to global state for convenience.

## Scenario: Stream Rendering And Single-Flight Persistence

### 1. Scope / Trigger

Use this contract when changing AI SDK stream projection, live message
rendering, tool steps, stop behavior, or IndexedDB stream writes.

### 2. Signatures

```ts
interface StreamSnapshot {
  finalText: string;
  contentParts: Array<TextPart | ToolCallPart>;
  toolCalls: NormalizedToolCall[];
}

FrameSnapshotDispatcher.schedule(snapshot: StreamSnapshot): void;
ThrottledStreamPersistence.record(snapshot: StreamSnapshot): void;
ThrottledStreamPersistence.checkpoint(snapshot: StreamSnapshot): Promise<void>;
ThrottledStreamPersistence.finish(result: StreamResult): Promise<void>;
```

### 3. Contracts

- The selected provider SDK parses network events and `AiSdkStreamProjector`
  reduces every SDK part. React receives only the latest CherryChat snapshot
  once per animation frame; terminal states flush immediately.
- Browser-native frame functions are invoked through `globalThis`, not stored
  and called with a class instance as their receiver.
- `contentParts` is the ordered persistence source. Text before a tool, the
  tool result, and later text must retain that order after reload and context
  projection. `finalText` is only the aggregate copy/token-estimation view.
- Draft persistence has at most one active write and one replaceable pending
  snapshot. Clone only when flushing. Tool start/result, stop, error, and final
  completion are durability checkpoints.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Several chunks arrive in one frame | Render only the newest snapshot |
| A terminal result arrives with a frame pending | Cancel the frame and flush terminal state |
| IndexedDB is slower than the stream | Replace the pending draft; never grow an unbounded promise chain |
| User stops during a tool | Preserve prior text and finalize the running tool as interrupted |
| Page reloads with pending/streaming Assistant rows | Recover them as stopped before loading conversations |

### 5. Good/Base/Bad Cases

- Good: `text -> running tool -> completed tool -> text` is identical live,
  durable, and in the next model request.
- Base: ordinary text-only chat still uses one browser stream and one message
  row, with frame-coalesced UI and throttled writes.
- Bad: clone the whole accumulated answer for every chunk or append every write
  promise, which makes long answers increasingly expensive.

### 6. Tests Required

- Unit: frame coalescing, terminal flush, and browser receiver binding.
- Unit: slow IndexedDB keeps only the latest pending draft.
- Integration: tool checkpoints, stop during tool, message-part order, and
  interrupted-message startup recovery.
- Browser: desktop/mobile tool loop, source expansion, reload order, stop,
  ordinary streaming, and horizontal overflow.

### 7. Wrong vs Correct

```ts
// Wrong: a native method receives FrameSnapshotDispatcher as `this` in Chrome.
private requestFrame = requestAnimationFrame;
this.requestFrame(callback);

// Correct: preserve the browser receiver and coalesce the latest snapshot.
private requestFrame = (callback: FrameRequestCallback) =>
  globalThis.requestAnimationFrame(callback);
```
