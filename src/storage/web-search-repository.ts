import { z } from "zod";

import {
  WEB_SEARCH_PROVIDER_IDS,
  type GrokWebSearchProviderConfiguration,
  type StandardWebSearchProviderConfiguration,
  type WebSearchCredentialRecord,
  type WebSearchConfiguration,
  type WebSearchProviderId,
  type WebSearchProviderConfigurations,
  type WebSearchSaveInput,
  type WebSearchSettings,
} from "@/runtime/chat/types";
import {
  DEFAULT_EXA_BASE_URL,
  normalizeExaBaseUrl,
} from "@/runtime/tools/exa-url";
import {
  DEFAULT_GROK_MODEL,
  DEFAULT_GROK_RESPONSES_URL,
  normalizeGrokResponsesUrl,
} from "@/runtime/tools/grok-url";
import {
  WEB_SEARCH_RESULT_COUNT,
  WEB_SEARCH_SETTINGS_KEY,
} from "@/runtime/tools/web-search-settings";
import {
  DEFAULT_TAVILY_BASE_URL,
  normalizeTavilyBaseUrl,
} from "@/runtime/tools/tavily-url";
import type { ChatDatabase } from "@/storage/database";
import { normalizeStorageError } from "@/storage/errors";

export { WEB_SEARCH_SETTINGS_KEY };

const providerSchema = z.enum(WEB_SEARCH_PROVIDER_IDS);
const settingsSchema = z
  .object({
    enabled: z.boolean(),
    maxResults: z
      .number()
      .int()
      .min(WEB_SEARCH_RESULT_COUNT.min)
      .max(WEB_SEARCH_RESULT_COUNT.max),
    provider: providerSchema,
    hostedProvider: providerSchema.nullable().optional(),
  })
  .strict();
const apiKeySchema = z.string().trim().min(8).max(2_048);
const modelSchema = z.string().trim().min(1).max(512);

export type { WebSearchConfiguration, WebSearchSaveInput };

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
      const [settingsRecord, credentials] = await Promise.all([
        this.database.settings.get(WEB_SEARCH_SETTINGS_KEY),
        this.database.webSearchCredentials.bulkGet([
          ...WEB_SEARCH_PROVIDER_IDS,
        ]),
      ]);
      const parsedSettings = settingsSchema.safeParse(settingsRecord?.value);
      const provider = parsedSettings.success
        ? parsedSettings.data.provider
        : "tavily";
      const providers = parseProviderConfigurations(credentials);
      const settings = parsedSettings.success
        ? {
            ...parsedSettings.data,
            hostedProvider: parsedSettings.data.hostedProvider ?? null,
          }
        : {
            enabled: defaultEnabled || providers[provider].hasApiKey,
            maxResults: WEB_SEARCH_RESULT_COUNT.default,
            provider,
            hostedProvider: null,
          };
      return {
        ...settings,
        providers,
        hasApiKey: providers[settings.provider].hasApiKey,
      };
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }

  async save(input: WebSearchSaveInput): Promise<WebSearchConfiguration> {
    const parsedSettings = settingsSchema.parse({
      enabled: input.enabled,
      maxResults: input.maxResults,
      provider: input.provider,
      hostedProvider: input.hostedProvider,
    });
    const settings = {
      ...parsedSettings,
      hostedProvider: parsedSettings.hostedProvider ?? null,
    } satisfies WebSearchSettings;
    const providers = parseSaveInput(input.providers);
    const updatedAt = this.now();
    const credentials = providerCredentials(providers, updatedAt);
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
          for (const provider of WEB_SEARCH_PROVIDER_IDS) {
            const credential = credentials.get(provider);
            if (credential) {
              await this.database.webSearchCredentials.put(credential);
            } else {
              await this.database.webSearchCredentials.delete(provider);
            }
          }
        },
      );
      return {
        ...settings,
        providers,
        hasApiKey: providers[settings.provider].hasApiKey,
      };
    } catch (cause) {
      throw normalizeStorageError(cause);
    }
  }
}

function parseProviderConfigurations(
  credentials: readonly (WebSearchCredentialRecord | undefined)[],
): WebSearchProviderConfigurations {
  const byProvider = new Map(
    credentials.flatMap((credential) =>
      credential ? ([[credential.id, credential]] as const) : [],
    ),
  );
  return {
    tavily: parseStandardCredential(byProvider.get("tavily"), "tavily"),
    exa: parseStandardCredential(byProvider.get("exa"), "exa"),
    grok: parseGrokCredential(byProvider.get("grok")),
  };
}

function parseStandardCredential(
  credential: WebSearchCredentialRecord | undefined,
  provider: "tavily" | "exa",
): StandardWebSearchProviderConfiguration {
  const defaultBaseUrl =
    provider === "tavily" ? DEFAULT_TAVILY_BASE_URL : DEFAULT_EXA_BASE_URL;
  if (!credential || credential.id !== provider || !("baseUrl" in credential)) {
    return { apiKey: "", baseUrl: defaultBaseUrl, hasApiKey: false };
  }
  const apiKey = apiKeySchema.safeParse(credential.apiKey);
  if (!apiKey.success) {
    return { apiKey: "", baseUrl: defaultBaseUrl, hasApiKey: false };
  }
  try {
    const baseUrl =
      provider === "tavily"
        ? normalizeTavilyBaseUrl(credential.baseUrl)
        : normalizeExaBaseUrl(credential.baseUrl);
    return { apiKey: apiKey.data, baseUrl, hasApiKey: true };
  } catch {
    return { apiKey: "", baseUrl: defaultBaseUrl, hasApiKey: false };
  }
}

function parseGrokCredential(
  credential: WebSearchCredentialRecord | undefined,
): GrokWebSearchProviderConfiguration {
  const fallback = defaultGrokConfiguration();
  if (!credential || credential.id !== "grok") return fallback;
  const apiKey = apiKeySchema.safeParse(credential.apiKey);
  const model = modelSchema.safeParse(credential.model);
  if (!apiKey.success || !model.success) return fallback;
  try {
    return {
      apiKey: apiKey.data,
      responsesUrl: normalizeGrokResponsesUrl(credential.responsesUrl),
      model: model.data,
      xSearch: credential.xSearch,
      hasApiKey: true,
    };
  } catch {
    return fallback;
  }
}

function parseSaveInput(
  input: WebSearchSaveInput["providers"],
): WebSearchProviderConfigurations {
  return {
    tavily: parseStandardSaveInput(input.tavily, "tavily"),
    exa: parseStandardSaveInput(input.exa, "exa"),
    grok: parseGrokSaveInput(input.grok),
  };
}

function parseStandardSaveInput(
  input: WebSearchSaveInput["providers"]["tavily"],
  provider: "tavily" | "exa",
): StandardWebSearchProviderConfiguration {
  const apiKey = input.apiKey.trim();
  const defaultBaseUrl =
    provider === "tavily" ? DEFAULT_TAVILY_BASE_URL : DEFAULT_EXA_BASE_URL;
  if (!apiKey) {
    return { apiKey: "", baseUrl: defaultBaseUrl, hasApiKey: false };
  }
  apiKeySchema.parse(apiKey);
  return {
    apiKey,
    baseUrl:
      provider === "tavily"
        ? normalizeTavilyBaseUrl(input.baseUrl)
        : normalizeExaBaseUrl(input.baseUrl),
    hasApiKey: true,
  };
}

function parseGrokSaveInput(
  input: WebSearchSaveInput["providers"]["grok"],
): GrokWebSearchProviderConfiguration {
  const apiKey = input.apiKey.trim();
  if (!apiKey) return defaultGrokConfiguration();
  return {
    apiKey: apiKeySchema.parse(apiKey),
    responsesUrl: normalizeGrokResponsesUrl(input.responsesUrl),
    model: modelSchema.parse(input.model),
    xSearch: z.boolean().parse(input.xSearch),
    hasApiKey: true,
  };
}

function providerCredentials(
  providers: WebSearchProviderConfigurations,
  updatedAt: string,
): Map<WebSearchProviderId, WebSearchCredentialRecord> {
  const records = new Map<WebSearchProviderId, WebSearchCredentialRecord>();
  if (providers.tavily.hasApiKey) {
    records.set("tavily", {
      id: "tavily",
      apiKey: providers.tavily.apiKey,
      baseUrl: providers.tavily.baseUrl,
      encrypted: false,
      updatedAt,
    });
  }
  if (providers.exa.hasApiKey) {
    records.set("exa", {
      id: "exa",
      apiKey: providers.exa.apiKey,
      baseUrl: providers.exa.baseUrl,
      encrypted: false,
      updatedAt,
    });
  }
  if (providers.grok.hasApiKey) {
    records.set("grok", {
      id: "grok",
      apiKey: providers.grok.apiKey,
      responsesUrl: providers.grok.responsesUrl,
      model: providers.grok.model,
      xSearch: providers.grok.xSearch,
      encrypted: false,
      updatedAt,
    });
  }
  return records;
}

function defaultGrokConfiguration(): GrokWebSearchProviderConfiguration {
  return {
    apiKey: "",
    responsesUrl: DEFAULT_GROK_RESPONSES_URL,
    model: DEFAULT_GROK_MODEL,
    xSearch: false,
    hasApiKey: false,
  };
}
