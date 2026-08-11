import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_CONNECTION,
  parsePublicConfig,
  resolveInitialConnectionState,
  saveConnectionChange,
  type ConnectionDraft,
  type PublicConfig,
} from "@/features/chat/connection-controller";
import type { ConnectionBundle } from "@/runtime/chat/types";
import { ChatTransportError } from "@/runtime/transport/chat-errors";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";

const publicConfig: PublicConfig = {
  byokEnabled: true,
  hostedEnabled: true,
  hostedWebSearchEnabled: false,
  hostedWebSearchProvider: null,
  models: ["hosted-default", "hosted-title"],
  defaultModel: "hosted-default",
  titleModel: "hosted-title",
  authenticated: false,
  requestTimeouts: { ...DEFAULT_REQUEST_TIMEOUT_POLICY },
};

const savedByokConnection: ConnectionBundle = {
  connection: {
    id: "current",
    mode: "byok",
    baseUrl: "https://gateway.example/v1",
    modelId: "saved-model",
    apiType: "openai-compatible",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  credential: {
    id: "current",
    apiKey: "saved-key",
    accessCode: "",
    encrypted: false,
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
};

describe("connection controller", () => {
  it("validates public config and supplies the checked-in timeout policy", () => {
    const parsed = parsePublicConfig({
      byokEnabled: true,
      hostedEnabled: false,
      hostedWebSearchEnabled: false,
      hostedWebSearchProvider: null,
      authenticated: false,
      models: ["model-a", 42, "model-b"],
      defaultModel: "model-a",
      titleModel: null,
    });

    expect(parsed).toEqual({
      byokEnabled: true,
      hostedEnabled: false,
      hostedWebSearchEnabled: false,
      hostedWebSearchProvider: null,
      authenticated: false,
      models: ["model-a", "model-b"],
      defaultModel: "model-a",
      titleModel: null,
      requestTimeouts: DEFAULT_REQUEST_TIMEOUT_POLICY,
    });
    expect(parsed.requestTimeouts).not.toBe(DEFAULT_REQUEST_TIMEOUT_POLICY);
    expect(
      parsePublicConfig({
        ...publicConfig,
        hostedWebSearchEnabled: true,
        hostedWebSearchProvider: "exa",
      }).hostedWebSearchProvider,
    ).toBe("exa");
    expect(
      parsePublicConfig({
        ...publicConfig,
        hostedWebSearchEnabled: true,
        hostedWebSearchProvider: undefined,
      }).hostedWebSearchProvider,
    ).toBe("tavily");
    expect(() =>
      parsePublicConfig({
        ...publicConfig,
        requestTimeouts: { ...DEFAULT_REQUEST_TIMEOUT_POLICY, modelListMs: -1 },
      }),
    ).toThrow("Invalid server config");
  });

  it("defaults a new browser to Hosted and uses the deployment title model", () => {
    const state = resolveInitialConnectionState({
      config: publicConfig,
      storedConnection: null,
      storedDefaultModel: undefined,
      storedTitleModel: undefined,
    });

    expect(state).toEqual({
      connection: {
        ...EMPTY_CONNECTION,
        mode: "hosted",
        modelId: "hosted-default",
      },
      defaultModel: "hosted-default",
      titleModel: "hosted-title",
    });
  });

  it("keeps a saved BYOK mode while applying browser model settings", () => {
    const state = resolveInitialConnectionState({
      config: publicConfig,
      storedConnection: savedByokConnection,
      storedDefaultModel: "browser-default",
      storedTitleModel: undefined,
    });

    expect(state).toEqual({
      connection: {
        mode: "byok",
        baseUrl: "https://gateway.example/v1",
        modelId: "browser-default",
        apiType: "openai-compatible",
        apiKey: "saved-key",
        accessCode: "",
      },
      defaultModel: "browser-default",
      titleModel: "browser-default",
    });
  });

  it("authenticates, invalidates the target cache, then persists", async () => {
    const calls: string[] = [];
    let savedBundle: ConnectionBundle | null = null;
    const draft: ConnectionDraft = {
      mode: "hosted",
      baseUrl: "  https://ignored.example/v1  ",
      apiKey: "unused-key",
      accessCode: "access-code",
      modelId: "  hosted-default  ",
      apiType: "anthropic",
    };

    const result = await saveConnectionChange(
      { previous: EMPTY_CONNECTION, draft },
      {
        authenticateHosted: async (accessCode) => {
          calls.push(`auth:${accessCode}`);
        },
        clearModelCache: async (scope) => {
          calls.push(`clear:${scope}`);
        },
        persistConnection: async (bundle) => {
          calls.push("persist");
          savedBundle = bundle;
        },
        now: () => {
          calls.push("now");
          return "2026-08-01T01:02:03.000Z";
        },
      },
    );

    expect(calls).toEqual([
      "auth:access-code",
      "now",
      "clear:hosted:same-origin",
      "persist",
    ]);
    expect(result).toEqual({
      connection: {
        ...draft,
        baseUrl: "https://ignored.example/v1",
        modelId: "hosted-default",
        apiType: "openai",
      },
      previousScope: "byok:https://api.openai.com:openai",
      nextScope: "hosted:same-origin",
      modelCacheInvalidated: true,
    });
    expect(savedBundle).toEqual({
      connection: {
        id: "current",
        mode: "hosted",
        baseUrl: "https://ignored.example/v1",
        modelId: "hosted-default",
        apiType: "openai",
        updatedAt: "2026-08-01T01:02:03.000Z",
      },
      credential: {
        id: "current",
        apiKey: "unused-key",
        accessCode: "access-code",
        encrypted: false,
        updatedAt: "2026-08-01T01:02:03.000Z",
      },
    });
  });

  it("preserves the cache when scope and credentials are unchanged", async () => {
    const previous: ConnectionDraft = {
      mode: "byok",
      baseUrl: "https://gateway.example/v1/",
      apiKey: "same-key",
      accessCode: "",
      modelId: "old-model",
      apiType: "openai-compatible",
    };
    const clearModelCache = vi.fn(async () => undefined);
    const persistConnection = vi.fn(async () => undefined);
    const authenticateHosted = vi.fn(async () => undefined);

    const result = await saveConnectionChange(
      {
        previous,
        draft: { ...previous, modelId: "new-model" },
      },
      {
        authenticateHosted,
        clearModelCache,
        persistConnection,
        now: () => "2026-08-01T01:02:03.000Z",
      },
    );

    expect(result.modelCacheInvalidated).toBe(false);
    expect(result.connection.baseUrl).toBe("https://gateway.example");
    expect(authenticateHosted).not.toHaveBeenCalled();
    expect(clearModelCache).not.toHaveBeenCalled();
    expect(persistConnection).toHaveBeenCalledOnce();
  });

  it("stops before cache and persistence when Hosted authentication fails", async () => {
    const clearModelCache = vi.fn(async () => undefined);
    const persistConnection = vi.fn(async () => undefined);
    const now = vi.fn(() => "2026-08-01T01:02:03.000Z");
    const failure = new ChatTransportError(
      "UNAUTHORIZED",
      "Access code is invalid",
      401,
    );

    await expect(
      saveConnectionChange(
        {
          previous: EMPTY_CONNECTION,
          draft: {
            ...EMPTY_CONNECTION,
            mode: "hosted",
            accessCode: "wrong-code",
          },
        },
        {
          authenticateHosted: async () => Promise.reject(failure),
          clearModelCache,
          persistConnection,
          now,
        },
      ),
    ).rejects.toBe(failure);
    expect(now).not.toHaveBeenCalled();
    expect(clearModelCache).not.toHaveBeenCalled();
    expect(persistConnection).not.toHaveBeenCalled();
  });

  it("rejects a missing native API URL before every side effect", async () => {
    const authenticateHosted = vi.fn(async () => undefined);
    const clearModelCache = vi.fn(async () => undefined);
    const persistConnection = vi.fn(async () => undefined);
    const now = vi.fn(() => "2026-08-01T01:02:03.000Z");

    await expect(
      saveConnectionChange(
        {
          previous: EMPTY_CONNECTION,
          draft: {
            ...EMPTY_CONNECTION,
            baseUrl: "   ",
            apiType: "anthropic",
          },
        },
        { authenticateHosted, clearModelCache, persistConnection, now },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(authenticateHosted).not.toHaveBeenCalled();
    expect(clearModelCache).not.toHaveBeenCalled();
    expect(persistConnection).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });
});
