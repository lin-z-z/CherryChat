import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatController } from "@/features/chat/use-chat-controller";
import { createI18n } from "@/i18n/create-i18n";
import type { ConnectionBundle } from "@/runtime/chat/types";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";
import { ConnectionStore } from "@/storage/connection-store";
import { ChatDatabase } from "@/storage/database";

const hostedConfig = {
  byokEnabled: true,
  hostedEnabled: true,
  hostedWebSearchEnabled: false,
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
    baseUrl: "https://gateway.example",
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

describe("useChatController integration", () => {
  beforeEach(async () => {
    cleanup();
    window.localStorage.clear();
    await deleteDefaultDatabase();
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    await deleteDefaultDatabase();
  });

  it("initializes a new browser in Hosted mode", async () => {
    const fetchMock = installFetchMock();
    const { result } = renderController();

    await waitForController(result);

    expect(result.current.connection).toEqual({
      mode: "hosted",
      baseUrl: "https://api.openai.com",
      apiKey: "",
      accessCode: "",
      modelId: "hosted-default",
      apiType: "openai",
    });
    expect(result.current.defaultModel).toBe("hosted-default");
    expect(result.current.titleModel).toBe("hosted-title");
    expect(result.current.models).toEqual(["hosted-default", "hosted-title"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestPath(fetchMock.mock.calls[0]?.[0])).toBe("/api/config");
  });

  it("keeps a saved BYOK connection on a Hosted deployment", async () => {
    await persistConnection(savedByokConnection);
    const fetchMock = installFetchMock();
    const { result } = renderController();

    await waitForController(result);

    expect(result.current.connection).toEqual({
      mode: "byok",
      baseUrl: "https://gateway.example",
      apiKey: "saved-key",
      accessCode: "",
      modelId: "saved-model",
      apiType: "openai-compatible",
    });
    expect(result.current.defaultModel).toBe("saved-model");
    expect(result.current.titleModel).toBe("saved-model");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestPath(fetchMock.mock.calls[0]?.[0])).toBe("/api/config");
  });

  it("exposes Hosted web search when the deployment default is usable", async () => {
    installFetchMock({
      config: {
        ...hostedConfig,
        hostedWebSearchEnabled: true,
        models: ["gpt-5-mini"],
        defaultModel: "gpt-5-mini",
        titleModel: "gpt-5-mini",
        authenticated: true,
      },
    });
    const { result } = renderController();

    await waitForController(result);

    expect(result.current.webSearchConfig.enabled).toBe(true);
    expect(result.current.webSearchSource).toBe("hosted");
    expect(result.current.capability?.tools).toBe(true);
    expect(result.current.webSearchAvailable).toBe(true);
  });

  it("authenticates and persists a Hosted connection through the facade", async () => {
    const fetchMock = installFetchMock({
      models: ["hosted-next", "hosted-title"],
    });
    const { result } = renderController();
    await waitForController(result);

    await act(async () => {
      await result.current.saveConnection({
        mode: "hosted",
        baseUrl: "https://ignored.example/v1",
        apiKey: "unused-key",
        accessCode: "next-chat-code",
        modelId: "hosted-next",
        apiType: "anthropic",
      });
    });

    expect(result.current.connection).toEqual({
      mode: "hosted",
      baseUrl: "https://ignored.example/v1",
      apiKey: "unused-key",
      accessCode: "next-chat-code",
      modelId: "hosted-next",
      apiType: "openai",
    });
    expect(result.current.publicConfig?.authenticated).toBe(true);
    expect(result.current.availableModels).toEqual([
      "hosted-next",
      "hosted-title",
    ]);

    const authCall = fetchMock.mock.calls.find(
      ([input]) => requestPath(input) === "/api/auth",
    );
    expect(authCall?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(authCall?.[1]?.body))).toEqual({
      accessCode: "next-chat-code",
    });
    expect(
      fetchMock.mock.calls.some(
        ([input]) => requestPath(input) === "/api/models",
      ),
    ).toBe(true);

    const database = new ChatDatabase();
    const stored = await new ConnectionStore(
      database,
      window.localStorage,
    ).load();
    database.close();
    expect(stored).toMatchObject({
      connection: {
        id: "current",
        mode: "hosted",
        baseUrl: "https://ignored.example/v1",
        modelId: "hosted-next",
        apiType: "openai",
      },
      credential: {
        id: "current",
        apiKey: "unused-key",
        accessCode: "next-chat-code",
        encrypted: false,
      },
    });
  });
});

function renderController() {
  const i18n = createI18n("zh-CN");
  function Wrapper({ children }: PropsWithChildren) {
    return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
  }
  return renderHook(() => useChatController(), { wrapper: Wrapper });
}

async function waitForController(
  result: ReturnType<typeof renderController>["result"],
): Promise<void> {
  await waitFor(
    () => {
      expect(result.current.ready).toBe(true);
      expect(result.current.error).toBeNull();
    },
    { timeout: 5_000 },
  );
}

function installFetchMock(
  options: { config?: typeof hostedConfig; models?: string[] } = {},
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      void init;
      const path = requestPath(input);
      if (path === "/api/config")
        return jsonResponse(options.config ?? hostedConfig);
      if (path === "/api/auth") return new Response(null, { status: 204 });
      if (path === "/api/models") {
        return jsonResponse({
          object: "list",
          data: (options.models ?? hostedConfig.models).map((id) => ({ id })),
        });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestPath(input: RequestInfo | URL | undefined): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname;
  return input ? new URL(input.url).pathname : "";
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function persistConnection(bundle: ConnectionBundle): Promise<void> {
  const database = new ChatDatabase();
  await new ConnectionStore(database, window.localStorage).save(bundle);
  database.close();
}

async function deleteDefaultDatabase(): Promise<void> {
  const database = new ChatDatabase();
  await database.delete();
}
