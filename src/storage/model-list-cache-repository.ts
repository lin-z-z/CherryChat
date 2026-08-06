import { z } from "zod";

import {
  CHAT_ENDPOINT_TYPES,
  type ModelDescriptor,
} from "@/runtime/chat/types";
import type { ChatDatabase } from "@/storage/database";
import { normalizeStorageError } from "@/storage/errors";

export const MODEL_LIST_CACHE_SETTINGS_KEY = "modelListCache.v2";

const connectionScopeSchema = z.string().trim().min(1).max(2_048);
const modelIdSchema = z.string().trim().min(1).max(512);
const modelDescriptorSchema = z
  .object({
    id: modelIdSchema,
    ownedBy: z.string().trim().min(1).max(512).nullable(),
    endpointTypes: z.array(z.enum(CHAT_ENDPOINT_TYPES)),
  })
  .strict();
const modelDescriptorsSchema = z
  .array(modelDescriptorSchema)
  .transform((models) => {
    const seen = new Set<string>();
    return models.filter(({ id }) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  });
const modelIdsSchema = z
  .array(modelIdSchema)
  .transform((modelIds) => [...new Set(modelIds)]);
const enabledModelIdsSchema = modelIdsSchema.pipe(
  z.array(modelIdSchema).min(1),
);
const cacheEntrySchema = z
  .object({
    models: modelDescriptorsSchema,
    enabledModelIds: enabledModelIdsSchema.nullable().default(null),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const modelListCacheSchema = z.record(connectionScopeSchema, cacheEntrySchema);

export interface ModelListState {
  discoveredModels: ModelDescriptor[];
  discoveredModelIds: string[];
  enabledModelIds: string[] | null;
}

export class ModelListCacheRepository {
  constructor(
    private readonly database: ChatDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async load(connectionScope: string): Promise<string[]> {
    return (await this.loadState(connectionScope)).discoveredModelIds;
  }

  async loadDescriptors(connectionScope: string): Promise<ModelDescriptor[]> {
    return (await this.loadState(connectionScope)).discoveredModels;
  }

  async loadState(connectionScope: string): Promise<ModelListState> {
    const scope = connectionScopeSchema.parse(connectionScope);
    try {
      const record = await this.database.settings.get(
        MODEL_LIST_CACHE_SETTINGS_KEY,
      );
      const parsed = modelListCacheSchema.safeParse(record?.value);
      const entry = parsed.success ? parsed.data[scope] : undefined;
      const discoveredModels = entry?.models ?? [];
      return {
        discoveredModels: structuredClone(discoveredModels),
        discoveredModelIds: discoveredModels.map(({ id }) => id),
        enabledModelIds: entry?.enabledModelIds
          ? [...entry.enabledModelIds]
          : null,
      };
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  async save(
    connectionScope: string,
    models: readonly ModelDescriptor[],
  ): Promise<ModelDescriptor[]> {
    const scope = connectionScopeSchema.parse(connectionScope);
    const normalizedModels = modelDescriptorsSchema.parse(models);
    const updatedAt = this.now();
    let savedModels: ModelDescriptor[] = [];

    try {
      await this.database.transaction(
        "rw",
        this.database.settings,
        async () => {
          const current = await this.database.settings.get(
            MODEL_LIST_CACHE_SETTINGS_KEY,
          );
          const parsed = modelListCacheSchema.safeParse(current?.value);
          const cache = parsed.success ? parsed.data : {};
          const currentEntry = cache[scope];
          const entry = cacheEntrySchema.parse({
            models: normalizedModels,
            enabledModelIds: currentEntry?.enabledModelIds ?? null,
            updatedAt,
          });
          const value = modelListCacheSchema.parse({
            ...cache,
            [scope]: entry,
          });
          await this.database.settings.put({
            key: MODEL_LIST_CACHE_SETTINGS_KEY,
            value,
            updatedAt,
          });
          savedModels = structuredClone(entry.models);
        },
      );
      return savedModels;
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  async saveEnabled(
    connectionScope: string,
    modelIds: readonly string[],
    discoveredModels: readonly ModelDescriptor[] = modelIds.map((id) => ({
      id,
      ownedBy: null,
      endpointTypes: [],
    })),
  ): Promise<string[]> {
    const scope = connectionScopeSchema.parse(connectionScope);
    const normalizedModelIds = enabledModelIdsSchema.parse(modelIds);
    const normalizedDiscoveredModels =
      modelDescriptorsSchema.parse(discoveredModels);
    const updatedAt = this.now();
    let savedModelIds: string[] = [];

    try {
      await this.database.transaction(
        "rw",
        this.database.settings,
        async () => {
          const current = await this.database.settings.get(
            MODEL_LIST_CACHE_SETTINGS_KEY,
          );
          const parsed = modelListCacheSchema.safeParse(current?.value);
          const cache = parsed.success ? parsed.data : {};
          const currentEntry = cache[scope];
          const entry = cacheEntrySchema.parse({
            models: currentEntry?.models ?? normalizedDiscoveredModels,
            enabledModelIds: normalizedModelIds,
            updatedAt,
          });
          const value = modelListCacheSchema.parse({
            ...cache,
            [scope]: entry,
          });
          await this.database.settings.put({
            key: MODEL_LIST_CACHE_SETTINGS_KEY,
            value,
            updatedAt,
          });
          savedModelIds = [...normalizedModelIds];
        },
      );
      return savedModelIds;
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  async clear(connectionScope: string): Promise<void> {
    const scope = connectionScopeSchema.parse(connectionScope);
    const updatedAt = this.now();
    try {
      await this.database.transaction(
        "rw",
        this.database.settings,
        async () => {
          const current = await this.database.settings.get(
            MODEL_LIST_CACHE_SETTINGS_KEY,
          );
          const parsed = modelListCacheSchema.safeParse(current?.value);
          if (!parsed.success || !parsed.data[scope]) return;
          const value = { ...parsed.data };
          delete value[scope];
          await this.database.settings.put({
            key: MODEL_LIST_CACHE_SETTINGS_KEY,
            value: modelListCacheSchema.parse(value),
            updatedAt,
          });
        },
      );
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }
}
