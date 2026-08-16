import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatController } from "@/features/chat/use-chat-controller";
import {
  connectionScope,
  type PublicConfig,
} from "@/features/chat/connection-controller";
import { createI18n } from "@/i18n/create-i18n";
import type { ConnectionBundle } from "@/runtime/chat/types";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";
import { ConnectionStore } from "@/storage/connection-store";
import { ChatDatabase } from "@/storage/database";
import { ModelListCacheRepository } from "@/storage/model-list-cache-repository";

const hostedConfig: PublicConfig = {
  byokEnabled: true,
  hostedEnabled: true,
  hostedWebSearchEnabled: false,
  hostedWebSearchProvider: null,
  hostedWebSearchProviders: [],
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

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("useChatController integration", () => {
  beforeEach(async () => {
    cleanup();
    Object.defineProperties(URL, {
      createObjectURL: {
        configurable: true,
        value: vi.fn(() => "blob:cherrychat-test"),
      },
      revokeObjectURL: {
        configurable: true,
        value: vi.fn(),
      },
    });
    window.localStorage.clear();
    await deleteDefaultDatabase();
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
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

  it("uses the Hosted default image profile and restores an explicit selection", async () => {
    const config: PublicConfig = {
      ...hostedConfig,
      hostedImageGenerationEnabled: true,
      hostedImageGenerationModel: "gpt-image-2",
      hostedImageGenerationProfiles: [
        {
          id: "standard",
          name: "Standard",
          modelId: "gpt-image-1.5",
          sizeMode: "fixed",
        },
        {
          id: "portrait",
          name: "Portrait",
          modelId: "gpt-image-2",
          sizeMode: "auto",
        },
      ],
      hostedImageGenerationDefaultProfileId: "portrait",
    };
    installFetchMock({ config });
    const first = renderController();
    await waitForController(first.result);

    expect(first.result.current.activeImageGenerationProfile?.id).toBe(
      "portrait",
    );
    await act(async () => {
      await first.result.current.selectImageGenerationProfile("standard");
    });
    expect(first.result.current.activeImageGenerationProfile?.id).toBe(
      "standard",
    );
    first.unmount();

    const second = renderController();
    await waitForController(second.result);
    expect(second.result.current.activeImageGenerationProfile?.id).toBe(
      "standard",
    );
  });

  it("rejects operations before services are ready and blank model selection", async () => {
    installFetchMock();
    const { result } = renderController();
    const earlyBackup = result.current.createBackup();

    await expect(earlyBackup).rejects.toThrow("Chat services are not ready");
    await waitForController(result);

    await act(async () => {
      await expect(result.current.selectModel("  ")).rejects.toThrow();
    });
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

  it("restores a saved BYOK discovered list and enabled subset", async () => {
    await persistConnection(savedByokConnection);
    const database = new ChatDatabase();
    await new ModelListCacheRepository(database).saveEnabled(
      connectionScope({
        mode: "byok",
        baseUrl: "https://gateway.example",
        apiType: "openai-compatible",
      }),
      ["optional-model"],
      [
        { id: "saved-model", ownedBy: null, endpointTypes: [] },
        { id: "optional-model", ownedBy: null, endpointTypes: [] },
      ],
    );
    database.close();
    installFetchMock();

    const { result } = renderController();
    await waitForController(result);

    expect(result.current.availableModels).toEqual([
      "saved-model",
      "optional-model",
    ]);
    expect(result.current.enabledModels).toEqual(["optional-model"]);
    expect(result.current.models).toEqual(["optional-model", "saved-model"]);
  });

  it("exposes Hosted web search when the deployment default is usable", async () => {
    installFetchMock({
      config: {
        ...hostedConfig,
        hostedWebSearchEnabled: true,
        hostedWebSearchProvider: "tavily",
        hostedWebSearchProviders: ["tavily"],
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

  it("runs the BYOK image generation flow with reference controls", async () => {
    const fetchMock = installFetchMock({
      models: [],
      config: {
        ...hostedConfig,
        hostedEnabled: false,
        models: [],
        defaultModel: null,
        titleModel: null,
        imageGenerationTimeoutMs: 10,
      },
    });
    const { result } = renderController();

    await waitForController(result);

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await act(async () => {
      await result.current.refreshModels();
    });
    const cachedDatabase = new ChatDatabase();
    await new ModelListCacheRepository(cachedDatabase).save(
      connectionScope(result.current.connection),
      [{ id: "cached-image-model", ownedBy: null, endpointTypes: [] }],
    );
    cachedDatabase.close();
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await act(async () => {
      await result.current.refreshModels();
    });

    await act(async () => {
      await result.current.saveImageGenerationSettings({
        profiles: [
          {
            id: "test-image-profile",
            name: "Test image",
            mode: "byok",
            baseUrl: "https://images.example/v1",
            apiKey: "image-test-key",
            modelId: "gpt-image-1.5",
            sizeMode: "fixed",
            hasApiKey: true,
          },
        ],
        defaultProfileId: "test-image-profile",
      });
    });
    await act(async () => {
      result.current.setImageGenerationParameters({
        resolutionTier: "1K",
        aspectRatio: "3:2",
        quality: "auto",
      });
    });

    expect(result.current.imageGenerationConfig.profiles[0]).toMatchObject({
      baseUrl: "https://images.example/v1",
      apiKey: "image-test-key",
      modelId: "gpt-image-1.5",
      hasApiKey: true,
    });
    expect(
      result.current.imageGenerationConfig.parametersByProfile[
        "test-image-profile"
      ],
    ).toMatchObject({ size: "1536x1024", quality: "auto" });

    await act(async () => {
      await result.current.saveWebSearchSettings({
        enabled: false,
        maxResults: 5,
        provider: "tavily",
        hostedProvider: null,
        providers: {
          tavily: {
            apiKey: "",
            baseUrl: "https://api.tavily.com",
          },
          exa: {
            apiKey: "",
            baseUrl: "https://api.exa.ai",
          },
          grok: {
            apiKey: "",
            responsesUrl: "https://api.x.ai/v1/responses",
            model: "grok-4.5",
            xSearch: false,
          },
        },
      });
    });

    const database = new ChatDatabase();
    await database.attachments.put({
      id: "stored-reference",
      blob: new Blob(["reference"], { type: "image/png" }),
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteSize: 9,
      sha256: "a".repeat(64),
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    database.close();
    await act(async () => {
      await result.current.addStoredImageReference("stored-reference");
    });
    expect(result.current.imageReferences).toHaveLength(1);
    const referenceId = result.current.imageReferences[0]?.id;
    expect(referenceId).toBe("stored-reference");

    await act(async () => {
      result.current.reorderImageReferences(referenceId!, referenceId!);
      result.current.removeImageReference(referenceId!);
    });
    expect(result.current.imageReferences).toHaveLength(0);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [{ url: "https://images.example/generated.png" }],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(base64ArrayBuffer(PNG_BASE64), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    await act(async () => {
      result.current.setComposerMode("image");
      result.current.setDraft("a tiny test image");
    });
    await act(async () => {
      await result.current.send();
    });

    expect(result.current.imageGenerationStarting).toBe(false);
    expect(result.current.activeImageGeneration).toBeNull();
    expect(
      fetchMock.mock.calls.some(
        ([input]) =>
          requestPath(input) === "https://images.example/v1/images/generations",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.find(
        ([input]) =>
          requestPath(input) === "https://images.example/generated.png",
      )?.[1],
    ).toMatchObject({ credentials: "omit", redirect: "follow" });

    const persistedDatabase = new ChatDatabase();
    const generatedMessage = (await persistedDatabase.messages.toArray()).find(
      (message) =>
        message.role === "assistant" &&
        message.parts.some((part) => part.type === "image_generation"),
    );
    const generatedImage = generatedMessage?.parts.find(
      (part) => part.type === "image_ref",
    );
    expect(generatedMessage).toMatchObject({
      status: "completed",
      error: null,
    });
    expect(generatedImage?.type).toBe("image_ref");
    if (generatedImage?.type !== "image_ref" || !generatedMessage) {
      persistedDatabase.close();
      throw new Error("Generated image fixture was not persisted");
    }
    const persistedAttachment = await persistedDatabase.attachments.get(
      generatedImage.attachmentId,
    );
    const persistedLinks = await persistedDatabase.messageAttachments.toArray();
    persistedDatabase.close();
    expect(persistedAttachment).toMatchObject({
      id: generatedImage.attachmentId,
      mimeType: "image/png",
      width: 1,
      height: 1,
    });
    expect(persistedLinks).toContainEqual({
      messageId: generatedMessage.id,
      attachmentId: generatedImage.attachmentId,
      conversationId: generatedMessage.conversationId,
    });

    fetchMock.mockResolvedValueOnce(
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await act(async () => {
      result.current.setDraft("a failed test image");
    });
    await act(async () => {
      await result.current.send();
    });
    expect(
      fetchMock.mock.calls.filter(
        ([input]) =>
          requestPath(input) === "https://images.example/v1/images/generations",
      ),
    ).toHaveLength(2);
    expect(result.current.path.at(-1)?.status).toBe("error");

    fetchMock.mockImplementationOnce(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    await act(async () => {
      result.current.setDraft("a timed out test image");
    });
    await act(async () => {
      await result.current.send();
    });
    expect(result.current.path.at(-1)?.error?.code).toBe("REQUEST_TIMEOUT");
  });

  it("restores saved model roles and the active conversation on reload", async () => {
    installFetchMock();
    const first = renderController();
    await waitForController(first.result);

    await act(async () => {
      await first.result.current.saveDefaultModel("hosted-title");
      await first.result.current.saveTitleModel("hosted-default");
      await first.result.current.createConversation();
    });
    const conversationId = first.result.current.currentConversation?.id;
    first.unmount();

    const second = renderController();
    await waitForController(second.result);

    expect(second.result.current.defaultModel).toBe("hosted-title");
    expect(second.result.current.titleModel).toBe("hosted-default");
    expect(second.result.current.currentConversation?.id).toBe(conversationId);
  });

  it("rejects blank or unavailable saved model roles", async () => {
    installFetchMock();
    const { result } = renderController();
    await waitForController(result);

    await act(async () => {
      await expect(result.current.saveDefaultModel("  ")).rejects.toThrow();
      await expect(
        result.current.saveTitleModel("unavailable-model"),
      ).rejects.toThrow();
      await expect(
        result.current.resolveModelCapability("  "),
      ).resolves.toBeNull();
      await expect(
        result.current.resolveModelExecutionCapability("  "),
      ).resolves.toBeNull();
      await expect(
        result.current.resolveModelCapability("hosted-default"),
      ).resolves.not.toBeNull();
      await expect(
        result.current.resolveModelExecutionCapability("hosted-default"),
      ).resolves.not.toBeNull();
    });
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
        accessCode: "replacement-access-code",
        modelId: "hosted-next",
        apiType: "anthropic",
      });
    });

    expect(result.current.connection).toEqual({
      mode: "hosted",
      baseUrl: "https://ignored.example/v1",
      apiKey: "unused-key",
      accessCode: "replacement-access-code",
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
      accessCode: "replacement-access-code",
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
        accessCode: "replacement-access-code",
        encrypted: false,
      },
    });
  });

  it("keeps every Hosted model when model refresh fails", async () => {
    installFetchMock({ modelsStatus: 502 });
    const { result } = renderController();
    await waitForController(result);

    const database = new ChatDatabase();
    await new ModelListCacheRepository(database).saveEnabled(
      "hosted:same-origin",
      ["hosted-default"],
      [{ id: "hosted-default", ownedBy: null, endpointTypes: [] }],
    );
    database.close();

    let refreshError: unknown;
    await act(async () => {
      try {
        await result.current.refreshModels();
      } catch (cause) {
        refreshError = cause;
      }
    });

    expect(refreshError).toBeDefined();
    expect(result.current.availableModels).toEqual([
      "hosted-default",
      "hosted-title",
    ]);
    expect(result.current.enabledModels).toEqual([
      "hosted-default",
      "hosted-title",
    ]);
    expect(result.current.models).toEqual(["hosted-default", "hosted-title"]);
  });

  it("restores every deployment model after importing a stale Hosted enabled subset", async () => {
    installFetchMock();
    const { result } = renderController();
    await waitForController(result);

    const database = new ChatDatabase();
    await new ModelListCacheRepository(database).saveEnabled(
      "hosted:same-origin",
      ["hosted-default"],
      [
        {
          id: "hosted-default",
          ownedBy: null,
          endpointTypes: [],
        },
      ],
    );
    database.close();

    window.localStorage.setItem("cherrychat.language", "en");
    window.localStorage.setItem("cherrychat.theme", "dark");
    await act(async () => {
      await result.current.saveDefaultModel("hosted-title");
      await result.current.saveTitleModel("hosted-default");
    });

    await act(async () => {
      const backup = await result.current.createBackup();
      const { prepared } = await result.current.inspectBackup(backup);
      await result.current.restoreBackup(prepared);
    });

    expect(result.current.availableModels).toEqual([
      "hosted-default",
      "hosted-title",
    ]);
    expect(result.current.enabledModels).toEqual([
      "hosted-default",
      "hosted-title",
    ]);
    expect(result.current.models).toEqual(["hosted-default", "hosted-title"]);
    expect(result.current.defaultModel).toBe("hosted-title");
    expect(result.current.titleModel).toBe("hosted-default");
    expect(window.localStorage.getItem("cherrychat.language")).toBe("en");
    expect(window.localStorage.getItem("cherrychat.theme")).toBe("dark");
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
  options: {
    config?: typeof hostedConfig;
    models?: string[];
    modelsStatus?: number;
  } = {},
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      void init;
      const path = requestPath(input);
      if (path === "/api/config")
        return jsonResponse(options.config ?? hostedConfig);
      if (path === "/api/auth") return new Response(null, { status: 204 });
      if (path === "/api/models") {
        return new Response(
          JSON.stringify({
            object: "list",
            data: (options.models ?? hostedConfig.models).map((id) => ({ id })),
          }),
          {
            status: options.modelsStatus ?? 200,
            headers: { "Content-Type": "application/json" },
          },
        );
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

function base64ArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
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
