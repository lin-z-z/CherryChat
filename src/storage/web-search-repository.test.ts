import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WebSearchCredentialRecord } from "@/runtime/chat/types";
import { DEFAULT_EXA_BASE_URL } from "@/runtime/tools/exa-url";
import {
  DEFAULT_GROK_MODEL,
  DEFAULT_GROK_RESPONSES_URL,
} from "@/runtime/tools/grok-url";
import { DEFAULT_TAVILY_BASE_URL } from "@/runtime/tools/tavily-url";
import { AssistantRepository } from "@/storage/assistant-repository";
import { exportBackupArchive, prepareBackupImport } from "@/storage/backup";
import { ChatDatabase } from "@/storage/database";
import {
  WEB_SEARCH_SETTINGS_KEY,
  WebSearchRepository,
  type WebSearchSaveInput,
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

  it("loads disabled Tavily defaults and round-trips all provider configurations", async () => {
    await expect(repository.load()).resolves.toEqual({
      enabled: false,
      maxResults: 5,
      provider: "tavily",
      hostedProvider: null,
      providers: defaultProviders(),
      hasApiKey: false,
    });

    const saved = await repository.save(
      searchInput({
        enabled: true,
        maxResults: 6,
        provider: "grok",
        hostedProvider: "exa",
        providers: {
          tavily: {
            apiKey: "tvly-browser-secret",
            baseUrl: "https://search.example/tavily/search",
          },
          exa: {
            apiKey: "exa-browser-secret",
            baseUrl: "https://search.example/exa/search",
          },
          grok: {
            apiKey: "grok-browser-secret",
            responsesUrl: "https://responses.example/v1/responses/",
            model: "grok-custom",
            xSearch: true,
          },
        },
      }),
    );

    expect(saved).toEqual({
      enabled: true,
      maxResults: 6,
      provider: "grok",
      hostedProvider: "exa",
      providers: {
        tavily: {
          apiKey: "tvly-browser-secret",
          baseUrl: "https://search.example/tavily",
          hasApiKey: true,
        },
        exa: {
          apiKey: "exa-browser-secret",
          baseUrl: "https://search.example/exa",
          hasApiKey: true,
        },
        grok: {
          apiKey: "grok-browser-secret",
          responsesUrl: "https://responses.example/v1/responses",
          model: "grok-custom",
          xSearch: true,
          hasApiKey: true,
        },
      },
      hasApiKey: true,
    });
    await expect(repository.load()).resolves.toEqual(saved);
  });

  it("uses source-aware defaults only until the user saves a preference", async () => {
    await expect(
      repository.load({ defaultEnabled: true }),
    ).resolves.toMatchObject({ enabled: true, hasApiKey: false });

    await repository.save(searchInput({ enabled: false }));
    await expect(
      repository.load({ defaultEnabled: true }),
    ).resolves.toMatchObject({ enabled: false, hasApiKey: false });
  });

  it("defaults to enabled when the selected provider has a valid personal credential", async () => {
    const credential: WebSearchCredentialRecord = {
      id: "tavily",
      apiKey: "tvly-browser-secret",
      baseUrl: "https://search.example/tavily",
      encrypted: false,
      updatedAt: timestamp,
    };
    await database.webSearchCredentials.put(credential);

    await expect(repository.load()).resolves.toMatchObject({
      enabled: true,
      provider: "tavily",
      hasApiKey: true,
    });
  });

  it("keeps every provider credential and URL out of backup data", async () => {
    await new AssistantRepository(database, {
      now: () => timestamp,
    }).ensureDefault();
    await repository.save(
      searchInput({
        enabled: true,
        provider: "grok",
        providers: {
          tavily: {
            apiKey: "tvly-backup-secret",
            baseUrl: "https://private-search.example/tavily",
          },
          exa: {
            apiKey: "exa-backup-secret",
            baseUrl: "https://private-search.example/exa",
          },
          grok: {
            apiKey: "grok-backup-secret",
            responsesUrl: "https://private-search.example/responses",
            model: "grok-private",
            xSearch: true,
          },
        },
      }),
    );

    const archive = await exportBackupArchive(database, () => timestamp);
    const prepared = await prepareBackupImport(archive);
    const serialized = JSON.stringify(prepared.manifest);
    expect(serialized).not.toContain("backup-secret");
    expect(serialized).not.toContain("private-search.example");
    expect(serialized).not.toContain("grok-private");
    expect(prepared.manifest.settings).toContainEqual({
      key: WEB_SEARCH_SETTINGS_KEY,
      value: {
        enabled: true,
        maxResults: 5,
        provider: "grok",
        hostedProvider: null,
      },
      updatedAt: timestamp,
    });
  });

  it("allows hosted web search settings without storing browser credentials", async () => {
    await expect(
      repository.save(searchInput({ enabled: true, hostedProvider: "exa" })),
    ).resolves.toMatchObject({
      enabled: true,
      provider: "tavily",
      hostedProvider: "exa",
      hasApiKey: false,
    });
    await expect(database.webSearchCredentials.count()).resolves.toBe(0);
  });

  it("loads an older v2 record without a Hosted preference as null", async () => {
    await database.settings.put({
      key: WEB_SEARCH_SETTINGS_KEY,
      value: { enabled: true, maxResults: 7, provider: "grok" },
      updatedAt: timestamp,
    });

    await expect(repository.load()).resolves.toMatchObject({
      provider: "grok",
      hostedProvider: null,
    });
  });

  it("accepts the reviewed result limit and rejects values outside it", async () => {
    await expect(
      repository.save(searchInput({ enabled: true, maxResults: 50 })),
    ).resolves.toMatchObject({ maxResults: 50 });

    await expect(
      repository.save(searchInput({ enabled: true, maxResults: 51 })),
    ).rejects.toThrow();
  });

  it("ignores damaged credentials without hiding valid providers", async () => {
    const damaged: WebSearchCredentialRecord = {
      id: "tavily",
      apiKey: "bad",
      baseUrl: "not-a-url",
      encrypted: false,
      updatedAt: timestamp,
    };
    const valid: WebSearchCredentialRecord = {
      id: "grok",
      apiKey: "grok-browser-secret",
      responsesUrl: "https://responses.example/v1/responses",
      model: "grok-4.5",
      xSearch: false,
      encrypted: false,
      updatedAt: timestamp,
    };
    await database.webSearchCredentials.bulkPut([damaged, valid]);

    await expect(repository.load()).resolves.toMatchObject({
      provider: "tavily",
      hasApiKey: false,
      providers: {
        tavily: { apiKey: "", hasApiKey: false },
        grok: { apiKey: "grok-browser-secret", hasApiKey: true },
      },
    });
  });

  it("rejects unsafe active credential URLs before the transaction", async () => {
    await expect(
      repository.save(
        searchInput({
          provider: "grok",
          providers: {
            ...defaultProviderInputs(),
            grok: {
              apiKey: "grok-browser-secret",
              responsesUrl: "https://user:pass@responses.example/v1/responses",
              model: "grok-4.5",
              xSearch: false,
            },
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(database.settings.count()).resolves.toBe(0);
    await expect(database.webSearchCredentials.count()).resolves.toBe(0);
  });
});

function searchInput(
  overrides: Partial<WebSearchSaveInput> = {},
): WebSearchSaveInput {
  return {
    enabled: false,
    maxResults: 5,
    provider: "tavily",
    hostedProvider: null,
    providers: defaultProviderInputs(),
    ...overrides,
  };
}

function defaultProviderInputs(): WebSearchSaveInput["providers"] {
  return {
    tavily: { apiKey: "", baseUrl: DEFAULT_TAVILY_BASE_URL },
    exa: { apiKey: "", baseUrl: DEFAULT_EXA_BASE_URL },
    grok: {
      apiKey: "",
      responsesUrl: DEFAULT_GROK_RESPONSES_URL,
      model: DEFAULT_GROK_MODEL,
      xSearch: false,
    },
  };
}

function defaultProviders() {
  return {
    tavily: {
      apiKey: "",
      baseUrl: DEFAULT_TAVILY_BASE_URL,
      hasApiKey: false,
    },
    exa: {
      apiKey: "",
      baseUrl: DEFAULT_EXA_BASE_URL,
      hasApiKey: false,
    },
    grok: {
      apiKey: "",
      responsesUrl: DEFAULT_GROK_RESPONSES_URL,
      model: DEFAULT_GROK_MODEL,
      xSearch: false,
      hasApiKey: false,
    },
  };
}
