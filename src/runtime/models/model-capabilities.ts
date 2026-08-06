import { z } from "zod";

import type {
  ModelCapabilityOverride,
  ResolvedModelCapability,
  SupportState,
} from "@/runtime/chat/types";
import { REASONING_EFFORTS } from "@/runtime/chat/types";
import { modelCapabilityOverrideSchema } from "@/runtime/chat/schemas";
import { normalizeModelLookupName } from "@/runtime/models/model-id-normalization";
import { applyReviewedModelFamilyProfile } from "@/runtime/models/model-family-profiles";
import modelCatalogJson from "@/runtime/models/model-catalog.json";

export const MODEL_CAPABILITY_REGISTRY_VERSION = 7;
export const DEFAULT_CONTEXT_WINDOW = 32_768;

type CapabilityTemplate = Omit<ResolvedModelCapability, "modelId" | "source">;

interface RegistryEntry {
  matches: (normalizedModelId: string) => boolean;
  capability: CapabilityTemplate;
}

const supported: SupportState = "supported";
const unsupported: SupportState = "unsupported";
const unknown: SupportState = "unknown";

const catalogCapabilitySchema = z
  .object({
    reasoning: z.boolean(),
    supportedEfforts: z.array(z.enum(REASONING_EFFORTS)),
    vision: z.boolean(),
    tools: z.boolean(),
    contextWindow: z.number().int().positive(),
    temperature: z.enum(["supported", "unsupported", "unknown"]),
    topP: z.enum(["supported", "unsupported", "unknown"]),
  })
  .strict();

const modelCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z
      .object({
        name: z.literal("models.dev"),
        license: z.literal("MIT"),
        modelsUrl: z.string().url(),
        apiUrl: z.string().url(),
        updatedAt: z.string().min(1),
      })
      .strict(),
    models: z.record(z.string(), catalogCapabilitySchema),
  })
  .strict();

const MODEL_CATALOG = modelCatalogSchema.parse(modelCatalogJson);
const CATALOG_BY_MODEL_NAME = buildCatalogModelNameIndex(MODEL_CATALOG.models);
const CATALOG_BY_NORMALIZED_MODEL_NAME = buildCatalogModelNameIndex(
  MODEL_CATALOG.models,
  normalizeModelLookupName,
);
const CATALOG_BY_PREVIEW_ALIAS = buildCatalogPreviewAliasIndex(
  MODEL_CATALOG.models,
);
const CATALOG_BY_NORMALIZED_PREVIEW_ALIAS = buildCatalogPreviewAliasIndex(
  MODEL_CATALOG.models,
  normalizeModelLookupName,
);

/**
 * Narrow, high-confidence corrections that intentionally take precedence over
 * the generated catalogue. Keep this list exact (or otherwise very narrow):
 * family-wide defaults belong in FAMILY_FALLBACK_REGISTRY below so a precise
 * models.dev record cannot be masked by a broad rule.
 */
const MANUAL_CORRECTIONS: readonly RegistryEntry[] = [
  {
    matches: (id) => normalizeModelLookupName(id) === "grok-4-5",
    capability: {
      reasoning: true,
      supportedEfforts: ["low", "medium", "high"],
      vision: true,
      tools: true,
      contextWindow: 500_000,
      temperature: supported,
      topP: unknown,
    },
  },
];

/**
 * Conservative family defaults used only when no exact manual correction or
 * catalogue record exists. These rules are deliberately last in resolution.
 */
const FAMILY_FALLBACK_REGISTRY: readonly RegistryEntry[] = [
  {
    matches: (id) => {
      const name = getModelName(id);
      return name === "gpt-5" || name.startsWith("gpt-5-");
    },
    capability: {
      reasoning: true,
      supportedEfforts: ["minimal", "low", "medium", "high"],
      vision: true,
      tools: true,
      contextWindow: 400_000,
      temperature: unsupported,
      topP: unsupported,
    },
  },
  {
    matches: (id) => {
      const name = getModelName(id);
      return name === "gpt-4.1" || name.startsWith("gpt-4.1-");
    },
    capability: {
      reasoning: false,
      supportedEfforts: [],
      vision: true,
      tools: true,
      contextWindow: 1_047_576,
      temperature: supported,
      topP: supported,
    },
  },
  {
    matches: (id) => {
      const name = getModelName(id);
      return name === "gpt-4o" || name.startsWith("gpt-4o-");
    },
    capability: {
      reasoning: false,
      supportedEfforts: [],
      vision: true,
      tools: true,
      contextWindow: 128_000,
      temperature: supported,
      topP: supported,
    },
  },
  {
    matches: (id) => /^(?:o1|o3|o4)(?:[-.:]|$)/u.test(getModelName(id)),
    capability: {
      reasoning: true,
      supportedEfforts: ["low", "medium", "high"],
      vision: true,
      tools: true,
      contextWindow: 200_000,
      temperature: unsupported,
      topP: unsupported,
    },
  },
  {
    matches: (id) => {
      const name = getModelName(id);
      return name === "deepseek-reasoner" || name.startsWith("deepseek-r1");
    },
    capability: {
      reasoning: true,
      supportedEfforts: [],
      vision: false,
      tools: false,
      contextWindow: 64_000,
      temperature: unsupported,
      topP: unsupported,
    },
  },
  {
    matches: (id) =>
      /(?:^|\/)claude-(?:3-7|(?:sonnet|opus|haiku)-4|4(?:-|$))/u.test(id),
    capability: {
      reasoning: true,
      supportedEfforts: [],
      vision: true,
      tools: true,
      contextWindow: 200_000,
      temperature: unsupported,
      topP: unsupported,
    },
  },
  {
    matches: (id) => /(?:^|\/)claude-/u.test(id),
    capability: {
      reasoning: false,
      supportedEfforts: [],
      vision: true,
      tools: true,
      contextWindow: 200_000,
      temperature: supported,
      topP: supported,
    },
  },
  {
    matches: (id) => /(?:^|\/)gemini-(?:2\.5|3)(?:-|$)/u.test(id),
    capability: {
      reasoning: true,
      supportedEfforts: [],
      vision: true,
      tools: true,
      contextWindow: 1_048_576,
      temperature: supported,
      topP: supported,
    },
  },
  {
    matches: (id) => /(?:^|\/)gemini-/u.test(id),
    capability: {
      reasoning: false,
      supportedEfforts: [],
      vision: true,
      tools: true,
      contextWindow: 1_048_576,
      temperature: supported,
      topP: supported,
    },
  },
  {
    matches: (id) => /(?:^|\/)(?:qwen3-vl|qwen3\.5)(?:[-.:]|$)/u.test(id),
    capability: {
      reasoning: true,
      supportedEfforts: [],
      vision: true,
      tools: true,
      contextWindow: 32_768,
      temperature: supported,
      topP: supported,
    },
  },
  {
    matches: (id) => /(?:^|\/)(?:qwen3|qwq)(?:[-.:]|$)/u.test(id),
    capability: {
      reasoning: true,
      supportedEfforts: [],
      vision: false,
      tools: true,
      contextWindow: 32_768,
      temperature: supported,
      topP: supported,
    },
  },
  {
    matches: (id) => /(?:^|\/)qwen(?:2(?:\.5)?-)?vl(?:[-.:]|$)/u.test(id),
    capability: {
      reasoning: false,
      supportedEfforts: [],
      vision: true,
      tools: true,
      contextWindow: 32_768,
      temperature: supported,
      topP: supported,
    },
  },
  {
    matches: (id) => getModelName(id) === "deepseek-chat",
    capability: {
      reasoning: false,
      supportedEfforts: [],
      vision: false,
      tools: true,
      contextWindow: 64_000,
      temperature: supported,
      topP: supported,
    },
  },
];

export function getBuiltinModelCapability(
  modelId: string,
): ResolvedModelCapability | null {
  return (
    getManualCorrection(modelId) ?? getFamilyFallbackModelCapability(modelId)
  );
}

function getManualCorrection(modelId: string): ResolvedModelCapability | null {
  const normalizedModelId = normalizeModelId(modelId);
  const entry = MANUAL_CORRECTIONS.find(({ matches }) =>
    matches(normalizedModelId),
  );
  return entry ? cloneCapability(modelId, entry.capability, "builtin") : null;
}

export function getFamilyFallbackModelCapability(
  modelId: string,
): ResolvedModelCapability | null {
  const normalizedModelId = normalizeModelId(modelId);
  const entry = FAMILY_FALLBACK_REGISTRY.find(({ matches }) =>
    matches(normalizedModelId),
  );
  return entry ? cloneCapability(modelId, entry.capability, "builtin") : null;
}

export function inferModelCapability(modelId: string): ResolvedModelCapability {
  const normalizedModelId = getModelName(normalizeModelId(modelId));
  const reasoning = isLikelyReasoningModel(normalizedModelId);
  const vision = isLikelyVisionModel(normalizedModelId);

  return {
    modelId,
    reasoning,
    supportedEfforts: inferEfforts(normalizedModelId),
    vision,
    tools: isLikelyToolModel(normalizedModelId),
    contextWindow: inferContextWindow(normalizedModelId),
    temperature: reasoning ? unknown : supported,
    topP: reasoning ? unknown : supported,
    source: "inferred",
  };
}

export function getCatalogModelCapability(
  modelId: string,
): ResolvedModelCapability | null {
  const normalizedModelId = normalizeModelId(modelId);
  const modelName = getModelName(normalizedModelId);
  const normalizedModelName = normalizeModelLookupName(modelName);
  const capability =
    MODEL_CATALOG.models[normalizedModelId] ??
    CATALOG_BY_MODEL_NAME.get(modelName) ??
    CATALOG_BY_PREVIEW_ALIAS.get(modelName) ??
    CATALOG_BY_NORMALIZED_MODEL_NAME.get(normalizedModelName) ??
    CATALOG_BY_NORMALIZED_PREVIEW_ALIAS.get(normalizedModelName) ??
    null;
  return capability ? cloneCapability(modelId, capability, "catalog") : null;
}

export function getAutomaticModelCapability(
  modelId: string,
): ResolvedModelCapability {
  return applyReviewedModelFamilyProfile(
    getManualCorrection(modelId) ??
      getCatalogModelCapability(modelId) ??
      getFamilyFallbackModelCapability(modelId) ??
      inferModelCapability(modelId),
  );
}

export function resolveModelCapability(
  modelId: string,
  override?: ModelCapabilityOverride | null,
): ResolvedModelCapability {
  const base = getAutomaticModelCapability(modelId);
  if (!override) return base;

  const validated = parseModelCapabilityOverride(override);
  if (Object.keys(validated).length === 0) return base;
  const reasoning = validated.reasoning ?? base.reasoning;
  return {
    modelId,
    reasoning,
    supportedEfforts: reasoning
      ? validated.supportedEfforts
        ? [...new Set(validated.supportedEfforts)]
        : base.supportedEfforts
      : [],
    vision: validated.vision ?? base.vision,
    tools: validated.tools ?? base.tools,
    contextWindow: validated.contextWindow ?? base.contextWindow,
    temperature: validated.temperature ?? base.temperature,
    topP: validated.topP ?? base.topP,
    source: "user",
  };
}

export function compactModelCapabilityOverride(
  modelId: string,
  override: ModelCapabilityOverride,
): ModelCapabilityOverride {
  const automatic = getAutomaticModelCapability(modelId);
  const validated = parseModelCapabilityOverride(override);
  const compact: ModelCapabilityOverride = {};
  const effectiveReasoning = validated.reasoning ?? automatic.reasoning;

  if (
    validated.reasoning !== undefined &&
    validated.reasoning !== automatic.reasoning
  ) {
    compact.reasoning = validated.reasoning;
  }
  if (
    effectiveReasoning &&
    validated.supportedEfforts !== undefined &&
    !sameEfforts(validated.supportedEfforts, automatic.supportedEfforts)
  ) {
    compact.supportedEfforts = validated.supportedEfforts;
  }
  if (validated.vision !== undefined && validated.vision !== automatic.vision) {
    compact.vision = validated.vision;
  }
  if (validated.tools !== undefined && validated.tools !== automatic.tools) {
    compact.tools = validated.tools;
  }
  if (
    validated.contextWindow !== undefined &&
    validated.contextWindow !== automatic.contextWindow
  ) {
    compact.contextWindow = validated.contextWindow;
  }
  if (
    validated.temperature !== undefined &&
    validated.temperature !== automatic.temperature
  ) {
    compact.temperature = validated.temperature;
  }
  if (validated.topP !== undefined && validated.topP !== automatic.topP) {
    compact.topP = validated.topP;
  }
  return compact;
}

export function parseModelCapabilityOverride(
  value: unknown,
): ModelCapabilityOverride {
  const parsed = modelCapabilityOverrideSchema.parse(value);
  const normalized: ModelCapabilityOverride = {};
  if (parsed.reasoning !== undefined) normalized.reasoning = parsed.reasoning;
  if (parsed.supportedEfforts !== undefined) {
    normalized.supportedEfforts = parsed.supportedEfforts;
  }
  if (parsed.vision !== undefined) normalized.vision = parsed.vision;
  if (parsed.tools !== undefined) normalized.tools = parsed.tools;
  if (parsed.contextWindow !== undefined) {
    normalized.contextWindow = parsed.contextWindow;
  }
  if (parsed.temperature !== undefined) {
    normalized.temperature = parsed.temperature;
  }
  if (parsed.topP !== undefined) normalized.topP = parsed.topP;
  return normalized;
}

function normalizeModelId(modelId: string): string {
  return modelId.normalize("NFKC").trim().toLocaleLowerCase();
}

function getModelName(normalizedModelId: string): string {
  return normalizedModelId.split("/").at(-1) ?? normalizedModelId;
}

function buildCatalogModelNameIndex(
  models: Readonly<Record<string, CapabilityTemplate>>,
  normalizeName: (modelName: string) => string = (modelName) => modelName,
): ReadonlyMap<string, CapabilityTemplate> {
  const candidates = new Map<string, CapabilityTemplate | null>();
  for (const [canonicalId, capability] of Object.entries(models)) {
    const modelName = normalizeName(getModelName(canonicalId));
    const existing = candidates.get(modelName);
    if (existing === undefined) {
      candidates.set(modelName, capability);
    } else if (existing !== null && !sameCapability(existing, capability)) {
      candidates.set(modelName, null);
    }
  }
  return new Map(
    [...candidates.entries()].filter(
      (entry): entry is [string, CapabilityTemplate] => entry[1] !== null,
    ),
  );
}

/**
 * Provider APIs sometimes expose a stable-looking ID while the catalogue only
 * has its preview variant. Use that variant only when every matching preview
 * record has identical capability metadata; conflicting records must fall
 * through to conservative inference instead of guessing.
 */
function buildCatalogPreviewAliasIndex(
  models: Readonly<Record<string, CapabilityTemplate>>,
  normalizeName: (modelName: string) => string = (modelName) => modelName,
): ReadonlyMap<string, CapabilityTemplate> {
  const candidates = new Map<string, CapabilityTemplate | null>();
  for (const [canonicalId, capability] of Object.entries(models)) {
    const previewName = previewAlias(getModelName(canonicalId));
    const alias = previewName ? normalizeName(previewName) : null;
    if (!alias) continue;
    const existing = candidates.get(alias);
    if (existing === undefined) {
      candidates.set(alias, capability);
    } else if (existing !== null && !sameCapability(existing, capability)) {
      candidates.set(alias, null);
    }
  }
  return new Map(
    [...candidates.entries()].filter(
      (entry): entry is [string, CapabilityTemplate] => entry[1] !== null,
    ),
  );
}

function previewAlias(modelName: string): string | null {
  const match = /^(.*)-preview(?=-|$)(.*)$/u.exec(modelName);
  if (!match?.[1]) return null;
  return `${match[1]}${match[2] ?? ""}`;
}

function sameCapability(
  left: CapabilityTemplate,
  right: CapabilityTemplate,
): boolean {
  return (
    left.reasoning === right.reasoning &&
    sameEfforts(left.supportedEfforts, right.supportedEfforts) &&
    left.vision === right.vision &&
    left.tools === right.tools &&
    left.contextWindow === right.contextWindow &&
    left.temperature === right.temperature &&
    left.topP === right.topP
  );
}

function isLikelyReasoningModel(modelId: string): boolean {
  return (
    /(?:^|[-_.:])(reasoning|reasoner|thinking)(?:$|[-_.:])/u.test(modelId) ||
    /^(?:o1|o3|o4)(?:[-.:]|$)/u.test(modelId) ||
    modelId.startsWith("gpt-5") ||
    modelId.startsWith("gpt-oss") ||
    modelId.includes("deepseek-r1") ||
    modelId.includes("qwq") ||
    (modelId.includes("qwen") && modelId.includes("think"))
  );
}

function isLikelyVisionModel(modelId: string): boolean {
  return (
    modelId.includes("vision") ||
    /(?:^|[-_.:])vl(?:$|[-_.:])/u.test(modelId) ||
    modelId.startsWith("gpt-4o") ||
    modelId.startsWith("gpt-4.1") ||
    modelId.startsWith("gpt-5") ||
    modelId.includes("gemini")
  );
}

function isLikelyToolModel(modelId: string): boolean {
  return /^(?:gpt-|o[134](?:[-.:]|$)|claude-|gemini-|grok-|qwen|deepseek-chat)/u.test(
    modelId,
  );
}

function inferEfforts(modelId: string): string[] {
  if (modelId.startsWith("gpt-5")) {
    return ["minimal", "low", "medium", "high"];
  }
  if (/^(?:o1|o3|o4)(?:[-.:]|$)/u.test(modelId)) {
    return ["low", "medium", "high"];
  }
  return [];
}

function inferContextWindow(modelId: string): number {
  if (modelId.startsWith("gpt-5")) return 400_000;
  if (modelId.startsWith("gpt-4.1")) return 1_047_576;
  if (modelId.startsWith("gpt-4o")) return 128_000;
  if (/^(?:o1|o3|o4)(?:[-.:]|$)/u.test(modelId)) return 200_000;
  if (modelId.includes("deepseek")) return 64_000;
  if (modelId.includes("qwen") || modelId.includes("qwq")) return 32_768;
  return DEFAULT_CONTEXT_WINDOW;
}

function cloneCapability(
  modelId: string,
  capability: CapabilityTemplate,
  source: ResolvedModelCapability["source"],
): ResolvedModelCapability {
  return {
    ...capability,
    modelId,
    supportedEfforts: [...capability.supportedEfforts],
    source,
  };
}

function sameEfforts(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((effort, index) => effort === right[index])
  );
}
