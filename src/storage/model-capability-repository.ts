import type {
  ModelCapabilityOverride,
  ModelPreferences,
  ModelOverrideRecord,
  ResolvedModelCapability,
} from "@/runtime/chat/types";
import {
  compactModelCapabilityOverride,
  DEFAULT_CONTEXT_WINDOW,
  getAutomaticModelCapability,
  getFamilyFallbackModelCapability,
  parseModelCapabilityOverride,
  resolveModelCapability,
} from "@/runtime/models/model-capabilities";
import { modelPreferencesSchema } from "@/runtime/chat/schemas";
import { createDefaultModelPreferences } from "@/runtime/chat/types";
import type { ChatDatabase } from "@/storage/database";

export const MODEL_CAPABILITY_RECORD_VERSION = 2 as const;

export class ModelCapabilityRepository {
  constructor(
    private readonly database: ChatDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async resolve(
    connectionScope: string,
    modelId: string,
  ): Promise<ResolvedModelCapability> {
    const record = await this.loadRecord(connectionScope, modelId);
    return resolveModelCapability(modelId, record?.override);
  }

  async resolvePreferences(
    connectionScope: string,
    modelId: string,
  ): Promise<ModelPreferences> {
    const record = await this.loadRecord(connectionScope, modelId);
    return modelPreferencesSchema.parse(
      record?.preferences ?? createDefaultModelPreferences(),
    );
  }

  async saveOverride(
    connectionScope: string,
    modelId: string,
    override: ModelCapabilityOverride,
  ): Promise<ModelOverrideRecord> {
    const current = await this.loadRecord(connectionScope, modelId);
    const record: ModelOverrideRecord = {
      connectionScope,
      modelId,
      override: compactModelCapabilityOverride(modelId, override),
      capabilityVersion: MODEL_CAPABILITY_RECORD_VERSION,
      updatedAt: this.now(),
      ...(current?.preferences
        ? { preferences: modelPreferencesSchema.parse(current.preferences) }
        : {}),
    };
    await this.database.modelOverrides.put(record);
    return record;
  }

  async saveSettings(
    connectionScope: string,
    modelId: string,
    override: ModelCapabilityOverride,
    preferences: ModelPreferences,
  ): Promise<ModelOverrideRecord> {
    const current = await this.loadRecord(connectionScope, modelId);
    const currentOverride = current
      ? parseModelCapabilityOverride(current.override)
      : {};
    const formOwnedOverride = compactModelCapabilityOverride(modelId, override);
    const record: ModelOverrideRecord = {
      connectionScope,
      modelId,
      override: {
        ...(currentOverride.temperature !== undefined
          ? { temperature: currentOverride.temperature }
          : {}),
        ...(currentOverride.topP !== undefined
          ? { topP: currentOverride.topP }
          : {}),
        ...formOwnedOverride,
      },
      preferences: modelPreferencesSchema.parse(preferences),
      capabilityVersion: MODEL_CAPABILITY_RECORD_VERSION,
      updatedAt: this.now(),
    };
    await this.database.modelOverrides.put(record);
    return record;
  }

  async reset(connectionScope: string, modelId: string): Promise<void> {
    const current = await this.loadRecord(connectionScope, modelId);
    if (!current?.preferences) {
      await this.database.modelOverrides.delete([connectionScope, modelId]);
      return;
    }
    await this.database.modelOverrides.put({
      ...current,
      override: {},
      capabilityVersion: MODEL_CAPABILITY_RECORD_VERSION,
      updatedAt: this.now(),
    });
  }

  async resetSettings(connectionScope: string, modelId: string): Promise<void> {
    await this.database.modelOverrides.delete([connectionScope, modelId]);
  }

  private async loadRecord(
    connectionScope: string,
    modelId: string,
  ): Promise<ModelOverrideRecord | undefined> {
    const record = await this.database.modelOverrides.get([
      connectionScope,
      modelId,
    ]);
    if (
      !record ||
      record.capabilityVersion === MODEL_CAPABILITY_RECORD_VERSION
    ) {
      return record;
    }

    const storedOverride = parseModelCapabilityOverride(record.override);
    const migratedOverride =
      record.capabilityVersion === 1
        ? migrateVersionOneOverride(modelId, storedOverride)
        : migrateLegacyOverride(modelId, storedOverride);
    const migrated: ModelOverrideRecord = {
      ...record,
      override: migratedOverride,
      capabilityVersion: MODEL_CAPABILITY_RECORD_VERSION,
    };
    await this.database.modelOverrides.put(migrated);
    return migrated;
  }
}

function migrateVersionOneOverride(
  modelId: string,
  override: ModelCapabilityOverride,
): ModelCapabilityOverride {
  const migrated = { ...override };
  if (
    migrated.supportedEfforts?.length === 0 &&
    getAutomaticModelCapability(modelId).supportedEfforts.length > 0
  ) {
    delete migrated.supportedEfforts;
  }
  return compactModelCapabilityOverride(modelId, migrated);
}

function migrateLegacyOverride(
  modelId: string,
  override: ModelCapabilityOverride,
): ModelCapabilityOverride {
  if (!isLegacyCompleteCapabilitySnapshot(override)) {
    return compactModelCapabilityOverride(modelId, override);
  }

  const migrated = { ...override };
  const familyFallback = getFamilyFallbackModelCapability(modelId);
  if (familyFallback) {
    if (migrated.reasoning === familyFallback.reasoning) {
      delete migrated.reasoning;
    }
    if (
      migrated.supportedEfforts &&
      sameEfforts(migrated.supportedEfforts, familyFallback.supportedEfforts)
    ) {
      delete migrated.supportedEfforts;
    }
    if (migrated.vision === familyFallback.vision) {
      delete migrated.vision;
    }
    if (migrated.contextWindow === familyFallback.contextWindow) {
      delete migrated.contextWindow;
    }
  }

  // Older settings stored the complete inferred form. A 32K context and an
  // empty effort list were automatic defaults, not durable user choices.
  if (migrated.contextWindow === DEFAULT_CONTEXT_WINDOW) {
    delete migrated.contextWindow;
    if (migrated.supportedEfforts?.length === 0) {
      delete migrated.supportedEfforts;
    }
  }

  const automatic = getAutomaticModelCapability(modelId);
  if (
    migrated.supportedEfforts?.length === 0 &&
    automatic.supportedEfforts.length > 0
  ) {
    delete migrated.supportedEfforts;
  }
  return compactModelCapabilityOverride(modelId, migrated);
}

function sameEfforts(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isLegacyCompleteCapabilitySnapshot(
  override: ModelCapabilityOverride,
): boolean {
  return ["reasoning", "supportedEfforts", "vision", "contextWindow"].every(
    (key) => Object.prototype.hasOwnProperty.call(override, key),
  );
}
