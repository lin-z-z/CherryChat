import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AssistantRepository } from "@/storage/assistant-repository";
import { exportBackupArchive, prepareBackupImport } from "@/storage/backup";
import { ChatDatabase } from "@/storage/database";
import {
  WEB_SEARCH_SETTINGS_KEY,
  WebSearchRepository,
} from "@/storage/web-search-repository";

const timestamp = "2026-07-26T00:00:00.000Z";

describe("WebSearchRepository", () => {
  let database: ChatDatabase;
  let repository: WebSearchRepository;

  beforeEach(() => {
    database = new ChatDatabase(`web-search-${crypto.randomUUID()}`);
    repository = new WebSearchRepository(database, () => timestamp);
  });

  afterEach(async () => database.delete());

  it("loads disabled defaults and round-trips Tavily configuration", async () => {
    await expect(repository.load()).resolves.toEqual({
      enabled: false,
      maxResults: 5,
      apiKey: "",
      baseUrl: "https://api.tavily.com",
      hasApiKey: false,
    });

    await expect(
      repository.save({
        enabled: true,
        maxResults: 6,
        apiKey: "tvly-browser-secret",
        baseUrl: "https://search.example/tavily/search",
      }),
    ).resolves.toEqual({
      enabled: true,
      maxResults: 6,
      apiKey: "tvly-browser-secret",
      baseUrl: "https://search.example/tavily",
      hasApiKey: true,
    });
    await expect(repository.load()).resolves.toMatchObject({
      enabled: true,
      maxResults: 6,
      baseUrl: "https://search.example/tavily",
      hasApiKey: true,
    });
  });

  it("uses source-aware defaults only until the user saves a preference", async () => {
    await expect(
      repository.load({ defaultEnabled: true }),
    ).resolves.toMatchObject({ enabled: true, hasApiKey: false });

    await repository.save({
      enabled: false,
      maxResults: 5,
      apiKey: "",
      baseUrl: "https://api.tavily.com",
    });
    await expect(
      repository.load({ defaultEnabled: true }),
    ).resolves.toMatchObject({ enabled: false, hasApiKey: false });
  });

  it("defaults to enabled when a valid personal credential exists", async () => {
    await database.webSearchCredentials.put({
      id: "tavily",
      apiKey: "tvly-browser-secret",
      baseUrl: "https://search.example/tavily",
      encrypted: false,
      updatedAt: timestamp,
    });

    await expect(repository.load()).resolves.toMatchObject({
      enabled: true,
      hasApiKey: true,
    });
  });

  it("keeps the key out of backup data", async () => {
    await new AssistantRepository(database, {
      now: () => timestamp,
    }).ensureDefault();
    await repository.save({
      enabled: true,
      maxResults: 5,
      apiKey: "tvly-backup-secret",
      baseUrl: "https://private-search.example/tavily",
    });

    const archive = await exportBackupArchive(database, () => timestamp);
    const prepared = await prepareBackupImport(archive);
    expect(JSON.stringify(prepared.manifest)).not.toContain(
      "tvly-backup-secret",
    );
    expect(JSON.stringify(prepared.manifest)).not.toContain(
      "private-search.example",
    );
    expect(prepared.manifest.settings).toContainEqual({
      key: WEB_SEARCH_SETTINGS_KEY,
      value: { enabled: true, maxResults: 5 },
      updatedAt: timestamp,
    });
  });

  it("allows hosted web search settings without storing a browser key", async () => {
    await expect(
      repository.save({
        enabled: true,
        maxResults: 5,
        apiKey: "",
        baseUrl: "https://ignored.example",
      }),
    ).resolves.toEqual({
      enabled: true,
      maxResults: 5,
      apiKey: "",
      baseUrl: "https://api.tavily.com",
      hasApiKey: false,
    });
    await expect(database.webSearchCredentials.count()).resolves.toBe(0);
  });

  it("accepts the Cherry Studio result limit and rejects values outside it", async () => {
    await expect(
      repository.save({
        enabled: true,
        maxResults: 50,
        apiKey: "",
        baseUrl: "https://api.tavily.com",
      }),
    ).resolves.toMatchObject({ maxResults: 50 });

    await expect(
      repository.save({
        enabled: true,
        maxResults: 51,
        apiKey: "",
        baseUrl: "https://api.tavily.com",
      }),
    ).rejects.toThrow();
  });

  it("ignores a damaged browser key so hosted search can remain available", async () => {
    await database.webSearchCredentials.put({
      id: "tavily",
      apiKey: "bad",
      baseUrl: "not-a-url",
      encrypted: false,
      updatedAt: timestamp,
    });

    await expect(repository.load()).resolves.toMatchObject({
      apiKey: "",
      baseUrl: "https://api.tavily.com",
      hasApiKey: false,
    });
  });
});
