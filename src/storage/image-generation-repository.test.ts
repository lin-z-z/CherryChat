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
  it("stores one fixed GPT Image 2 connection and keeps its key outside backup-visible settings", async () => {
    const database = createDatabase();
    const repository = new ImageGenerationRepository(
      database,
      () => "2026-08-16T00:00:00.000Z",
    );

    const saved = await repository.save({
      baseUrl: "https://images.example.test/v1",
      apiKey: "sk-primary-image-key",
    });

    expect(saved.profiles).toHaveLength(1);
    expect(saved.defaultProfileId).toBe("default-gpt-image-2");
    expect(saved.profiles[0]).toMatchObject({
      id: "default-gpt-image-2",
      name: "GPT Image 2",
      baseUrl: "https://images.example.test/v1",
      modelId: "gpt-image-2",
      hasApiKey: true,
      sizeMode: "auto",
    });
    const portable = JSON.stringify(await database.settings.toArray());
    expect(portable).not.toContain("sk-primary-image-key");
    expect(portable).toContain('"version":4');
    await expect(repository.load()).resolves.toEqual(saved);
  });

  it("ignores obsolete local image profiles and credentials", async () => {
    const database = createDatabase();
    await database.settings.put({
      key: IMAGE_GENERATION_SETTINGS_KEY,
      value: {
        version: 3,
        profiles: [
          {
            id: "old-profile",
            name: "Old profile",
            baseUrl: "https://old-images.example.test",
            modelId: "gpt-image-1.5",
            sizeMode: "fixed",
          },
        ],
        defaultProfileId: "old-profile",
        activeProfileId: "old-profile",
        activeHostedProfileId: null,
        parametersByProfile: {},
      },
      updatedAt: "2026-08-13T00:00:00.000Z",
    });
    await database.meta.put({
      key: "image-generation-credentials.v2",
      value: {
        version: 2,
        apiKeys: { "old-profile": "sk-legacy-image-key" },
      },
      updatedAt: "2026-08-13T00:00:00.000Z",
    });

    const loaded = await new ImageGenerationRepository(database).load();

    expect(loaded.profiles[0]).toMatchObject({
      baseUrl: "https://api.openai.com",
      modelId: "gpt-image-2",
      apiKey: "",
      hasApiKey: false,
    });
    await expect(
      database.meta.get("image-generation-credential.v4"),
    ).resolves.toBeUndefined();
  });

  it("persists BYOK and Hosted parameters independently", async () => {
    const database = createDatabase();
    const repository = new ImageGenerationRepository(database);
    await repository.save({
      baseUrl: "https://images.example.test/v1",
      apiKey: "sk-custom-image-key",
    });

    const byokProfile = (await repository.load()).profiles[0];
    if (!byokProfile) throw new Error("Missing test profile");
    await repository.saveParameters(byokProfile, {
      resolutionTier: "4K",
      aspectRatio: "9:16",
      size: "2160x3840",
      quality: "high",
      outputFormat: "webp",
      outputCompression: 82,
    });
    await repository.selectHostedProfile("hosted-image");
    const saved = await repository.saveParameters(
      {
        id: "hosted-image",
        mode: "hosted",
        modelId: "gpt-image-2",
        sizeMode: "auto",
      },
      {
        resolutionTier: "1K",
        aspectRatio: "1:1",
        size: "1024x1024",
        quality: "auto",
        outputFormat: "png",
        outputCompression: null,
      },
    );

    expect(saved.activeHostedProfileId).toBe("hosted-image");
    expect(saved.parametersByProfile["default-gpt-image-2"]).toMatchObject({
      size: "2160x3840",
      outputFormat: "webp",
      outputCompression: 82,
    });
    expect(saved.parametersByProfile["hosted-image"]).toMatchObject({
      size: "1024x1024",
      outputFormat: "png",
    });
  });
});

function createDatabase(): ChatDatabase {
  const database = new ChatDatabase(`image-generation-${crypto.randomUUID()}`, {
    indexedDB,
    IDBKeyRange,
  });
  databases.push(database);
  return database;
}
