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
  it("stores settings in backup-visible settings and keeps the key in meta", async () => {
    const database = createDatabase();
    const repository = new ImageGenerationRepository(
      database,
      () => "2026-08-13T00:00:00.000Z",
    );

    const saved = await repository.save({
      generationUrl: "https://images.example.test/v1/images/generations/",
      editUrl: "https://images.example.test/v1/images/edits/",
      apiKey: "sk-test-image-key",
      modelId: " gpt-image-test ",
      size: "1024x1024",
      quality: "high",
    });

    expect(saved).toMatchObject({
      generationUrl: "https://images.example.test/v1/images/generations",
      editUrl: "https://images.example.test/v1/images/edits",
      modelId: "gpt-image-test",
      hasApiKey: true,
    });
    expect(
      await database.settings.get(IMAGE_GENERATION_SETTINGS_KEY),
    ).toBeDefined();
    expect(JSON.stringify(await database.settings.toArray())).not.toContain(
      "sk-test-image-key",
    );
    await expect(repository.load()).resolves.toEqual(saved);
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
