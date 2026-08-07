# Component Guidelines

## Composition

Components are typed functions. Define a named props interface when a component
has more than a trivial inline contract; examples are `RootLayoutProps` in
`src/app/layout.tsx` and `ProvidersProps` in `src/components/providers.tsx`.
Pass the `ChatController` facade into feature dialogs instead of importing
repositories or transports inside those dialogs.

## State and Error Ownership

- Keep draft fields and action-specific validation errors in the component that
  renders the action. `SettingsDialog` owns `connection`, advanced-setting
  drafts, and `saveError`.
- Reserve `chat.error` for errors that belong to the main chat runtime. Do not
  route dialog save failures to the outer chat banner.
- Clear a local action error before retrying and render it near the relevant
  controls with `role="alert"`.
- Do not duplicate request parsing, SSE parsing, or storage mutation logic in a
  component; call the controller/runtime owner.
- `SettingsWorkspace` owns connection, enabled-model, default-model,
  title-model, and capability drafts plus their local errors. Appearance
  changes apply immediately; every draft saves through its own controller
  command. Do not reintroduce a global settings save.
- Reuse the primitives in `src/components/settings/settings-controls.tsx` for
  settings labels, fields, selects, switches, and buttons so accessible names,
  focus states, and control dimensions remain consistent.
- Keep form action rows inside the owning `.settings-ui-panel` and reuse
  `settings-action-row settings-form-actions`; page-specific forms may add a
  class for a separator, but must not invent separate alignment rules.

The regression reference for error placement is
`tests/e2e/chat-data-tools.spec.ts` (Hosted authentication error boundaries).

```tsx
// Wrong: a Settings action leaks into the page-level chat banner.
catch (cause) {
  chat.setError(readMessage(cause));
}

// Correct: the dialog owns and renders the action failure.
catch (cause) {
  setSaveError(readMessage(cause));
}
// <p role="alert">{saveError}</p>
```

### Settings Save and Close Intent

`SettingsWorkspace` must treat closing during an asynchronous save as an intent,
not as an immediate dirty-state decision. The rendered baseline is stale until
the save promise settles.

- If any connection, default-model, title-model, capability, or web-search save
  is pending, a close request records `closeAfterSave` and keeps the workspace
  open without showing the discard dialog.
- After every save is settled, an effect reads the latest
  `hasUnsavedChanges`. Close automatically only when it is false; otherwise keep
  the workspace open and show the normal discard confirmation.
- A failed save keeps its draft and local error. The close intent must never
  silently discard that draft.
- Browser helpers that save a connection wait for the visible
  `Connection saved.` state before closing; fixed delays do not prove the
  baseline or IndexedDB write has settled.

Required regressions cover pending-save close with both success and failure, plus
one Chromium flow that saves and closes through the user-visible status.

```tsx
// Wrong: this reads the pre-save baseline and opens a stale confirmation.
if (hasUnsavedChanges) setDiscardConfirmOpen(true);
else onClose();

// Correct: defer the decision until every save has settled and React has the
// latest baseline-derived dirty state.
if (hasPendingSave) {
  setCloseAfterSave(true);
  return;
}
resolveCloseFromLatestDraft();
```

## Styling and Accessibility

Use the shared utility classes from `src/app/globals.css` plus Tailwind utility
classes. Support light and dark variants for status colors. Preserve semantic
elements, labels, keyboard focus restoration, accessible button names, and
dialog roles. User-visible fixed text must use `useTranslation()`.

Native `<img>` is allowed only for local Blob/data attachment previews where
Next Image optimization is not applicable; keep the narrow ESLint suppression
at that element. Never render model-provided raw HTML.

Icon-only actions must keep an accessible `aria-label` and reuse
`TextTooltip` for visible hover/focus text. This applies to message copy, edit,
regenerate, context cutoff, and version navigation; an accessible name alone is
not a substitute for sighted pointer feedback.

Model changes are conversation events, not page banners. An empty chat changes
the active model silently. A chat with persisted messages renders the
controller's `{ conversationId, from, to }` event as a divider immediately after
the message that existed when the switch was requested; keep its local
`afterMessageId` anchor instead of appending it to the current path after later
messages. The divider belongs inside the matching `.message-column`, and the
message auto-follow effect must include the event so a newly appended divider
is visible. `from` is the current branch's last Assistant `modelSnapshot`, not
the previously selected connection model. Thus `A answered -> select B without
sending -> select C` announces `A -> C`, selecting A again announces nothing,
and B becomes the source only after B creates an Assistant reply. Do not restore
a global notice below the top bar.

Optional numeric model settings must read `HTMLInputElement.valueAsNumber` and
ignore `NaN` (including an empty field), while clamping finite values to the
declared range before updating the draft. Native `min`/`max` attributes alone
do not prevent out-of-range keyboard input and would otherwise surface a
repository error too far from the field.

### Model Capability Affordances

Treat capability support, parameter adjustability, and the settings editing
target as separate contracts:

- The Model settings editor opens on `connection.modelId`, the active chat
  model. `defaultModel` controls only new chats and must not silently become the
  capability editing target.
- Consume a resolved capability only when its `modelId` equals the active model;
  a result for the previous model must not leave stale controls visible.
- `reasoning=true` means reasoning is available. An empty `supportedEfforts`
  means the provider controls it automatically, so render a non-interactive
  status instead of hiding reasoning or inventing an effort value.
- `vision=false` means image input is not an available action. Remove the upload
  affordance instead of leaving a permanently disabled button that advertises
  unsupported behavior.
- Capability resolution priority is scoped user override, versioned built-in
  registry, then conservative inference. UI components consume the resolved
  result and do not reimplement model-name matching.

Any change to these rules requires one interaction test from Model settings
save through the active chat toolbar, in addition to resolver/component tests.

### Model Identity Surfaces

- Reuse `ModelIcon` in chat, settings selectors, and enablement rows. Provider
  matching lives in that component; individual pages must not duplicate model
  family regexes. Unknown IDs use the neutral fallback mark.
- Provider discovery and user enablement are separate UI concepts. The model
  service page may display every discovered ID, while chat/default/title/model
  settings selectors display only enabled and required in-use IDs.
- Multi-model enablement uses the shared Checkbox primitive, searchable rows,
  visible selected counts, and immediate persistence. Active/default/title rows
  are labelled as in use but remain toggleable once another model is enabled.
- Changing a settings destination resets the scroll container to the top so a
  newly selected task never opens halfway through its form.
- Cover long IDs, provider marks, selection controls, and action alignment at
  desktop and mobile widths. Text may truncate in selectors but must not push
  checkboxes or buttons outside their container.

### Enabled Model Projection Contract

#### 1. Scope / Trigger

Use this contract whenever model discovery, enablement, or a model role changes.
It prevents a currently referenced model from making the persisted enabled set
look permanently selected.

#### 2. Signatures

- `ChatController.enabledModels: string[]` is the effective enabled set: the
  persisted user selection in BYOK and the server-projected list in Hosted.
- `ChatController.models: string[]` is the selector-visible projection.
- `saveEnabledModels(modelIds: readonly string[]): Promise<string[]>` persists
  immediately and returns the normalized enabled set.

#### 3. Contracts

- Store at least one enabled model per BYOK connection scope.
- Hosted mode treats every server-projected available model as enabled and
  ignores the browser's persisted enabled subset without deleting it. The
  Model service page renders no enablement checkboxes in Hosted mode.
- BYOK mode keeps the persisted enabled subset as the user's model filter.
- Build `models` from enabled IDs plus active/default/title references that must
  remain renderable until the user switches them.
- Render enablement checked state from `enabledModels`, never from `models` or
  the in-use references. Do not add a second Save model selection action.

#### 4. Validation & Error Matrix

- Empty BYOK selection -> reject and restore the previous checked state locally.
- In-use model with another enabled model -> allow disabling; retain it only in
  the selector-visible projection.
- Last enabled model -> keep its checkbox disabled until another is enabled.
- Hosted cache or backup contains a subset -> ignore the subset and project the
  current server model list.

#### 5. Good / Base / Bad Cases

- Good: enable model B, then disable active/default model A; B stays checked and
  A remains available only while a role still references it.
- Base: a first-time connection has one enabled model and cannot reach zero.
- Bad: union role IDs into checked state, which makes model A impossible to
  disable and misrepresents the stored selection.

#### 6. Tests Required

- Component: an in-use checkbox becomes toggleable after a second model is
  enabled, the last enabled checkbox remains disabled, and no save button exists.
- Hook/component: a stale Hosted subset, including backup restore, still yields
  every deployment model and no Hosted checkbox UI.
- Browser: a toggle persists before leaving Model service; refresh and enabled
  sections keep their order without desktop/mobile overflow.

#### 7. Wrong vs Correct

```ts
// Wrong: role references become permanent enabled selections.
const checked = new Set([...requiredModels, ...enabledModels]);

// Correct: checked state reflects only the persisted selection.
const checked = new Set(enabledModels);
const visibleModels = unique([...enabledModels, ...requiredModels]);

// Correct: Hosted deployment policy is already the final enabled set.
const hosted = projectConnectionModels({
  mode: "hosted",
  currentModelId: connection.modelId,
  availableModelIds: publicConfig.models,
  persistedEnabledModelIds: staleBrowserSubset,
});
```

### Conditional Class Composition

Use `cn()` or `clsx()` when a class token depends on state. Do not concatenate
class fragments that rely on leading or trailing whitespace inside a template
string: `prettier-plugin-tailwindcss` normalizes class strings and can remove the
separator, producing a non-existent class such as
`chat-stagechat-stage-empty`.

```tsx
// Wrong: formatting can remove the separator before the conditional token.
className={`chat-stage${empty ? " chat-stage-empty" : ""}`}

// Correct: each class remains an independent token after formatting.
className={cn("chat-stage", empty && "chat-stage-empty")}
```

When the class controls user-visible state or geometry, add a component or
Playwright assertion for the exact state token and its behavioral consequence.

When a responsive rule changes a flex container from a row to a column, reset
any child `flex-basis` that was intended as a horizontal width. Otherwise the
desktop width becomes a mobile height and creates large blank gaps. Cover the
resulting control height or spacing with a Playwright assertion.

## Review Checks

- Does state live at the smallest component/controller boundary that owns it?
- Is every async action failure visible where the action occurred?
- Are mobile drawer, keyboard, focus, and dark-theme behaviors preserved?
- Is changed user-visible behavior covered by Playwright?

## Text Editing And Error Presentation

Conversation-title editing reuses
`src/components/chat/text-edit-dialog.tsx` instead of browser-native prompts or
a second form dialog. Its contract keeps draft value, pending state, local
error, submit, and focus restoration in one component:

```ts
interface TextEditDialogProps {
  open: boolean;
  initialValue: string;
  pending: boolean;
  error: string | null;
  multiline?: boolean;
  onSubmit: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}
```

### Scenario: Inline User Message Editing

#### 1. Scope / Trigger

Use this contract when changing user-message edit actions, message branches, or
the visual message bubble. Assistant editing and conversation-title editing are
outside this inline form.

#### 2. Signatures

```ts
editMessage(messageId: string, content: string): Promise<void>;
editAndRegenerate(messageId: string, content: string): Promise<void>;
generateUserMessage(messageId: string): Promise<void>;
```

#### 3. Contracts

- Clicking Edit replaces the original user bubble content with a semantic
  `form + textarea`; it never creates a Dialog or overlay.
- The component owns draft, pending, and local error state. Cancel performs no
  storage mutation, restores the original content, and returns focus to Edit.
- Save only calls `editMessage`. Save and send calls `editAndRegenerate`, or
  `generateUserMessage` when the text is unchanged. The Controller remains the
  only owner of branch persistence and generation.
- While pending, disable the textarea and all three actions. On failure, retain
  the draft and show a localized `role="alert"` inside the editor.
- Desktop and mobile layouts keep the editor inside the message column. Mobile
  may move Save and send to a full-width second row.

#### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Draft is empty or whitespace | Both submit actions disabled; no Controller call |
| Cancel | Exit editing, preserve the stored message, restore Edit focus |
| Save only succeeds | Exit editing after `editMessage` settles |
| Save and send succeeds | Exit editing and follow existing branch generation |
| Either mutation rejects | Keep draft/editor open and render a localized local error |
| A mutation is pending | Ignore duplicate actions and disable every editor control |

#### 5. Good / Base / Bad Cases

- Good: edit a long message on mobile, keep all actions visible, and create a
  new branch through the existing Controller command.
- Base: cancel an unchanged draft and return to the original bubble.
- Bad: open `TextEditDialog` for a user message, mutate storage from
  `MessageView`, or close the editor before an asynchronous mutation succeeds.

#### 6. Tests Required

- Component: no Dialog, initial/autofocused draft, blank disabled, cancel and
  focus restoration, Save only, Save and send, unchanged send, pending
  duplicate prevention, and failure draft retention.
- Chromium/Mobile Chrome: long draft, visible actions, no horizontal overflow,
  saved branch behavior, and immediate regeneration behavior.

#### 7. Wrong vs Correct

```tsx
// Wrong: user-message editing leaves the message context and hides local state.
<TextEditDialog onSubmit={(value) => chat.editAndRegenerate(id, value)} />

// Correct: the original bubble owns only the interaction state.
<form onSubmit={() => chat.editAndRegenerate(id, draft)}>
  <textarea value={draft} onChange={updateDraft} />
</form>
```

Async UI failures use `formatUserFacingError(cause, t)` from
`src/lib/user-facing-error.ts`. It maps `ChatTransportError` and
`StorageError` to localized `chatError.*` / `storageError.*` resources and
uses a localized fallback for unknown exceptions. Do not render
`cause.message` directly: transport details can contain upstream, storage, or
validation implementation text that is not useful to the user.

Wrong:

```tsx
setError(cause instanceof Error ? cause.message : t("unknownError"));
```

Correct:

```tsx
setError(formatUserFacingError(cause, t));
```

## Scenario: Remote Markdown Image Consent

### 1. Scope / Trigger

Use this contract whenever changing `MessageMarkdown`, Streamdown components,
Markdown URL filtering, or styles/tests for model-provided images. A remote
Markdown image is a third-party network request and must not load implicitly.

### 2. Signatures

```ts
safeMarkdownUrl(url: string, key: string): string;

interface RemoteMarkdownImageProps
  extends React.ComponentPropsWithoutRef<"img"> {
  node?: unknown;
}
```

### 3. Contracts

- HTTP/HTTPS Markdown images initially render an accessible localized button;
  no remote `<img src>` exists before user confirmation.
- Click or native keyboard activation creates the image with the filtered URL,
  `referrerPolicy="no-referrer"`, and `loading="lazy"`.
- Approval belongs to the exact filtered URL. If streaming/rerendering changes
  the URL, show the button again instead of automatically loading the new host.
- Button clicks prevent parent-link navigation. Unsafe protocols render no
  loadable image. Raw model HTML remains disabled.
- Fixed button copy lives in both `zh-CN` and English resources; styles use the
  shared color/radius/focus system and preserve long alt text.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Remote HTTPS/HTTP image before approval | Button only; zero image request |
| User clicks or presses Enter/Space | Create one native image with safe attributes |
| URL changes after approval | Revoke view state; require approval again |
| `data:`, `javascript:`, relative, or empty image URL | No loadable image |
| Image is wrapped in a Markdown link | Button prevents the link's default navigation |

### 5. Good / Base / Bad Cases

- Good: the user activates “Load remote image: Diagram”; the browser requests it
  without a Referer.
- Base: ordinary text, links, local attachments, Mermaid, and code rendering are
  unchanged.
- Bad: render `<img src={modelUrl}>` during Markdown parsing, store approval as a
  global boolean, or put the remote URL in a hidden image/preload element.

### 6. Tests Required

- Component: initial absence of `<img>`, keyboard activation, exact `src`,
  `no-referrer`, lazy loading, URL-change reapproval, unsafe protocols, and both
  languages.
- Chromium: intercept the remote host, assert zero requests before activation,
  then one request with no `Referer` after activation.
- Run Markdown regressions for raw HTML, unsafe links, streaming, CJK, math,
  code blocks, and Mermaid.

### 7. Wrong vs Correct

```tsx
// Wrong: parsing model output immediately contacts a third party.
return <img alt={alt} src={safeMarkdownUrl(src, "src")} />;

// Correct: the exact URL must be approved before an image element exists.
return approvedSrc === safeSrc ? (
  <img alt={alt} loading="lazy" referrerPolicy="no-referrer" src={safeSrc} />
) : (
  <button onClick={() => setApprovedSrc(safeSrc)}>Load remote image</button>
);
```
