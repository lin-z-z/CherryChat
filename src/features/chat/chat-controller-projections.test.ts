import { describe, expect, it } from "vitest";

import {
  createGenerationPreparation,
  createWebSearchExecutor,
  descriptorsFromIds,
  modelCapabilityIdentity,
  resolveEnabledModelIds,
  resolvePersistedEnabledModelIds,
  resolveVisibleModelIds,
  resolveWebSearchSource,
} from "@/features/chat/chat-controller-projections";
import { WEB_SEARCH_TOOL_NAME } from "@/runtime/tools/tavily-client";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";

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

  it("selects only the connection-owned web search source", () => {
    expect(
      resolveWebSearchSource(
        "hosted",
        "browser-key",
        "https://api.tavily.com",
        {
          hostedEnabled: true,
          byokEnabled: true,
          defaultModel: "gpt-5-mini",
          titleModel: null,
          models: ["gpt-5-mini"],
          hostedWebSearchEnabled: true,
          authenticated: true,
          requestTimeouts: DEFAULT_REQUEST_TIMEOUT_POLICY,
        },
      ),
    ).toEqual({ kind: "hosted" });
    const browser = resolveWebSearchSource(
      "byok",
      "browser-key",
      "https://api.tavily.com",
      null,
    );
    expect(browser).toEqual({
      kind: "browser",
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
