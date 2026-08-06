import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AssistantRepository } from "@/storage/assistant-repository";
import { exportBackupArchive, prepareBackupImport } from "@/storage/backup";
import { ChatDatabase } from "@/storage/database";
import type { ModelDescriptor } from "@/runtime/chat/types";
import {
  MODEL_LIST_CACHE_SETTINGS_KEY,
  ModelListCacheRepository,
} from "@/storage/model-list-cache-repository";

const timestamp = "2026-07-22T00:00:00.000Z";

describe("ModelListCacheRepository", () => {
  let database: ChatDatabase;
  let repository: ModelListCacheRepository;

  beforeEach(() => {
    database = new ChatDatabase(`model-list-cache-${crypto.randomUUID()}`);
    repository = new ModelListCacheRepository(database, () => timestamp);
  });

  afterEach(async () => {
    await database.delete();
  });

  it("keeps normalized model lists isolated by connection scope", async () => {
    await Promise.all([
      repository.save("byok:https://one.example", [
        descriptor(" model-a "),
        descriptor("model-b", ["gemini"]),
        descriptor("model-a"),
      ]),
      repository.save("byok:https://two.example", descriptors("model-c")),
    ]);

    await expect(repository.load("byok:https://one.example")).resolves.toEqual([
      "model-a",
      "model-b",
    ]);
    await expect(repository.load("byok:https://two.example")).resolves.toEqual([
      "model-c",
    ]);
    await expect(repository.load("hosted:same-origin")).resolves.toEqual([]);
  });

  it("replaces only the selected scope", async () => {
    await repository.save("byok:https://one.example", descriptors("model-a"));
    await repository.save("byok:https://two.example", descriptors("model-b"));

    await expect(
      repository.save("byok:https://one.example", descriptors(" model-new ")),
    ).resolves.toEqual(descriptors("model-new"));
    await expect(repository.load("byok:https://one.example")).resolves.toEqual([
      "model-new",
    ]);
    await expect(repository.load("byok:https://two.example")).resolves.toEqual([
      "model-b",
    ]);
  });

  it("keeps discovered and user-enabled models as separate projections", async () => {
    await repository.save(
      "byok:https://one.example",
      descriptors("model-a", "model-b", "model-c"),
    );

    await expect(
      repository.loadState("byok:https://one.example"),
    ).resolves.toEqual({
      discoveredModels: descriptors("model-a", "model-b", "model-c"),
      discoveredModelIds: ["model-a", "model-b", "model-c"],
      enabledModelIds: null,
    });

    await expect(
      repository.saveEnabled("byok:https://one.example", [
        " model-a ",
        "model-c",
        "model-a",
      ]),
    ).resolves.toEqual(["model-a", "model-c"]);
    await expect(
      repository.loadState("byok:https://one.example"),
    ).resolves.toEqual({
      discoveredModels: descriptors("model-a", "model-b", "model-c"),
      discoveredModelIds: ["model-a", "model-b", "model-c"],
      enabledModelIds: ["model-a", "model-c"],
    });
  });

  it("preserves enabled models when discovery is refreshed", async () => {
    await repository.save(
      "byok:https://one.example",
      descriptors("model-a", "model-b"),
    );
    await repository.saveEnabled("byok:https://one.example", ["model-a"]);

    await repository.save(
      "byok:https://one.example",
      descriptors("model-a", "model-new"),
    );

    await expect(
      repository.loadState("byok:https://one.example"),
    ).resolves.toEqual({
      discoveredModels: descriptors("model-a", "model-new"),
      discoveredModelIds: ["model-a", "model-new"],
      enabledModelIds: ["model-a"],
    });
  });

  it("keeps the full discovered list when enablement is saved first", async () => {
    await repository.saveEnabled(
      "hosted:same-origin",
      ["model-a"],
      descriptors("model-a", "model-b", "model-c"),
    );

    await expect(repository.loadState("hosted:same-origin")).resolves.toEqual({
      discoveredModels: descriptors("model-a", "model-b", "model-c"),
      discoveredModelIds: ["model-a", "model-b", "model-c"],
      enabledModelIds: ["model-a"],
    });
  });

  it("clears only the selected scope and ignores a missing scope", async () => {
    await repository.save("byok:https://one.example", descriptors("model-a"));
    await repository.save("byok:https://two.example", descriptors("model-b"));

    await repository.clear("byok:https://one.example");

    await expect(repository.load("byok:https://one.example")).resolves.toEqual(
      [],
    );
    await expect(repository.load("byok:https://two.example")).resolves.toEqual([
      "model-b",
    ]);

    const persisted = await database.settings.get(
      MODEL_LIST_CACHE_SETTINGS_KEY,
    );
    await repository.clear("byok:https://missing.example");
    await expect(
      database.settings.get(MODEL_LIST_CACHE_SETTINGS_KEY),
    ).resolves.toEqual(persisted);
  });

  it("returns an empty list for a damaged persisted cache", async () => {
    await database.settings.put({
      key: MODEL_LIST_CACHE_SETTINGS_KEY,
      value: { damaged: true },
      updatedAt: timestamp,
    });

    await expect(repository.load("byok:https://one.example")).resolves.toEqual(
      [],
    );
  });

  it("rejects empty and oversized model IDs", async () => {
    await expect(
      repository.save("byok:https://one.example", descriptors("   ")),
    ).rejects.toThrow();
    await expect(
      repository.save("byok:https://one.example", descriptors("x".repeat(513))),
    ).rejects.toThrow();
    await expect(
      repository.save("byok:https://one.example", descriptors("x".repeat(512))),
    ).resolves.toEqual(descriptors("x".repeat(512)));
    await expect(
      repository.saveEnabled("byok:https://one.example", []),
    ).rejects.toThrow();
  });

  it("stores the cache under the fixed settings key included in backups", async () => {
    await new AssistantRepository(database, {
      now: () => timestamp,
    }).ensureDefault();
    await repository.save("byok:https://one.example", descriptors("model-a"));

    const prepared = await prepareBackupImport(
      await exportBackupArchive(database, () => timestamp),
    );
    expect(prepared.manifest.settings).toContainEqual({
      key: MODEL_LIST_CACHE_SETTINGS_KEY,
      value: {
        "byok:https://one.example": {
          models: descriptors("model-a"),
          enabledModelIds: null,
          updatedAt: timestamp,
        },
      },
      updatedAt: timestamp,
    });
  });
});

function descriptors(...ids: string[]): ModelDescriptor[] {
  return ids.map((id) => descriptor(id));
}

function descriptor(
  id: string,
  endpointTypes: ModelDescriptor["endpointTypes"] = [],
): ModelDescriptor {
  return { id, ownedBy: null, endpointTypes };
}
