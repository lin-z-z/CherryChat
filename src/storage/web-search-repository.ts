import { z } from "zod";

import type {
  WebSearchCredentialRecord,
  WebSearchSettings,
} from "@/runtime/chat/types";
import type { ChatDatabase } from "@/storage/database";
import { normalizeStorageError } from "@/storage/errors";
import {
  DEFAULT_TAVILY_BASE_URL,
  normalizeTavilyBaseUrl,
} from "@/runtime/tools/tavily-url";
import { WEB_SEARCH_RESULT_COUNT } from "@/runtime/tools/web-search-settings";

export const WEB_SEARCH_SETTINGS_KEY = "webSearch.v1";

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    maxResults: z
      .number()
      .int()
      .min(WEB_SEARCH_RESULT_COUNT.min)
      .max(WEB_SEARCH_RESULT_COUNT.max),
  })
  .strict();
const apiKeySchema = z.string().trim().min(8).max(2_048);
const baseUrlSchema = z.string().trim().min(1).max(2_048);

export interface WebSearchConfiguration extends WebSearchSettings {
  apiKey: string;
  baseUrl: string;
  hasApiKey: boolean;
}

export interface WebSearchLoadOptions {
  defaultEnabled?: boolean;
}

export class WebSearchRepository {
  constructor(
    private readonly database: ChatDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async load({
    defaultEnabled = false,
  }: WebSearchLoadOptions = {}): Promise<WebSearchConfiguration> {
    try {
      const [settingsRecord, credential] = await Promise.all([
        this.database.settings.get(WEB_SEARCH_SETTINGS_KEY),
        this.database.webSearchCredentials.get("tavily"),
      ]);
      const parsed = settingsSchema.safeParse(settingsRecord?.value);
      const parsedCredential = parseCredential(credential);
      const settings = parsed.success
        ? parsed.data
        : {
            enabled: defaultEnabled || parsedCredential !== null,
            maxResults: WEB_SEARCH_RESULT_COUNT.default,
          };
      return {
        ...settings,
        apiKey: parsedCredential?.apiKey ?? "",
        baseUrl: parsedCredential?.baseUrl ?? DEFAULT_TAVILY_BASE_URL,
        hasApiKey: parsedCredential !== null,
      };
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  async save(input: {
    enabled: boolean;
    maxResults: number;
    apiKey: string;
    baseUrl: string;
  }): Promise<WebSearchConfiguration> {
    const settings = settingsSchema.parse({
      enabled: input.enabled,
      maxResults: input.maxResults,
    });
    const apiKey = input.apiKey.trim();
    if (apiKey) apiKeySchema.parse(apiKey);
    const baseUrl = apiKey
      ? normalizeTavilyBaseUrl(baseUrlSchema.parse(input.baseUrl))
      : DEFAULT_TAVILY_BASE_URL;
    const updatedAt = this.now();
    try {
      await this.database.transaction(
        "rw",
        this.database.settings,
        this.database.webSearchCredentials,
        async () => {
          await this.database.settings.put({
            key: WEB_SEARCH_SETTINGS_KEY,
            value: settings,
            updatedAt,
          });
          if (apiKey) {
            const credential: WebSearchCredentialRecord = {
              id: "tavily",
              apiKey,
              baseUrl,
              encrypted: false,
              updatedAt,
            };
            await this.database.webSearchCredentials.put(credential);
          } else {
            await this.database.webSearchCredentials.delete("tavily");
          }
        },
      );
      return {
        ...settings,
        apiKey,
        baseUrl,
        hasApiKey: Boolean(apiKey),
      };
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }
}

function parseCredential(
  credential: WebSearchCredentialRecord | undefined,
): { apiKey: string; baseUrl: string } | null {
  const apiKey = apiKeySchema.safeParse(credential?.apiKey);
  const baseUrl = baseUrlSchema.safeParse(credential?.baseUrl);
  if (!apiKey.success || !baseUrl.success) return null;
  try {
    return {
      apiKey: apiKey.data,
      baseUrl: normalizeTavilyBaseUrl(baseUrl.data),
    };
  } catch {
    return null;
  }
}
