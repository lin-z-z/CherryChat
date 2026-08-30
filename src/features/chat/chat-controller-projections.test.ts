import { describe, expect, it } from "vitest";

import {
  createGenerationPreparation,
  createWebSearchExecutor,
  descriptorsFromIds,
  lastGeneratedModelId,
  modelCapabilityIdentity,
  projectConnectionModels,
  resolveEnabledModelIds,
  resolvePersistedEnabledModelIds,
  resolveVisibleModelIds,
  resolveWebSearchSource,
} from "@/features/chat/chat-controller-projections";
import { WEB_SEARCH_TOOL_NAME } from "@/runtime/tools/web-search-client";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";
import type { MessageNode } from "@/runtime/chat/types";

describe("chat controller projections", () => {
  it("creates one externally releasable generation preparation", async () => {
    const preparation = createGenerationPreparation("conversation-1");
    let ready = false;
    void preparation.ready.then(() => {
      ready = true;
    });

    expect(preparation.conversationId).toBe("conversation-1");
    expect(preparation.controller.signal.aborted).toBe(false);
    expect(ready).toBe(false);

    preparation.resolveReady();
    await preparation.ready;
    expect(ready).toBe(true);
  });

  it("keeps capability identity scoped by normalized model and endpoint", () => {
    const connection = {
      mode: "byok" as const,
      baseUrl: "https://api.example.com/v1",
      modelId: " ｍｏｄｅｌ-a ",
      apiType: "new-api" as const,
    };

    expect(modelCapabilityIdentity(connection, "openai-chat")).toContain(
      ":model-a:openai-chat",
    );
    expect(modelCapabilityIdentity(connection, "openai-responses")).not.toBe(
      modelCapabilityIdentity(connection, "openai-chat"),
    );
  });

  it("projects discovered, visible, and enabled model IDs without losing order", () => {
    expect(descriptorsFromIds(["a", "b", "a"])).toEqual([
      { id: "a", ownedBy: null, endpointTypes: [] },
      { id: "b", ownedBy: null, endpointTypes: [] },
    ]);
    expect(resolveVisibleModelIds("current", [])).toEqual(["current"]);
    expect(resolveVisibleModelIds("current", ["a", "a", "b"])).toEqual([
      "a",
      "b",
    ]);
    expect(resolveEnabledModelIds("current", ["a"], ["title", "a"])).toEqual([
      "a",
      "current",
      "title",
    ]);
    expect(
      resolvePersistedEnabledModelIds(" fallback ", [" a ", "ｂ", "a"]),
    ).toEqual(["a", "b"]);
    expect(resolvePersistedEnabledModelIds(" fallback ", null)).toEqual([
      "fallback",
    ]);
  });

  it("uses every Hosted model while preserving the BYOK enabled subset", () => {
    expect(
      projectConnectionModels({
        mode: "hosted",
        currentModelId: "hosted-a",
        availableModelIds: ["hosted-a", "hosted-b", "hosted-c"],
        persistedEnabledModelIds: ["hosted-a"],
        requiredModelIds: ["hosted-c"],
      }),
    ).toEqual({
      enabledModels: ["hosted-a", "hosted-b", "hosted-c"],
      models: ["hosted-a", "hosted-b", "hosted-c"],
    });
    expect(
      projectConnectionModels({
        mode: "byok",
        currentModelId: "custom-a",
        availableModelIds: ["custom-a", "custom-b", "custom-c"],
        persistedEnabledModelIds: ["custom-b"],
        requiredModelIds: ["custom-c"],
      }),
    ).toEqual({
      enabledModels: ["custom-b"],
      models: ["custom-b", "custom-a", "custom-c"],
    });
  });

  it("finds the latest model that actually generated on the current path", () => {
    const message = (
      id: string,
      role: MessageNode["role"],
      modelId: string | null,
    ): MessageNode => ({
      id,
      conversationId: "conversation-1",
      parentId: null,
      role,
      parts: [{ type: "text", text: id }],
      status: "completed",
      modelSnapshot: modelId
        ? { modelId, connectionScope: "hosted:same-origin" }
        : null,
      usage: null,
      error: null,
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z",
    });
    const path = [
      message("user-a", "user", null),
      message("assistant-a", "assistant", "model-a"),
      message("user-b", "user", null),
      message("assistant-b", "assistant", "model-b"),
      message("user-c", "user", null),
    ];

    expect(lastGeneratedModelId(path)).toBe("model-b");
    expect(lastGeneratedModelId([message("user", "user", null)])).toBeNull();
  });

  it("selects only the connection-owned web search source", () => {
    expect(
      resolveWebSearchSource(
        "hosted",
        {
          enabled: true,
          maxResults: 5,
          provider: "tavily",
          hostedProvider: "grok",
          providers: {
            tavily: {
              apiKey: "browser-key",
              baseUrl: "https://api.tavily.com",
              hasApiKey: true,
            },
            exa: {
              apiKey: "",
              baseUrl: "https://api.exa.ai",
              hasApiKey: false,
            },
            grok: {
              apiKey: "",
              responsesUrl: "https://api.x.ai/v1/responses",
              model: "grok-4.5",
              xSearch: false,
              hasApiKey: false,
            },
          },
          hasApiKey: true,
        },
        {
          hostedEnabled: true,
          appVersion: "1.1.0",
          byokEnabled: true,
          defaultModel: "gpt-5-mini",
          titleModel: null,
          models: ["gpt-5-mini"],
          hostedWebSearchEnabled: true,
          hostedWebSearchProvider: "tavily",
          hostedWebSearchProviders: ["tavily", "grok"],
          authenticated: true,
          requestTimeouts: DEFAULT_REQUEST_TIMEOUT_POLICY,
        },
      ),
    ).toEqual({ kind: "hosted", provider: "grok" });
    const browser = resolveWebSearchSource(
      "byok",
      {
        enabled: true,
        maxResults: 5,
        provider: "tavily",
        hostedProvider: null,
        providers: {
          tavily: {
            apiKey: "browser-key",
            baseUrl: "https://api.tavily.com",
            hasApiKey: true,
          },
          exa: {
            apiKey: "",
            baseUrl: "https://api.exa.ai",
            hasApiKey: false,
          },
          grok: {
            apiKey: "",
            responsesUrl: "https://api.x.ai/v1/responses",
            model: "grok-4.5",
            xSearch: false,
            hasApiKey: false,
          },
        },
        hasApiKey: true,
      },
      null,
    );
    expect(browser).toEqual({
      kind: "browser",
      provider: "tavily",
      apiKey: "browser-key",
      baseUrl: "https://api.tavily.com",
    });
    if (!browser) throw new Error("Expected a browser web search source");
    expect(
      createWebSearchExecutor(browser, 5, () => undefined).definition.function
        .name,
    ).toBe(WEB_SEARCH_TOOL_NAME);
  });
});
