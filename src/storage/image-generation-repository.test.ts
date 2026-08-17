import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { ChatDatabase } from "@/storage/database";
import {
  IMAGE_GENERATION_SETTINGS_KEY,
  ImageGenerationRepository,
} from "@/storage/image-generation-repository";

const databases: ChatDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.map((database) => database.delete()));
  databases.length = 0;
});

describe("ImageGenerationRepository", () => {
  it("stores multiple profiles and keeps every key outside backup-visible settings", async () => {
    const database = createDatabase();
    const repository = new ImageGenerationRepository(
      database,
      () => "2026-08-16T00:00:00.000Z",
    );

    const saved = await repository.save({
      profiles: [
        profile("primary", "gpt-image-2", "sk-primary-image-key"),
        profile("legacy", "gpt-image-1.5", "sk-legacy-image-key", "fixed"),
      ],
      defaultProfileId: "primary",
    });

    expect(saved.profiles).toHaveLength(2);
    expect(saved.defaultProfileId).toBe("primary");
    expect(saved.profiles[1]).toMatchObject({
      id: "legacy",
      modelId: "gpt-image-1.5",
      hasApiKey: true,
      sizeMode: "fixed",
    });
    const portable = JSON.stringify(await database.settings.toArray());
    expect(portable).not.toContain("sk-primary-image-key");
    expect(portable).not.toContain("sk-legacy-image-key");
    await expect(repository.load()).resolves.toEqual(saved);
  });

  it("migrates a legacy single profile without losing its key or parameters", async () => {
    const database = createDatabase();
    await database.settings.put({
      key: IMAGE_GENERATION_SETTINGS_KEY,
      value: {
        generationUrl: "https://images.example.test/v1/images/generations",
        editUrl: "https://images.example.test/v1/images/edits",
        modelId: "gpt-image-1.5",
        size: "1536x1024",
        quality: "high",
      },
      updatedAt: "2026-08-13T00:00:00.000Z",
    });
    await database.meta.put({
      key: "image-generation-credential",
      value: { apiKey: "sk-legacy-image-key" },
      updatedAt: "2026-08-13T00:00:00.000Z",
    });

    const loaded = await new ImageGenerationRepository(database).load();

    expect(loaded.profiles[0]).toMatchObject({
      modelId: "gpt-image-1.5",
      apiKey: "sk-legacy-image-key",
    });
    expect(loaded.parametersByProfile[loaded.activeProfileId]).toMatchObject({
      resolutionTier: "1K",
      aspectRatio: "3:2",
      size: "1536x1024",
      quality: "high",
    });
  });

  it("persists active profile and normalized recent parameters independently", async () => {
    const database = createDatabase();
    const repository = new ImageGenerationRepository(database);
    await repository.save({
      profiles: [
        profile("custom", "gpt-image-2", "sk-custom-image-key"),
        profile("fixed", "gpt-image-1.5", "sk-fixed-image-key", "fixed"),
      ],
      defaultProfileId: "custom",
    });

    const customProfile = (await repository.load()).profiles[0];
    if (!customProfile) throw new Error("Missing test profile");
    await repository.saveParameters(customProfile, {
      resolutionTier: "4K",
      aspectRatio: "9:16",
      size: "2160x3840",
      quality: "high",
      outputFormat: "webp",
      outputCompression: 82,
    });
    const selected = await repository.selectProfile("fixed");

    expect(selected.activeProfileId).toBe("fixed");
    expect(selected.parametersByProfile.custom).toMatchObject({
      size: "2160x3840",
      outputFormat: "webp",
      outputCompression: 82,
    });
    expect(selected.parametersByProfile.fixed).toMatchObject({
      resolutionTier: "1K",
      aspectRatio: "1:1",
    });
  });
});

function profile(
  id: string,
  modelId: string,
  apiKey: string,
  sizeMode: "auto" | "fixed" | "custom" = "auto",
) {
  return {
    id,
    name: id,
    mode: "byok" as const,
    baseUrl: "https://images.example.test/v1",
    apiKey,
    modelId,
    sizeMode,
    hasApiKey: true,
  };
}

function createDatabase(): ChatDatabase {
  const database = new ChatDatabase(`image-generation-${crypto.randomUUID()}`, {
    indexedDB,
    IDBKeyRange,
  });
  databases.push(database);
  return database;
}
