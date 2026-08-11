import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  selectSettingsModel,
  selectSettingsPage,
} from "./settings-helpers";

import {
  mockConfig,
  mockModels,
  prepareByokPage,
  saveByokConnection,
} from "./chat-test-helpers";
test("migrates legacy Grok capability settings when the catalogue improves", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop migration flow");
  await mockConfig(page, { byokEnabled: true, hostedEnabled: false });
  await page.route("https://custom.example/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: "grok-4.5" }] }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await page.getByLabel("API URL").fill("https://custom.example/v1");
  await page.getByLabel("API key").fill("migration-test-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await settings.getByRole("checkbox", { name: "Enable grok-4.5" }).click();

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("cherrychat");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("modelOverrides", "readwrite");
      transaction.objectStore("modelOverrides").put({
        connectionScope: "byok:https://custom.example:openai",
        modelId: "grok-4.5",
        override: {
          reasoning: true,
          supportedEfforts: [],
          vision: true,
          contextWindow: 32_768,
        },
        updatedAt: new Date().toISOString(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await settings.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  const reloadedSettings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, reloadedSettings, "Model management");
  await selectSettingsModel(
    page,
    reloadedSettings,
    "Selected model",
    "grok-4.5",
  );

  await expect(reloadedSettings.getByLabel("Context window")).toHaveValue(
    "500000",
  );
  await expect(reloadedSettings.getByLabel("Reasoning options")).toHaveValue(
    "low, medium, high",
  );
  await expect(
    reloadedSettings.getByText(
      "Model capabilities use built-in recommendations",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  const migrated = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("cherrychat");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const result = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction("modelOverrides", "readonly");
      const request = transaction
        .objectStore("modelOverrides")
        .get(["byok:https://custom.example:openai", "grok-4.5"]);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return result;
  });
  expect(migrated).toMatchObject({ override: {}, capabilityVersion: 2 });
});

test("keeps the latest connection model list when an older refresh finishes late", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop connection flow");
  let connectionARequestCount = 0;
  let markStaleRefreshStarted: () => void = () => undefined;
  let releaseStaleRefresh: () => void = () => undefined;
  const staleRefreshStarted = new Promise<void>((resolve) => {
    markStaleRefreshStarted = resolve;
  });
  const staleRefreshRelease = new Promise<void>((resolve) => {
    releaseStaleRefresh = resolve;
  });

  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
  });
  await page.route("https://connection-a.example/v1/models", async (route) => {
    connectionARequestCount += 1;
    if (connectionARequestCount > 1) {
      markStaleRefreshStarted();
      await staleRefreshRelease;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: "model-from-a" }] }),
    });
  });
  await page.route("https://connection-b.example/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [{ id: "model-from-b-1" }, { id: "model-from-b-2" }],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  const save = settings.getByRole("button", {
    name: "Save connection",
    exact: true,
  });
  const refresh = settings.getByRole("button", { name: "Refresh models" });

  await page.getByLabel("API URL").fill("https://connection-a.example/v1/");
  await page.getByLabel("API key").fill("connection-a-key");
  await save.click();
  await expect(settings.getByLabel("1 model found")).toBeVisible();

  await refresh.click();
  await staleRefreshStarted;
  await page.getByLabel("API URL").fill("https://connection-b.example/v1/");
  await page.getByLabel("API key").fill("connection-b-key");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(settings.getByLabel("2 models found")).toBeVisible();

  releaseStaleRefresh();
  await expect(refresh).toBeEnabled();
  await expect(settings.getByLabel("2 models found")).toBeVisible();
  await expect(
    settings.getByRole("checkbox", { name: "Enable model-from-a" }),
  ).toHaveCount(0);
  await settings
    .getByRole("checkbox", { name: "Enable model-from-b-1" })
    .click();
  await settings
    .getByRole("checkbox", { name: "Enable model-from-b-2" })
    .click();
  await selectSettingsPage(page, settings, "Model management");
  const defaultModel = settings.locator("#settings-default-model");
  await defaultModel.click();
  const visibleModels = await page.getByRole("option").allTextContents();
  expect(visibleModels).toEqual(
    expect.arrayContaining(["model-from-b-1", "model-from-b-2"]),
  );
  expect(visibleModels).not.toContain("model-from-a");
});

test("distinguishes rejected hosted sign-in from an invalid access code", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop i18n flow");
  await mockConfig(page, {
    byokEnabled: false,
    hostedEnabled: true,
    models: ["hosted-model"],
    defaultModel: "hosted-model",
  });
  let attempts = 0;
  await page.route("**/api/auth", async (route) => {
    attempts += 1;
    const forbidden = attempts === 1;
    await route.fulfill({
      status: forbidden ? 403 : 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: forbidden
          ? { code: "FORBIDDEN", message: "Origin is rejected" }
          : { code: "UNAUTHORIZED", message: "Access code is invalid" },
      }),
    });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("cherrychat.language", "zh-CN");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("main", { name: "设置" });
  await selectSettingsPage(page, settings, "模型服务");
  await page
    .getByRole("textbox", { name: "访问码", exact: true })
    .fill("wrong-code");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();

  await expect(settings.getByRole("alert")).toHaveText(
    "模型服务拒绝了当前连接，请检查 API 密钥和访问权限",
  );

  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect(settings.getByRole("alert")).toHaveText("API 密钥或访问码无效");
});

test("keeps cancelled deletion intact and searches and restores an archived chat", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop archive flow");
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "Archived searchable answer" },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await prepareByokPage(page);
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Archive target");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Archived searchable answer")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Archive target", exact: true })
      .locator("xpath=..")
      .locator(".conversation-relative-time"),
  ).toBeVisible();

  const actions = page.getByRole("button", {
    name: "More actions for Archive target",
  });
  await actions.click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("button", { name: "Archive target", exact: true }),
  ).toBeVisible();

  await actions.click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(
    page.getByRole("button", { name: "Archive target", exact: true }),
  ).toHaveCount(0);

  await page
    .getByRole("complementary", { name: "Chat history" })
    .locator(".conversation-history-heading")
    .getByRole("button", { name: "Search chats", exact: true })
    .click();
  await page
    .getByPlaceholder("Search titles or message text")
    .fill("searchable");
  await page
    .getByRole("dialog", { name: "Search chats" })
    .getByRole("button", { name: /Archive target/u })
    .click();
  await expect(page.getByText("Archived searchable answer")).toBeVisible();

  await page.getByRole("button", { name: "Archived chats" }).click();
  await page
    .getByRole("button", { name: "More actions for Archive target" })
    .click();
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Back to chats" }).click();
  await expect(
    page.getByRole("button", { name: "Archive target", exact: true }),
  ).toBeVisible();
});

test("restores an archived chat with its active model after reload", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop archive flow");
  const generationRequests: Record<string, unknown>[] = [];
  await mockConfig(page, {
    defaultModel: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "o3-mini"],
  });
  await page.route("https://api.openai.com/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [{ id: "gpt-4.1-mini" }, { id: "o3-mini" }],
      }),
    });
  });
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      if (payload.stream === false) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "Keep model" } }],
          }),
        });
        return;
      }
      generationRequests.push(payload);
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: `o3 answer ${generationRequests.length}` },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await page.goto("/");
  await saveByokConnection(page, false, ["o3-mini"]);

  const modelTrigger = page.locator(".model-selector-trigger");
  await modelTrigger.click();
  await page.getByRole("option", { name: "o3-mini" }).click();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Keep model");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("o3 answer 1")).toBeVisible();

  await page
    .getByRole("button", { name: "More actions for Keep model" })
    .click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await page.reload();
  await expect(modelTrigger).toHaveAccessibleName(
    "Selected model: gpt-4.1-mini",
  );

  await page.getByRole("button", { name: "Archived chats" }).click();
  await page
    .getByRole("button", { name: "More actions for Keep model" })
    .click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await expect(modelTrigger).toHaveAccessibleName("Selected model: o3-mini");
  await expect(page.getByText("o3 answer 1")).toBeVisible();

  await page.getByRole("button", { name: "Back to chats" }).click();
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(page.getByText("o3 answer 2")).toBeVisible();
  expect(generationRequests).toHaveLength(2);
  expect(generationRequests[1]).toMatchObject({ model: "o3-mini" });
});

test("deletes the active conversation and selects the remaining conversation", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop deletion flow");
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "Saved answer" },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await prepareByokPage(page);

  const composer = page.getByRole("textbox", { name: "Message CherryChat" });
  await composer.fill("Conversation to keep");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Saved answer")).toBeVisible();

  await page
    .getByRole("complementary", { name: "Chat history" })
    .locator(".new-chat-button")
    .click();
  await composer.fill("Conversation to delete");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Saved answer")).toBeVisible();

  await page
    .getByRole("button", { name: "More actions for Conversation to keep" })
    .click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const titleInput = page.getByLabel("Chat title");
  await expect(titleInput).toHaveValue("Conversation to keep");
  await titleInput.fill("Unsaved title");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page
    .getByRole("button", { name: "More actions for Conversation to delete" })
    .click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect(titleInput).toHaveValue("Conversation to delete");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page
    .getByRole("button", { name: "More actions for Conversation to delete" })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();

  const deletedConversation = page.getByRole("button", {
    name: "Conversation to delete",
    exact: true,
  });
  const remainingConversation = page.getByRole("button", {
    name: "Conversation to keep",
    exact: true,
  });
  await expect(deletedConversation).toHaveCount(0);
  await expect
    .soft(remainingConversation)
    .toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(
    page
      .getByRole("complementary", { name: "Chat history" })
      .locator(".new-chat-button"),
  ).toBeEnabled();
  await expect(deletedConversation).toHaveCount(0);
  await expect(remainingConversation).toHaveAttribute("aria-current", "page");
});

test("deletes an actively generating conversation without resurrecting it", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop deletion race");
  let generation = 0;
  let releaseActiveRequest: () => void = () => undefined;
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      generation += 1;
      if (generation === 2) {
        await new Promise<void>((resolve) => {
          releaseActiveRequest = resolve;
        });
        await route.abort("aborted").catch(() => undefined);
        return;
      }
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "Conversation kept after active deletion" },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await prepareByokPage(page);

  const composer = page.getByRole("textbox", { name: "Message CherryChat" });
  await composer.fill("Stable neighbor");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Conversation kept after active deletion"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stable neighbor", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("complementary", { name: "Chat history" })
    .locator(".new-chat-button")
    .click();
  await composer.fill("Delete while generating");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByRole("button", { name: "Stop generating" }),
  ).toBeVisible();
  await expect(
    page.locator(
      ".conversation-item.current .conversation-generation-indicator",
    ),
  ).toBeVisible();

  const generatingConversation = page
    .getByRole("navigation")
    .getByRole("button", { name: "New chat", exact: true });
  await expect(generatingConversation).toBeVisible();
  await page
    .locator(".conversation-item.current .conversation-menu-trigger")
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  releaseActiveRequest();

  const remainingConversation = page.getByRole("button", {
    name: "Stable neighbor",
    exact: true,
  });
  await expect(generatingConversation).toHaveCount(0);
  await expect(remainingConversation).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("ConversationNotFoundError")).toHaveCount(0);

  await page.reload();
  await expect(generatingConversation).toHaveCount(0);
  await expect(remainingConversation).toHaveAttribute("aria-current", "page");
});

test("uses hosted web search immediately after access-code sign-in", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "chromium",
    "desktop hosted search flow",
  );
  let hostedSearchPosts = 0;
  let hostedChatPosts = 0;
  let expireHostedSession = false;
  await mockConfig(page, {
    byokEnabled: false,
    hostedEnabled: true,
    hostedWebSearchEnabled: true,
    models: ["gpt-4.1-mini"],
    defaultModel: "gpt-4.1-mini",
    authenticated: false,
  });
  await page.route("**/api/auth", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ authenticated: true }),
    });
  });
  await page.route("**/api/web-search", async (route) => {
    hostedSearchPosts += 1;
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().postDataJSON()).toEqual({
      query: "Web search connection test",
      maxResults: 6,
    });
    await route.fulfill({
      status: expireHostedSession ? 401 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        expireHostedSession
          ? { error: { code: "UNAUTHORIZED", message: "expired" } }
          : {
              query: "Web search connection test",
              results: [],
            },
      ),
    });
  });
  await page.route("**/api/chat", async (route) => {
    hostedChatPosts += 1;
    await route.fulfill({
      contentType: "text/event-stream",
      body: "data: [DONE]\n\n",
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await settings
    .getByRole("textbox", { name: "Access code", exact: true })
    .fill("visitor-code");
  await settings.getByRole("button", { name: "Save connection" }).click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();

  await selectSettingsPage(page, settings, "Web search");
  await expect(
    settings.getByText("Site search", { exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByLabel("Personal Tavily API key (optional)"),
  ).toHaveValue("");
  const resultCount = settings.getByRole("slider", {
    name: "Sources per search",
  });
  await expect(resultCount).toHaveAttribute("aria-valuemin", "1");
  await expect(resultCount).toHaveAttribute("aria-valuemax", "50");
  await expect(resultCount).toHaveAttribute("aria-valuenow", "5");
  await resultCount.press("ArrowRight");
  await expect(resultCount).toHaveAttribute("aria-valuenow", "6");
  await expect(
    settings.getByRole("switch", { name: "Allow web search" }),
  ).toBeChecked();
  await settings.getByRole("button", { name: "Test connection" }).click();

  await expect.poll(() => hostedSearchPosts).toBe(1);
  await expect(settings.getByText("Search is connected.")).toBeVisible();

  const personalKey = settings.getByLabel("Personal Tavily API key (optional)");
  await expect(personalKey).toBeDisabled();
  await expect(settings.getByLabel("Tavily API URL")).toBeDisabled();
  await expect(
    settings.getByText(
      "Access-code mode uses only site search. Switch to Custom API to edit your personal key.",
    ),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Test connection" }).click();
  await expect.poll(() => hostedSearchPosts).toBe(2);
  await settings.getByRole("button", { name: "Save web search" }).click();
  await expect(settings.getByText("Web search settings saved.")).toBeVisible();
  await expectNoHorizontalOverflow(settings);

  await settings.getByRole("button", { name: "Close" }).click();
  await page
    .getByRole("button", { name: "Enable web search for this chat" })
    .click();
  await page.getByRole("button", { name: "Settings" }).click();
  await selectSettingsPage(page, settings, "Web search");
  expireHostedSession = true;
  await settings.getByRole("button", { name: "Test connection" }).click();
  await expect(settings.getByRole("alert")).toContainText(
    "Web search could not be reached",
  );
  await expect(settings.getByText("Access code required")).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();

  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Answer only with current information");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText(
      "Web search is unavailable. Check the access code, personal key, or current model.",
    ),
  ).toBeVisible();
  expect(hostedChatPosts).toBe(0);
});

test("runs Tavily tools in order and restores their sources after reload", async ({
  page,
}) => {
  test.skip(
    !["chromium", "mobile-chrome"].includes(test.info().project.name),
    "desktop and mobile Chromium workflow",
  );
  const mobile = test.info().project.name === "mobile-chrome";
  const streamRequests: Array<Record<string, unknown>> = [];
  let streamStep = 0;
  let tavilyAuthorization: string | undefined;
  let tavilyPosts = 0;

  await mockConfig(page);
  await mockModels(page);
  await page.route("https://search.example/tavily/search", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-headers": "Authorization, Content-Type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-origin": "*",
        },
      });
      return;
    }
    tavilyPosts += 1;
    tavilyAuthorization = route.request().headers().authorization;
    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        results: [
          {
            title: "CherryChat source",
            url: "https://example.com/cherrychat/current",
            content: "Verified current information",
          },
        ],
      }),
    });
  });
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.stream === false) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "Search test" } }],
          }),
        });
        return;
      }
      streamRequests.push(body);
      streamStep += 1;
      const chunks =
        streamStep === 1
          ? [
              {
                choices: [
                  {
                    index: 0,
                    delta: { content: "I will check." },
                    finish_reason: null,
                  },
                ],
              },
              {
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          id: "call-web-1",
                          type: "function",
                          function: {
                            name: "web_search",
                            arguments: '{"query":"CherryChat current"}',
                          },
                        },
                        {
                          index: 1,
                          id: "call-web-duplicate",
                          type: "function",
                          function: {
                            name: "web_search",
                            arguments: '{"query":"  CherryChat current  "}',
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              },
              {
                choices: [
                  {
                    index: 0,
                    delta: null,
                    finish_reason: "tool_calls",
                  },
                ],
              },
            ]
          : [
              {
                choices: [
                  {
                    index: 0,
                    delta: { content: "Search-backed answer." },
                    finish_reason: "stop",
                  },
                ],
              },
            ];
      const done = streamStep === 1 ? "" : "data: [DONE]\n\n";
      await route.fulfill({
        contentType: "text/event-stream",
        body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}${done}`,
      });
    },
  );

  await page.goto("/");
  await saveByokConnection(page, mobile);
  const openSidebar = page.getByRole("button", { name: "Open sidebar" });
  if (await openSidebar.isVisible()) {
    await openSidebar.click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Web search");
  await settings.getByLabel("Tavily API key").fill("tvly-browser-test-key");
  await settings
    .getByLabel("Tavily API URL")
    .fill("https://search.example/tavily/search");
  await settings.getByRole("switch", { name: "Allow web search" }).click();
  await settings.getByRole("button", { name: "Save web search" }).click();
  await expect(settings.getByText("Web search settings saved.")).toBeVisible();
  await expectNoHorizontalOverflow(settings);
  await settings.getByRole("button", { name: "Close" }).click();

  await page
    .getByRole("button", { name: "Enable web search for this chat" })
    .click();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Find current CherryChat information");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => tavilyPosts).toBe(1);
  await expect.poll(() => streamRequests.length).toBe(2);
  expect(tavilyAuthorization).toBe("Bearer tvly-browser-test-key");
  await expect(page.getByText("I will check.")).toBeVisible();
  await expect(page.getByText("Sources found: 1")).toBeVisible();
  await expect(page.getByText("Search-backed answer.")).toBeVisible();
  await page.getByText("Sources found: 1").click();
  await expect(
    page.getByRole("link", { name: "CherryChat source" }),
  ).toHaveAttribute("href", "https://example.com/cherrychat/current");
  await expect(page.getByText("example.com")).toBeVisible();
  expect(streamRequests).toHaveLength(2);
  expect(streamRequests[0]?.tools).toEqual([
    expect.objectContaining({
      type: "function",
      function: expect.objectContaining({
        name: "web_search",
        strict: true,
      }),
    }),
  ]);
  expect(streamRequests[0]?.tool_choice).toBeUndefined();
  expect(streamRequests[1]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        content: "I will check.",
        tool_calls: [expect.objectContaining({ id: "call-web-1" })],
      }),
      expect.objectContaining({ role: "tool", tool_call_id: "call-web-1" }),
    ]),
  );
  expect(JSON.stringify(streamRequests[1]?.messages)).not.toContain(
    "call-web-duplicate",
  );

  await page.reload();
  await expect(page.getByText("I will check.")).toBeVisible();
  await expect(page.getByText("Sources found: 1")).toBeVisible();
  await expect(page.getByText("Search-backed answer.")).toBeVisible();
  const orderedText = await page
    .locator(".message-assistant .message-bubble")
    .last()
    .locator(":scope > *")
    .allTextContents();
  expect(
    orderedText.findIndex((text) => text.includes("I will check.")),
  ).toBeLessThan(
    orderedText.findIndex((text) => text.includes("Sources found: 1")),
  );
  expect(
    orderedText.findIndex((text) => text.includes("Sources found: 1")),
  ).toBeLessThan(
    orderedText.findIndex((text) => text.includes("Search-backed answer.")),
  );
  await expectNoHorizontalOverflow(page.locator("body"));
});
