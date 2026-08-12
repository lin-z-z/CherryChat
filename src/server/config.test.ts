import { describe, expect, it } from "vitest";

import {
  buildUpstreamUrl,
  parseServerConfig,
  ServerConfigurationError,
  toPublicServerConfig,
} from "@/server/config";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";

describe("server configuration", () => {
  it("supports a BYOK-only deployment with safe defaults", () => {
    const config = parseServerConfig({});

    expect(config).toMatchObject({
      baseUrl: "https://api.openai.com",
      disableByok: false,
      hosted: null,
      requestTimeouts: DEFAULT_REQUEST_TIMEOUT_POLICY,
    });
    expect(buildUpstreamUrl(config, "chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("requires the complete hosted secret combination", () => {
    expect(() =>
      parseServerConfig({
        OPENAI_API_KEY: "secret-key",
        ACCESS_CODE: "code",
      }),
    ).toThrow(ServerConfigurationError);
  });

  it("returns only safe hosted metadata to the browser", () => {
    const config = parseServerConfig({
      OPENAI_API_KEY: "deployment-secret-key",
      ACCESS_CODE: "private-code, second-code,private-code",
      AUTH_SECRET: "a".repeat(32),
      TAVILY_API_KEY: "tvly-deployment-secret",
      TAVILY_BASE_URL: "https://search.example/tavily/search/",
      BASE_URL: "https://example.com/api/v1/",
      MODELS: "model-a, model-b,model-a",
      DEFAULT_MODEL: "model-b",
      TITLE_MODEL: "model-a",
      DISABLE_BYOK: "true",
    });

    expect(config.baseUrl).toBe("https://example.com/api");
    expect(config.hosted?.accessCodes).toEqual(["private-code", "second-code"]);
    expect(config.hosted?.webSearch).toEqual({
      defaultProvider: "tavily",
      providers: [
        {
          provider: "tavily",
          apiKey: "tvly-deployment-secret",
          baseUrl: "https://search.example/tavily",
        },
      ],
    });
    expect(toPublicServerConfig(config)).toEqual({
      byokEnabled: false,
      hostedEnabled: true,
      hostedWebSearchEnabled: true,
      hostedWebSearchProvider: "tavily",
      hostedWebSearchProviders: ["tavily"],
      models: ["model-a", "model-b"],
      defaultModel: "model-b",
      titleModel: "model-a",
      requestTimeouts: DEFAULT_REQUEST_TIMEOUT_POLICY,
    });
    expect(JSON.stringify(toPublicServerConfig(config))).not.toContain(
      "deployment-secret-key",
    );
    expect(JSON.stringify(toPublicServerConfig(config))).not.toContain(
      "private-code",
    );
    expect(JSON.stringify(toPublicServerConfig(config))).not.toContain(
      "tvly-deployment-secret",
    );
    expect(JSON.stringify(toPublicServerConfig(config))).not.toContain(
      "search.example",
    );
  });

  it("reports hosted web search as disabled when no Tavily key is configured", () => {
    const config = parseServerConfig({
      OPENAI_API_KEY: "deployment-key",
      ACCESS_CODE: "code",
      AUTH_SECRET: "a".repeat(32),
      MODELS: "model-a",
    });

    expect(toPublicServerConfig(config).hostedWebSearchEnabled).toBe(false);
    expect(toPublicServerConfig(config).titleModel).toBe("model-a");
  });

  it("parses Exa and Grok Hosted search settings with safe defaults", () => {
    const exa = parseServerConfig({
      ...hostedEnvironment(),
      WEB_SEARCH_PROVIDER: "exa",
      EXA_API_KEY: "exa-deployment-secret",
      EXA_BASE_URL: "https://search.example/exa/search/",
    });
    expect(exa.hosted?.webSearch).toEqual({
      defaultProvider: "exa",
      providers: [
        {
          provider: "exa",
          apiKey: "exa-deployment-secret",
          baseUrl: "https://search.example/exa",
        },
      ],
    });
    expect(toPublicServerConfig(exa).hostedWebSearchProvider).toBe("exa");

    const grok = parseServerConfig({
      ...hostedEnvironment(),
      WEB_SEARCH_PROVIDER: "grok",
      GROK_API_KEY: "xai-deployment-secret",
      GROK_RESPONSES_URL: "https://proxy.example/v1/responses",
      GROK_X_SEARCH: "true",
    });
    expect(grok.hosted?.webSearch).toEqual({
      defaultProvider: "grok",
      providers: [
        {
          provider: "grok",
          apiKey: "xai-deployment-secret",
          responsesUrl: "https://proxy.example/v1/responses",
          model: "grok-4.5",
          xSearch: true,
        },
      ],
    });
  });

  it("keeps the explicit allowlist order separate from the default provider", () => {
    const config = parseServerConfig({
      ...hostedEnvironment(),
      WEB_SEARCH_PROVIDER: "tavily",
      WEB_SEARCH_ALLOWED_PROVIDERS: " grok,tavily,grok ",
      TAVILY_API_KEY: "tvly-deployment-secret",
      GROK_API_KEY: "xai-deployment-secret",
      EXA_API_KEY: "exa-unlisted-secret",
    });

    expect(config.hosted?.webSearch?.defaultProvider).toBe("tavily");
    expect(
      config.hosted?.webSearch?.providers.map(({ provider }) => provider),
    ).toEqual(["grok", "tavily"]);
    expect(toPublicServerConfig(config)).toMatchObject({
      hostedWebSearchProvider: "tavily",
      hostedWebSearchProviders: ["grok", "tavily"],
    });
    expect(JSON.stringify(toPublicServerConfig(config))).not.toContain(
      "unlisted-secret",
    );
  });

  it.each([
    ["", {}, "at least one provider"],
    [
      "tavily,unknown",
      { TAVILY_API_KEY: "tvly-deployment-secret" },
      "unknown provider",
    ],
    [
      "grok",
      { GROK_API_KEY: "xai-deployment-secret" },
      "must include WEB_SEARCH_PROVIDER",
    ],
    [
      "tavily,grok",
      { TAVILY_API_KEY: "tvly-deployment-secret" },
      "complete provider configuration",
    ],
  ])(
    "rejects invalid explicit Hosted search allowlist %j",
    (allowedProviders, extra, expectedMessage) => {
      expect(() =>
        parseServerConfig({
          ...hostedEnvironment(),
          WEB_SEARCH_ALLOWED_PROVIDERS: allowedProviders,
          ...extra,
        }),
      ).toThrow(expectedMessage);
    },
  );

  it("defaults the title model and rejects a configured title model outside MODELS", () => {
    expect(
      parseServerConfig({
        OPENAI_API_KEY: "deployment-key",
        ACCESS_CODE: "code",
        AUTH_SECRET: "a".repeat(32),
        MODELS: "model-a,model-b",
        DEFAULT_MODEL: "model-b",
      }).titleModel,
    ).toBe("model-b");

    expect(() =>
      parseServerConfig({
        OPENAI_API_KEY: "deployment-key",
        ACCESS_CODE: "code",
        AUTH_SECRET: "a".repeat(32),
        MODELS: "model-a,model-b",
        TITLE_MODEL: "model-c",
      }),
    ).toThrow("TITLE_MODEL must be included in MODELS");
  });

  it("rejects a deployment Tavily key without complete hosted access", () => {
    expect(() =>
      parseServerConfig({ TAVILY_API_KEY: "tvly-deployment-secret" }),
    ).toThrow(ServerConfigurationError);
    expect(() =>
      parseServerConfig({
        OPENAI_API_KEY: "deployment-key",
        ACCESS_CODE: "code",
        AUTH_SECRET: "a".repeat(32),
        MODELS: "model-a",
        TAVILY_API_KEY: "short",
      }),
    ).toThrow(ServerConfigurationError);
    expect(() =>
      parseServerConfig({
        OPENAI_API_KEY: "deployment-key",
        ACCESS_CODE: "code",
        AUTH_SECRET: "a".repeat(32),
        MODELS: "model-a",
        TAVILY_API_KEY: "       a",
      }),
    ).toThrow(ServerConfigurationError);
  });

  it("ignores a Tavily URL until a key enables hosted search and rejects unsafe active URLs", () => {
    expect(
      parseServerConfig({ TAVILY_BASE_URL: "https://search.example" }).hosted,
    ).toBeNull();
    expect(() =>
      parseServerConfig({
        OPENAI_API_KEY: "deployment-key",
        ACCESS_CODE: "code",
        AUTH_SECRET: "a".repeat(32),
        MODELS: "model-a",
        TAVILY_API_KEY: "tvly-deployment-secret",
        TAVILY_BASE_URL: "https://user:pass@search.example",
      }),
    ).toThrow(ServerConfigurationError);
  });

  it("requires HTTPS for production Hosted OpenAI and Tavily upstreams", () => {
    expect(() =>
      parseServerConfig({
        ...hostedEnvironment(),
        NODE_ENV: "production",
        BASE_URL: "http://127.0.0.1:11434",
        ALLOW_INSECURE_LOCAL_UPSTREAM: "true",
      }),
    ).toThrow("BASE_URL must use HTTPS");
    expect(() =>
      parseServerConfig({
        ...hostedEnvironment(),
        NODE_ENV: "production",
        TAVILY_API_KEY: "tvly-deployment-secret",
        TAVILY_BASE_URL: "http://localhost:8080/search",
        ALLOW_INSECURE_LOCAL_UPSTREAM: "true",
      }),
    ).toThrow("TAVILY_BASE_URL must use HTTPS");
  });

  it("allows explicit development HTTP only for loopback upstreams", () => {
    expect(
      parseServerConfig({
        ...hostedEnvironment(),
        BASE_URL: "http://127.25.1.2:11434/v1",
        TAVILY_API_KEY: "tvly-deployment-secret",
        TAVILY_BASE_URL: "http://[::1]:8080/search",
        ALLOW_INSECURE_LOCAL_UPSTREAM: "true",
      }),
    ).toMatchObject({
      baseUrl: "http://127.25.1.2:11434",
      hosted: {
        webSearch: {
          defaultProvider: "tavily",
          providers: [
            {
              provider: "tavily",
              apiKey: "tvly-deployment-secret",
              baseUrl: "http://[::1]:8080",
            },
          ],
        },
      },
    });

    for (const environment of [
      { BASE_URL: "http://localhost:11434" },
      {
        BASE_URL: "http://192.168.1.10:11434",
        ALLOW_INSECURE_LOCAL_UPSTREAM: "true",
      },
      {
        BASE_URL: "http://models.example:11434",
        ALLOW_INSECURE_LOCAL_UPSTREAM: "true",
      },
    ]) {
      expect(() =>
        parseServerConfig({ ...hostedEnvironment(), ...environment }),
      ).toThrow(ServerConfigurationError);
    }
  });

  it("parses timeout overrides in seconds and allows individual timers to be disabled", () => {
    const config = parseServerConfig({
      MODEL_LIST_TIMEOUT_SECONDS: " 12 ",
      CHAT_FIRST_BYTE_TIMEOUT_SECONDS: "45",
      CHAT_IDLE_TIMEOUT_SECONDS: "0",
      CHAT_TOTAL_TIMEOUT_SECONDS: "3600",
    });

    expect(config.requestTimeouts).toEqual({
      modelListMs: 12_000,
      chatFirstByteMs: 45_000,
      chatIdleMs: 0,
      chatTotalMs: 3_600_000,
    });
  });

  it("uses defaults for absent or empty timeout values", () => {
    expect(
      parseServerConfig({
        MODEL_LIST_TIMEOUT_SECONDS: "",
        CHAT_FIRST_BYTE_TIMEOUT_SECONDS: "   ",
      }).requestTimeouts,
    ).toEqual(DEFAULT_REQUEST_TIMEOUT_POLICY);
  });

  it.each([
    ["CHAT_IDLE_TIMEOUT_SECONDS", "-1"],
    ["CHAT_IDLE_TIMEOUT_SECONDS", "1.5"],
    ["CHAT_TOTAL_TIMEOUT_SECONDS", "86401"],
    ["MODEL_LIST_TIMEOUT_SECONDS", "not-a-number"],
  ])("rejects invalid %s without echoing its value", (name, value) => {
    let error: unknown;
    try {
      parseServerConfig({ [name]: value });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(ServerConfigurationError);
    expect(String(error)).toContain(name);
    expect(String(error)).not.toContain(value);
  });
});

function hostedEnvironment(): Record<string, string> {
  return {
    OPENAI_API_KEY: "deployment-key",
    ACCESS_CODE: "code",
    AUTH_SECRET: "a".repeat(32),
    MODELS: "model-a",
  };
}
