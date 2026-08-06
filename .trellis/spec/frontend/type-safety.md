# Type Safety

The project uses strict TypeScript with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` (`tsconfig.json`). ESLint rejects explicit `any`.

## Type Ownership

- Persistent and chat-domain records live in `src/runtime/chat/types.ts`.
- Runtime schemas for backups, connections, and messages live in
  `src/runtime/chat/schemas.ts`.
- Protocol-specific schemas stay next to the protocol owner, such as
  `src/runtime/agent/ai-sdk/openai-compatible-stream-contract.ts` and
  `src/server/config.ts`.
- Component-only draft types stay near the controller/component that owns them.

## Runtime Validation

Treat `fetch().json()`, imported backups, localStorage JSON, custom parameter
JSON, and provider stream events as `unknown`. Validate with Zod, a provider SDK,
or a focused type guard before use. `ConnectionStore.load()` validates fallback
JSON with `connectionBundleSchema`; the public config reader verifies each
expected field.

Prefer discriminated unions for message parts, stream states, capabilities, and
error codes. Narrow before reading optional/indexed values. Use `satisfies` or a
validated projection instead of an assertion when possible.

## Avoid

- `any`, `@ts-ignore`, non-null assertions used to bypass missing cases, or
  casting raw JSON directly to a domain type.
- Duplicating a partial external-payload type in multiple consumers.
- Adding optional properties with explicit `undefined`; omit them to respect
  `exactOptionalPropertyTypes`.

## Scenario: Generated Model Capability Catalogue

### 1. Scope / Trigger

Use this contract when updating models.dev data, adding catalogue fields,
changing model-ID normalization, or changing capability-source priority.

### 2. Signatures

```ts
type CapabilitySource = "builtin" | "catalog" | "inferred" | "user";
getCatalogModelCapability(modelId: string): ResolvedModelCapability | null;
getFamilyFallbackModelCapability(
  modelId: string,
): ResolvedModelCapability | null;
getAutomaticModelCapability(modelId: string): ResolvedModelCapability;
```

The maintenance command is `npm.cmd run models:update`; it owns download,
validation, deterministic projection, and Prettier formatting of
`src/runtime/models/model-catalog.json`.

### 3. Contracts

- The script downloads `models.json` and `api.json` from models.dev and writes a
  checked-in schema-versioned snapshot. Browser runtime never contacts
  models.dev.
- Store only reasoning, supported effort values, image input, context window,
  Temperature, Top P, and source metadata. Entries without a positive context
  window are skipped instead of receiving an invented value.
- Join provider reasoning options only for the canonical provider/model pair.
  Unknown Top P support remains `unknown`; do not derive it from Temperature.
- Automatic resolution is exact high-confidence manual correction, unique
  catalogue ID or unambiguous model-name/preview-alias match, conservative
  family fallback, then name inference. A scoped user override is applied last
  and remains the highest effective priority.
- `getBuiltinModelCapability` includes both exact corrections and family
  fallbacks for direct inspection. Do not place it ahead of the catalogue in
  the automatic resolver; doing so masks model-specific catalogue records.
- The bundled JSON is parsed once through the runtime Zod schema. Bare-name and
  stable-looking aliases for `*-preview[-variant]` records are accepted only
  when every candidate has identical capability metadata. Conflicting aliases
  are dropped rather than guessed.
- Catalogue lookup keeps the original provider/model ID for upstream requests,
  but may use a collision-safe lookup key for aliases. That key normalizes
  version separators (`3.1`, `3-1`, `3_1`), known routing/Bedrock prefixes,
  legal snapshot dates, quantization suffixes, and documented transport
  variants. Parameter-size suffixes are intentionally not stripped because
  different sizes can have different context windows or modalities.
- A preview alias must remove only the `-preview` token and retain a meaningful
  variant suffix. For example, `gemini-3.1-pro-preview-customtools` may alias
  `gemini-3.1-pro-customtools`; it must not be collapsed blindly to the base
  model. Exact raw IDs still win over normalized aliases.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Download is non-2xx or exceeds 30 seconds | Update command fails; old snapshot remains reviewed input |
| Canonical ID has no provider/model separator | Update command fails |
| Context window is absent/non-positive | Entry is skipped and counted |
| Effort value is outside `REASONING_EFFORTS` | Value is omitted |
| Bundled schema/source metadata is invalid | Runtime import fails during test/build |
| Bare model-name aliases disagree | No alias; require canonical ID or inference |
| Preview variants for one stable alias disagree | Drop the alias and use family/inference fallback |
| Raw IDs differ only by a documented separator/transport variant | Resolve through the normalized collision-safe index without changing the request model ID |
| Catalogue model also matches a family fallback | Catalogue record wins |

### 5. Good / Base / Bad Cases

- Good: `xai/grok-4.5` uses the manual documented correction while a Mistral
  model outside the manual registry resolves from the static catalogue.
- Base: a catalogue-backed GPT, Claude, Gemini, Qwen, DeepSeek, Grok, or GLM
  model keeps its model-specific context and reasoning options even when a
  family fallback also matches.
- Base: `gemini-3.1-pro` inherits the identical catalogue capability shared by
  `gemini-3.1-pro-preview` variants, including adjustable reasoning levels.
- Base: an unknown member of a known family uses the conservative family
  fallback; an unrelated custom model uses name inference.
- Bad: fetch models.dev from the browser, copy the complete provider dataset,
  let a family fallback mask a catalogue record, or let a generated value
  override an explicit user setting.

### 6. Tests Required

- Generator: consecutive runs against one snapshot produce the same formatted
  SHA-256 output and report skipped context-less records.
- Resolver: exact manual priority, catalogue canonical/bare/preview-alias
  lookup, normalized separator/prefix/date/quantization aliases,
  ambiguous-alias rejection, family and inference fallback, sparse override
  behavior, and user priority.
- Regression matrix: assert model-specific reasoning options, vision, context,
  and parameter support for representative GPT, Claude, Gemini, Qwen,
  DeepSeek, Grok, and GLM catalogue entries.
- Browser: a Custom API-discovered Grok model exposes documented reasoning
  efforts; a catalogue-only model shows the catalogue source label.
- Build/security: the browser bundle contains the snapshot but no credentials
  or runtime request to models.dev.

### 7. Wrong vs Correct

```ts
// Wrong: a broad family default masks a precise catalogue record.
return getBuiltinModelCapability(id) ?? getCatalogModelCapability(id);

// Correct: only exact corrections precede the reviewed static catalogue.
return getManualCorrection(id) ??
  getCatalogModelCapability(id) ??
  getFamilyFallbackModelCapability(id) ??
  inferModelCapability(id);

// Correct: only promote a preview-derived alias when every candidate agrees.
if (previewCandidates.every((item) => sameCapability(item, first))) {
  aliasIndex.set(stableName, first);
}

// Correct: normalize aliases for lookup only; preserve the upstream ID.
const lookupName = normalizeModelLookupName(modelId);
return normalizedCatalog.get(lookupName) ?? fallback(modelId);
```
