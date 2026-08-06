import { isIP } from "node:net";

import { z } from "zod";

import {
  DEFAULT_REQUEST_TIMEOUT_POLICY,
  type RequestTimeoutPolicy,
} from "@/runtime/transport/request-timeout-policy";
import {
  DEFAULT_TAVILY_BASE_URL,
  normalizeTavilyBaseUrl,
} from "@/runtime/tools/tavily-url";

const booleanStringSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const rawEnvironmentSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  BASE_URL: z.string().default("https://api.openai.com"),
  MODELS: z.string().optional(),
  DEFAULT_MODEL: z.string().optional(),
  TITLE_MODEL: z.string().optional(),
  ACCESS_CODE: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  TAVILY_BASE_URL: z.string().optional(),
  DISABLE_BYOK: booleanStringSchema,
  ALLOW_INSECURE_LOCAL_UPSTREAM: booleanStringSchema,
  NODE_ENV: z.string().optional(),
  MODEL_LIST_TIMEOUT_SECONDS: z.string().optional(),
  CHAT_FIRST_BYTE_TIMEOUT_SECONDS: z.string().optional(),
  CHAT_IDLE_TIMEOUT_SECONDS: z.string().optional(),
  CHAT_TOTAL_TIMEOUT_SECONDS: z.string().optional(),
});

export interface HostedServerConfig {
  apiKey: string;
  accessCodes: string[];
  authSecret: string;
  tavilyApiKey: string | null;
  tavilyBaseUrl: string | null;
}

export interface ServerConfig {
  baseUrl: string;
  models: string[];
  defaultModel: string | null;
  titleModel: string | null;
  disableByok: boolean;
  hosted: HostedServerConfig | null;
  requestTimeouts: RequestTimeoutPolicy;
}

export interface PublicServerConfig {
  byokEnabled: boolean;
  hostedEnabled: boolean;
  hostedWebSearchEnabled: boolean;
  models: string[];
  defaultModel: string | null;
  titleModel: string | null;
  requestTimeouts: RequestTimeoutPolicy;
}

export class ServerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerConfigurationError";
  }
}

export function parseServerConfig(
  environment: Record<string, string | undefined>,
): ServerConfig {
  const raw = rawEnvironmentSchema.parse(environment);
  const baseUrl = normalizeServerBaseUrl(raw.BASE_URL);
  const models = parseModels(raw.MODELS);
  const apiKey = nonEmpty(raw.OPENAI_API_KEY);
  const accessCodes = parseAccessCodes(raw.ACCESS_CODE);
  const authSecret = nonEmpty(raw.AUTH_SECRET);
  const tavilyApiKey = nonEmpty(raw.TAVILY_API_KEY?.trim());
  const rawTavilyBaseUrl = nonEmpty(raw.TAVILY_BASE_URL?.trim());
  const requestTimeouts = {
    modelListMs: parseTimeoutMilliseconds(
      "MODEL_LIST_TIMEOUT_SECONDS",
      raw.MODEL_LIST_TIMEOUT_SECONDS,
      DEFAULT_REQUEST_TIMEOUT_POLICY.modelListMs,
    ),
    chatFirstByteMs: parseTimeoutMilliseconds(
      "CHAT_FIRST_BYTE_TIMEOUT_SECONDS",
      raw.CHAT_FIRST_BYTE_TIMEOUT_SECONDS,
      DEFAULT_REQUEST_TIMEOUT_POLICY.chatFirstByteMs,
    ),
    chatIdleMs: parseTimeoutMilliseconds(
      "CHAT_IDLE_TIMEOUT_SECONDS",
      raw.CHAT_IDLE_TIMEOUT_SECONDS,
      DEFAULT_REQUEST_TIMEOUT_POLICY.chatIdleMs,
    ),
    chatTotalMs: parseTimeoutMilliseconds(
      "CHAT_TOTAL_TIMEOUT_SECONDS",
      raw.CHAT_TOTAL_TIMEOUT_SECONDS,
      DEFAULT_REQUEST_TIMEOUT_POLICY.chatTotalMs,
    ),
  } satisfies RequestTimeoutPolicy;
  const hostedFieldCount = [apiKey, accessCodes.length > 0, authSecret].filter(
    Boolean,
  ).length;

  if (hostedFieldCount !== 0 && hostedFieldCount !== 3) {
    throw new ServerConfigurationError(
      "OPENAI_API_KEY, ACCESS_CODE and AUTH_SECRET must be configured together",
    );
  }
  if (authSecret && new TextEncoder().encode(authSecret).byteLength < 32) {
    throw new ServerConfigurationError(
      "AUTH_SECRET must contain at least 32 UTF-8 bytes",
    );
  }
  if (
    accessCodes.some(
      (accessCode) => new TextEncoder().encode(accessCode).byteLength > 256,
    )
  ) {
    throw new ServerConfigurationError(
      "Every ACCESS_CODE value must contain at most 256 UTF-8 bytes",
    );
  }
  if (apiKey && models.length === 0) {
    throw new ServerConfigurationError(
      "MODELS must contain at least one model when hosted mode is enabled",
    );
  }

  const defaultModel = nonEmpty(raw.DEFAULT_MODEL) ?? models[0] ?? null;
  if (defaultModel && models.length > 0 && !models.includes(defaultModel)) {
    throw new ServerConfigurationError(
      "DEFAULT_MODEL must be included in MODELS",
    );
  }
  const configuredTitleModel = nonEmpty(raw.TITLE_MODEL);
  if (configuredTitleModel && !models.includes(configuredTitleModel)) {
    throw new ServerConfigurationError(
      "TITLE_MODEL must be included in MODELS",
    );
  }
  const titleModel = configuredTitleModel ?? defaultModel;
  if (raw.DISABLE_BYOK && !apiKey) {
    throw new ServerConfigurationError(
      "DISABLE_BYOK=true requires a complete hosted-mode configuration",
    );
  }
  if (
    tavilyApiKey &&
    (tavilyApiKey.length < 8 || tavilyApiKey.length > 2_048)
  ) {
    throw new ServerConfigurationError(
      "TAVILY_API_KEY must contain from 8 through 2048 characters",
    );
  }
  if (tavilyApiKey && hostedFieldCount !== 3) {
    throw new ServerConfigurationError(
      "TAVILY_API_KEY requires a complete hosted-mode configuration",
    );
  }
  const tavilyBaseUrl = tavilyApiKey
    ? normalizeServerTavilyBaseUrl(rawTavilyBaseUrl ?? DEFAULT_TAVILY_BASE_URL)
    : null;
  if (hostedFieldCount === 3) {
    assertHostedUpstreamSecurity(
      baseUrl,
      "BASE_URL",
      raw.NODE_ENV === "production",
      raw.ALLOW_INSECURE_LOCAL_UPSTREAM,
    );
    if (tavilyBaseUrl) {
      assertHostedUpstreamSecurity(
        tavilyBaseUrl,
        "TAVILY_BASE_URL",
        raw.NODE_ENV === "production",
        raw.ALLOW_INSECURE_LOCAL_UPSTREAM,
      );
    }
  }

  return {
    baseUrl,
    models,
    defaultModel,
    titleModel,
    disableByok: raw.DISABLE_BYOK,
    hosted:
      apiKey && accessCodes.length > 0 && authSecret
        ? {
            apiKey,
            accessCodes,
            authSecret,
            tavilyApiKey: tavilyApiKey ?? null,
            tavilyBaseUrl,
          }
        : null,
    requestTimeouts,
  };
}

export function getServerConfig(): ServerConfig {
  return parseServerConfig(process.env);
}

export function toPublicServerConfig(config: ServerConfig): PublicServerConfig {
  return {
    byokEnabled: !config.disableByok,
    hostedEnabled: config.hosted !== null,
    hostedWebSearchEnabled: Boolean(
      config.hosted?.tavilyApiKey && config.hosted.tavilyBaseUrl,
    ),
    models: config.hosted ? [...config.models] : [],
    defaultModel: config.hosted ? config.defaultModel : null,
    titleModel: config.hosted ? config.titleModel : null,
    requestTimeouts: { ...config.requestTimeouts },
  };
}

export function buildUpstreamUrl(
  config: Pick<ServerConfig, "baseUrl">,
  resource: "models" | "chat/completions",
): string {
  return `${config.baseUrl}/v1/${resource}`;
}

function normalizeServerBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServerConfigurationError("BASE_URL must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ServerConfigurationError("BASE_URL must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ServerConfigurationError(
      "BASE_URL cannot contain credentials, query parameters or fragments",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "");
  return url.toString().replace(/\/$/u, "");
}

function normalizeServerTavilyBaseUrl(value: string): string {
  try {
    return normalizeTavilyBaseUrl(value);
  } catch {
    throw new ServerConfigurationError(
      "TAVILY_BASE_URL must be an absolute HTTP or HTTPS URL without credentials, query parameters or fragments",
    );
  }
}

function assertHostedUpstreamSecurity(
  value: string,
  name: "BASE_URL" | "TAVILY_BASE_URL",
  production: boolean,
  allowInsecureLocalUpstream: boolean,
): void {
  const url = new URL(value);
  if (url.protocol === "https:") return;
  if (
    !production &&
    allowInsecureLocalUpstream &&
    url.protocol === "http:" &&
    isLoopbackHostname(url.hostname)
  ) {
    return;
  }
  throw new ServerConfigurationError(
    production
      ? `${name} must use HTTPS when Hosted mode is enabled in production`
      : `${name} may use HTTP only for loopback development when ALLOW_INSECURE_LOCAL_UPSTREAM=true`,
  );
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value
    .replace(/^\[/u, "")
    .replace(/\]$/u, "")
    .toLocaleLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  const addressKind = isIP(hostname);
  if (addressKind === 4) return hostname.split(".")[0] === "127";
  if (addressKind === 6) {
    return hostname === "::1" || hostname.startsWith("::ffff:127.");
  }
  return false;
}

function parseModels(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((model) => model.normalize("NFKC").trim())
        .filter(Boolean),
    ),
  ];
}

function parseAccessCodes(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((code) => code.normalize("NFKC").trim())
        .filter(Boolean),
    ),
  ];
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function parseTimeoutMilliseconds(
  name: string,
  value: string | undefined,
  defaultMilliseconds: number,
): number {
  const normalized = value?.trim();
  if (!normalized) return defaultMilliseconds;
  if (!/^\d+$/u.test(normalized)) {
    throw new ServerConfigurationError(
      `${name} must be a whole number from 0 through 86400`,
    );
  }
  const seconds = Number(normalized);
  if (!Number.isSafeInteger(seconds) || seconds > 86_400) {
    throw new ServerConfigurationError(
      `${name} must be a whole number from 0 through 86400`,
    );
  }
  return seconds * 1_000;
}
