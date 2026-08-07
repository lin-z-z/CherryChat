import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  selectSettingsModel,
  selectSettingsOption,
  selectSettingsPage,
} from "./settings-helpers";

import {
  anthropicMessageDelta,
  anthropicMessageStart,
  anthropicSse,
  mockConfig,
} from "./chat-test-helpers";
test("uses a user's Custom API without an access code", async ({ page }) => {
  test.skip(
    !["chromium", "firefox", "mobile-chrome"].includes(
      test.info().project.name,
    ),
    "connection and model-selection flow",
  );
  const mobile = test.info().project.name === "mobile-chrome";
  const completionModels: string[] = [];
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["openai/gpt-5-mini"],
    defaultModel: "openai/gpt-5-mini",
  });
  await page.route("https://custom.example/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          { id: "openai/gpt-5-mini" },
          { id: "xai/grok-4.5" },
          { id: "mistral/mistral-small-latest" },
          { id: "gemini-3.1-pro" },
          { id: "company/private-chat-model" },
        ],
      }),
    });
  });
  await page.route(
    "https://custom.example/v1/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON() as {
        model: string;
        stream: boolean;
      };
      completionModels.push(body.model);
      if (!body.stream) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "Custom API naming model" } }],
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "The selected model answered successfully." },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await page.goto("/");
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");

  await expect(page.getByLabel("Access code")).toHaveCount(0);
  await page.getByLabel("API URL").fill("https://custom.example/v1");
  await page.getByLabel("API key").fill("user-api-key");
  const modelRequest = page.waitForRequest("https://custom.example/v1/models");
  const save = settings.getByRole("button", {
    name: "Save connection",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.click();

  const request = await modelRequest;
  expect(request.headers().authorization).toBe("Bearer user-api-key");
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await expect(settings.getByLabel("5 models found")).toBeVisible();
  await expect(
    settings.getByRole("checkbox", { name: "Enable openai/gpt-5-mini" }),
  ).toBeChecked();
  await expect(
    settings.getByRole("checkbox", { name: "Enable openai/gpt-5-mini" }),
  ).toBeDisabled();
  await settings.getByRole("checkbox", { name: "Enable xai/grok-4.5" }).click();
  await settings
    .getByRole("checkbox", {
      name: "Enable mistral/mistral-small-latest",
    })
    .click();
  await settings
    .getByRole("checkbox", {
      name: "Enable gemini-3.1-pro",
    })
    .click();
  const activeModelCheckbox = settings.getByRole("checkbox", {
    name: "Enable openai/gpt-5-mini",
  });
  await expect(activeModelCheckbox).toBeEnabled();
  await activeModelCheckbox.click();
  await expect(activeModelCheckbox).not.toBeChecked();
  await expect(
    settings
      .locator(".model-enablement-item")
      .filter({ hasText: "xai/grok-4.5" })
      .locator("img"),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Save model selection" }),
  ).toHaveCount(0);
  await expect(
    settings.getByText("Saved automatically with 3 models enabled."),
  ).toBeVisible();
  await expectNoHorizontalOverflow(settings);
  await page.screenshot({
    path: `test-results/model-enablement-${test.info().project.name}.png`,
    fullPage: true,
  });

  await selectSettingsPage(page, settings, "Model management");
  await selectSettingsModel(
    page,
    settings,
    "Chat title model",
    "mistral/mistral-small-latest",
  );
  await settings.getByRole("button", { name: "Save title model" }).click();
  await expect(settings.getByText("Chat title model saved.")).toBeVisible();
  await expectNoHorizontalOverflow(settings);
  await page.screenshot({
    path: `test-results/model-roles-${test.info().project.name}.png`,
    fullPage: true,
  });
  await selectSettingsModel(
    page,
    settings,
    "Selected model",
    "openai/gpt-5-mini",
  );
  await expect(settings.getByLabel("Selected model")).toContainText(
    "openai/gpt-5-mini",
  );
  await expect(
    settings.getByRole("switch", { name: "Reasoning support" }),
  ).toBeChecked();
  await expect(
    settings.getByRole("switch", { name: "Image input" }),
  ).toBeChecked();
  await expect(settings.getByLabel("Reasoning options")).toHaveValue(
    "minimal, low, medium, high",
  );
  await expect(
    settings.getByText(
      "Model capabilities use the model catalogue recommendation",
      { exact: true },
    ),
  ).toBeVisible();

  await selectSettingsModel(page, settings, "Selected model", "xai/grok-4.5");
  await expect(settings.getByLabel("Context window")).toHaveValue("500000");
  await expect(settings.getByLabel("Reasoning options")).toHaveValue(
    "low, medium, high",
  );
  await expect(
    settings.getByText("Model capabilities use built-in recommendations", {
      exact: true,
    }),
  ).toBeVisible();

  await selectSettingsModel(
    page,
    settings,
    "Selected model",
    "mistral/mistral-small-latest",
  );
  await expect(
    settings.getByText(
      "Model capabilities use the model catalogue recommendation",
      { exact: true },
    ),
  ).toBeVisible();

  await selectSettingsModel(page, settings, "Selected model", "gemini-3.1-pro");
  await expect(settings.getByLabel("Context window")).toHaveValue("1048576");
  await expect(settings.getByLabel("Reasoning options")).toHaveValue(
    "low, medium, high",
  );
  await expect(
    settings.getByText(
      "Model capabilities use the model catalogue recommendation",
      { exact: true },
    ),
  ).toBeVisible();

  await settings.getByRole("button", { name: "Close" }).click();
  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "gemini-3.1-pro" }).click();
  const geminiEffort = page.getByRole("button", {
    name: "Reasoning effort: Model default",
  });
  await geminiEffort.click();
  await expect(page.getByRole("option", { name: "Low" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Medium" })).toBeVisible();
  await expect(page.getByRole("option", { name: "High" })).toBeVisible();
  await page.getByRole("option", { name: "Model default" }).click();

  await page.locator(".model-selector-trigger").click();
  await expect(
    page.getByRole("option", { name: "company/private-chat-model" }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "xai/grok-4.5" }).click();
  const effort = page.getByRole("button", {
    name: "Reasoning effort: Model default",
  });
  await effort.click();
  await expect(page.getByRole("option", { name: "Low" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Medium" })).toBeVisible();
  await page.getByRole("option", { name: "High" }).click();
  await expect(
    page.getByRole("button", { name: "Reasoning effort: High" }),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill(
      "Explain why selecting a smaller enabled model list makes a model service easier to use while keeping title generation independent.",
    );
  await page.getByRole("button", { name: "Send" }).click();
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await expect(
    page.getByRole("button", { name: "Custom API naming model", exact: true }),
  ).toBeVisible();
  expect(completionModels).toEqual([
    "xai/grok-4.5",
    "mistral/mistral-small-latest",
  ]);
});

test("serializes DeepSeek V4 reasoning levels on a Custom OpenAI-compatible endpoint", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "DeepSeek wire contract");
  const chatBodies: Record<string, unknown>[] = [];
  let responseIndex = 0;
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["deepseek-v4-flash"],
    defaultModel: "deepseek-v4-flash",
  });
  await page.route("https://deepseek.example/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }],
      }),
    });
  });
  await page.route(
    "https://deepseek.example/v1/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.stream === false) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "DeepSeek title" } }],
          }),
        });
        return;
      }
      chatBodies.push(body);
      responseIndex += 1;
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: `DeepSeek answer ${responseIndex}` },
              finish_reason: "stop",
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await selectSettingsOption(
    page,
    settings,
    "API type",
    "Custom OpenAI compatible",
  );
  await settings.getByLabel("API URL").fill("https://deepseek.example/v1");
  await settings.getByLabel("API key").fill("deepseek-test-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await expect(settings.getByLabel("2 models found")).toBeVisible();
  await settings
    .getByRole("checkbox", { name: "Enable deepseek-v4-pro" })
    .click();
  await settings.getByRole("button", { name: "Close" }).click();

  const defaultLabel = "Model default (DeepSeek official: thinking on · High)";
  const send = async (message: string, answer: string) => {
    await page
      .getByRole("textbox", { name: "Message CherryChat" })
      .fill(message);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(answer)).toBeVisible();
  };
  const choose = async (label: string) => {
    await page.getByRole("button", { name: /^Reasoning effort:/u }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
  };

  await expect(
    page.getByRole("button", { name: `Reasoning effort: ${defaultLabel}` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Reasoning effort: ${defaultLabel}` })
    .click();
  await expect(
    page.getByRole("option", { name: "Off", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Low", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "High", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Maximum", exact: true }),
  ).toBeVisible();
  await page.getByRole("option", { name: defaultLabel }).click();
  await send("A", "DeepSeek answer 1");
  await choose("Off");
  await send("B", "DeepSeek answer 2");
  await choose("Low");
  await send("C", "DeepSeek answer 3");
  await choose("High");
  await send("D", "DeepSeek answer 4");
  await choose("Maximum");
  await send("E", "DeepSeek answer 5");

  expect(chatBodies).toHaveLength(5);
  expect(chatBodies[0]).not.toHaveProperty("thinking");
  expect(chatBodies[0]).not.toHaveProperty("reasoning_effort");
  expect(chatBodies[1]).toMatchObject({
    thinking: { type: "disabled" },
  });
  expect(chatBodies[1]).not.toHaveProperty("reasoning_effort");
  for (const [index, effort] of ["low", "high", "max"].entries()) {
    expect(chatBodies[index + 2]).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: effort,
    });
  }
  expect(chatBodies.every((body) => !("reasoning" in body))).toBe(true);

  await choose("Low");
  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "deepseek-v4-pro" }).click();
  await expect(
    page.getByRole("button", { name: `Reasoning effort: ${defaultLabel}` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Reasoning effort: ${defaultLabel}` })
    .click();
  await expect(page.getByRole("option", { name: "Low" })).toHaveCount(0);
  await page.getByRole("option", { name: "Maximum" }).click();
  await send("F", "DeepSeek answer 6");
  expect(chatBodies[5]).toMatchObject({
    model: "deepseek-v4-pro",
    thinking: { type: "enabled" },
    reasoning_effort: "max",
  });
});

test("shows DeepSeek V4 controls for Hosted OpenAI Chat", async ({ page }) => {
  test.skip(test.info().project.name !== "chromium", "DeepSeek Hosted control");
  await mockConfig(page, {
    byokEnabled: false,
    hostedEnabled: true,
    authenticated: true,
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    defaultModel: "deepseek-v4-flash",
  });

  await page.goto("/");
  const defaultLabel = "Model default (DeepSeek official: thinking on · High)";
  await page
    .getByRole("button", { name: `Reasoning effort: ${defaultLabel}` })
    .click();
  await expect(page.getByRole("option", { name: "Low" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Maximum" })).toBeVisible();
});

test("shows DeepSeek V4 controls for a New API openai-chat model", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "chromium",
    "DeepSeek New API control",
  );
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["deepseek-v4-flash"],
    defaultModel: "deepseek-v4-flash",
  });
  await page.route("https://new-api.example/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "deepseek-v4-flash",
            supported_endpoint_types: ["openai"],
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await selectSettingsOption(page, settings, "API type", "New API");
  await settings.getByLabel("API URL").fill("https://new-api.example/v1");
  await settings.getByLabel("API key").fill("new-api-test-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();

  const defaultLabel = "Model default (DeepSeek official: thinking on · High)";
  await page
    .getByRole("button", { name: `Reasoning effort: ${defaultLabel}` })
    .click();
  await expect(page.getByRole("option", { name: "Low" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Maximum" })).toBeVisible();
});

test("serializes GLM reasoning controls on a Custom OpenAI-compatible endpoint", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "GLM wire contract");
  const chatBodies: Record<string, unknown>[] = [];
  let responseIndex = 0;
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["glm-5.2"],
    defaultModel: "glm-5.2",
  });
  await page.route("https://glm.example/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [{ id: "glm-5.2" }, { id: "glm-4.7" }],
      }),
    });
  });
  await page.route("https://glm.example/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.stream === false) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: "GLM title" } }],
        }),
      });
      return;
    }
    chatBodies.push(body);
    responseIndex += 1;
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: { content: `GLM answer ${responseIndex}` },
            finish_reason: "stop",
          },
        ],
      })}\n\ndata: [DONE]\n\n`,
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await selectSettingsOption(
    page,
    settings,
    "API type",
    "Custom OpenAI compatible",
  );
  await settings.getByLabel("API URL").fill("https://glm.example/v1");
  await settings.getByLabel("API key").fill("glm-test-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await settings.getByRole("checkbox", { name: "Enable glm-4.7" }).click();
  await settings.getByRole("button", { name: "Close" }).click();

  const glm52Default = "Model default (GLM official: thinking mode on · Max)";
  const glmSwitchDefault = "Model default (GLM official: thinking mode on)";
  const choose = async (label: string) => {
    await page.getByRole("button", { name: /^Reasoning effort:/u }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
  };
  const send = async (message: string, answer: string) => {
    await page
      .getByRole("textbox", { name: "Message CherryChat" })
      .fill(message);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(answer)).toBeVisible();
  };

  await page
    .getByRole("button", { name: `Reasoning effort: ${glm52Default}` })
    .click();
  expect(await page.getByRole("option").allTextContents()).toEqual([
    glm52Default,
    "Off",
    "High",
    "Maximum",
  ]);
  await page.getByRole("option", { name: glm52Default }).click();
  await send("A", "GLM answer 1");
  await choose("Off");
  await send("B", "GLM answer 2");
  await choose("High");
  await send("C", "GLM answer 3");
  await choose("Maximum");
  await send("D", "GLM answer 4");

  expect(chatBodies).toHaveLength(4);
  expect(chatBodies[0]).not.toHaveProperty("thinking");
  expect(chatBodies[0]).not.toHaveProperty("reasoning_effort");
  expect(chatBodies[1]).toMatchObject({ thinking: { type: "disabled" } });
  expect(chatBodies[1]).not.toHaveProperty("reasoning_effort");
  expect(chatBodies[2]).toMatchObject({
    thinking: { type: "enabled", clear_thinking: false },
    reasoning_effort: "high",
  });
  expect(chatBodies[3]).toMatchObject({
    thinking: { type: "enabled", clear_thinking: false },
    reasoning_effort: "max",
  });
  expect(chatBodies.every((body) => !("reasoning" in body))).toBe(true);

  await choose("High");
  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "glm-4.7" }).click();
  await expect(
    page.getByRole("button", {
      name: `Reasoning effort: ${glmSwitchDefault}`,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Reasoning effort: ${glmSwitchDefault}` })
    .click();
  expect(await page.getByRole("option").allTextContents()).toEqual([
    glmSwitchDefault,
    "Off",
    "On",
  ]);
  await page.getByRole("option", { name: "On", exact: true }).click();
  await send("E", "GLM answer 5");
  expect(chatBodies[4]).toMatchObject({
    model: "glm-4.7",
    thinking: { type: "enabled", clear_thinking: false },
  });
  expect(chatBodies[4]).not.toHaveProperty("reasoning_effort");
});

test("shows GLM-5.2 controls for Hosted OpenAI Chat", async ({ page }) => {
  await mockConfig(page, {
    byokEnabled: false,
    hostedEnabled: true,
    authenticated: true,
    models: ["glm-5.2"],
    defaultModel: "glm-5.2",
  });

  await page.goto("/");
  const defaultLabel = "Model default (GLM official: thinking mode on · Max)";
  const trigger = page.getByRole("button", {
    name: `Reasoning effort: ${defaultLabel}`,
  });
  await expect(trigger).toBeVisible();
  await expect(trigger.locator(".reasoning-control-label")).toHaveText(
    "Model default",
  );
  await trigger.click();
  expect(await page.getByRole("option").allTextContents()).toEqual([
    defaultLabel,
    "Off",
    "High",
    "Maximum",
  ]);
  const defaultOption = page.getByRole("option", {
    name: defaultLabel,
    exact: true,
  });
  await expect(
    defaultOption.locator(".reasoning-control-option-label"),
  ).toHaveCSS("white-space", "normal");
  await expectNoHorizontalOverflow(page.locator(".reasoning-control-popover"));
  await expectNoHorizontalOverflow(page.locator("body"));
});

test("uses GLM controls only for New API openai-chat models", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "GLM New API contract");
  const chatBodies: Record<string, unknown>[] = [];
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["glm-4.7"],
    defaultModel: "glm-4.7",
  });
  await page.route("https://new-api-glm.example/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          { id: "glm-4.7", supported_endpoint_types: ["openai"] },
          {
            id: "glm-5.2",
            supported_endpoint_types: ["openai-response-compact"],
          },
        ],
      }),
    });
  });
  await page.route(
    "https://new-api-glm.example/v1/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      chatBodies.push(body);
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "New API GLM answer" },
              finish_reason: "stop",
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await selectSettingsOption(page, settings, "API type", "New API");
  await settings.getByLabel("API URL").fill("https://new-api-glm.example/v1");
  await settings.getByLabel("API key").fill("new-api-glm-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await settings.getByRole("checkbox", { name: "Enable glm-5.2" }).click();
  await settings.getByRole("button", { name: "Close" }).click();

  const defaultLabel = "Model default (GLM official: thinking mode on)";
  await page
    .getByRole("button", { name: `Reasoning effort: ${defaultLabel}` })
    .click();
  expect(await page.getByRole("option").allTextContents()).toEqual([
    defaultLabel,
    "Off",
    "On",
  ]);
  await page.getByRole("option", { name: "On", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Check New API GLM");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("New API GLM answer")).toBeVisible();
  expect(chatBodies[0]).toMatchObject({
    model: "glm-4.7",
    thinking: { type: "enabled", clear_thinking: false },
  });
  expect(chatBodies[0]).not.toHaveProperty("reasoning_effort");

  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "glm-5.2" }).click();
  await expect(
    page.getByRole("status", { name: "Automatic reasoning" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Reasoning effort:/u }),
  ).toHaveCount(0);
});

test("serializes Qwen and Kimi controls for Hosted OpenAI Chat", async ({
  page,
}) => {
  const chatBodies: Record<string, unknown>[] = [];
  let responseIndex = 0;
  await mockConfig(page, {
    byokEnabled: false,
    hostedEnabled: true,
    authenticated: true,
    models: ["qwen3.8-max", "kimi-k3"],
    defaultModel: "qwen3.8-max",
  });
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.stream === false) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: "Qwen Kimi title" } }],
        }),
      });
      return;
    }
    chatBodies.push(body);
    responseIndex += 1;
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: { content: `Hosted Qwen Kimi answer ${responseIndex}` },
            finish_reason: "stop",
          },
        ],
      })}\n\ndata: [DONE]\n\n`,
    });
  });

  await page.goto("/");
  const choose = async (label: string) => {
    await page.getByRole("button", { name: /^Reasoning effort:/u }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
  };
  const send = async (message: string, answer: string) => {
    await page
      .getByRole("textbox", { name: "Message CherryChat" })
      .fill(message);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(answer)).toBeVisible();
  };

  const qwenDefault = "Model default (Qwen official: XHigh)";
  await page
    .getByRole("button", { name: `Reasoning effort: ${qwenDefault}` })
    .click();
  expect(await page.getByRole("option").allTextContents()).toEqual([
    qwenDefault,
    "Off",
    "Low",
    "Medium",
    "Extra high",
  ]);
  await page.getByRole("option", { name: "Medium" }).click();
  await send("Hosted Qwen", "Hosted Qwen Kimi answer 1");

  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "kimi-k3" }).click();
  const kimiDefault = "Model default (Kimi official: Max)";
  await expect(
    page.getByRole("button", {
      name: `Reasoning effort: ${kimiDefault}`,
    }),
  ).toBeVisible();
  await choose("High");
  await send("Hosted Kimi", "Hosted Qwen Kimi answer 2");

  expect(chatBodies).toHaveLength(2);
  expect(chatBodies[0]).toMatchObject({
    model: "qwen3.8-max",
    reasoning_effort: "medium",
  });
  expect(chatBodies[0]).not.toHaveProperty("enable_thinking");
  expect(chatBodies[1]).toMatchObject({
    model: "kimi-k3",
    reasoning_effort: "high",
  });
  expect(chatBodies[1]).not.toHaveProperty("temperature");
  expect(chatBodies[1]).not.toHaveProperty("top_p");
  expect(
    chatBodies.every((body) => !("thinking" in body) && !("reasoning" in body)),
  ).toBe(true);
  await expectNoHorizontalOverflow(page.locator("body"));
});

test("serializes reviewed Qwen variants and Kimi on a Custom compatible endpoint", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "Qwen Kimi wire contract");
  const chatBodies: Record<string, unknown>[] = [];
  let responseIndex = 0;
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["qwen3.8-max"],
    defaultModel: "qwen3.8-max",
  });
  await page.route("https://qwen-kimi.example/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          { id: "qwen3.8-max" },
          { id: "qwen3.5-plus" },
          { id: "kimi-k3" },
        ],
      }),
    });
  });
  await page.route(
    "https://qwen-kimi.example/v1/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.stream === false) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "Qwen Kimi title" } }],
          }),
        });
        return;
      }
      chatBodies.push(body);
      responseIndex += 1;
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: `Custom Qwen Kimi answer ${responseIndex}` },
              finish_reason: "stop",
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await selectSettingsOption(
    page,
    settings,
    "API type",
    "Custom OpenAI compatible",
  );
  await settings.getByLabel("API URL").fill("https://qwen-kimi.example/v1");
  await settings.getByLabel("API key").fill("qwen-kimi-test-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await settings.getByRole("checkbox", { name: "Enable qwen3.5-plus" }).click();
  await settings.getByRole("checkbox", { name: "Enable kimi-k3" }).click();
  await settings.getByRole("button", { name: "Close" }).click();

  const choose = async (label: string) => {
    await page.getByRole("button", { name: /^Reasoning effort:/u }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
  };
  const send = async (message: string, answer: string) => {
    await page
      .getByRole("textbox", { name: "Message CherryChat" })
      .fill(message);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(answer)).toBeVisible();
  };

  await choose("Extra high");
  await send("Custom Qwen3.8", "Custom Qwen Kimi answer 1");

  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "qwen3.5-plus" }).click();
  const qwenSwitchDefault = "Model default (Qwen official: thinking mode on)";
  await expect(
    page.getByRole("button", {
      name: `Reasoning effort: ${qwenSwitchDefault}`,
    }),
  ).toBeVisible();
  await choose("On");
  await send("Custom hybrid Qwen", "Custom Qwen Kimi answer 2");

  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "kimi-k3" }).click();
  const kimiDefault = "Model default (Kimi official: Max)";
  await expect(
    page.getByRole("button", {
      name: `Reasoning effort: ${kimiDefault}`,
    }),
  ).toBeVisible();
  await choose("High");
  await send("Custom Kimi", "Custom Qwen Kimi answer 3");

  expect(chatBodies).toHaveLength(3);
  expect(chatBodies[0]).toMatchObject({
    model: "qwen3.8-max",
    reasoning_effort: "xhigh",
  });
  expect(chatBodies[0]).not.toHaveProperty("enable_thinking");
  expect(chatBodies[1]).toMatchObject({
    model: "qwen3.5-plus",
    enable_thinking: true,
  });
  expect(chatBodies[1]).not.toHaveProperty("reasoning_effort");
  expect(chatBodies[2]).toMatchObject({
    model: "kimi-k3",
    reasoning_effort: "high",
  });
  expect(chatBodies[2]).not.toHaveProperty("temperature");
  expect(chatBodies[2]).not.toHaveProperty("top_p");
  expect(
    chatBodies.every((body) => !("thinking" in body) && !("reasoning" in body)),
  ).toBe(true);
});

test("uses Qwen and Kimi controls only for New API openai-chat models", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "chromium",
    "Qwen Kimi New API contract",
  );
  const chatBodies: Record<string, unknown>[] = [];
  let responseIndex = 0;
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["qwen3.8-max"],
    defaultModel: "qwen3.8-max",
  });
  await page.route(
    "https://new-api-qwen-kimi.example/v1/models",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            { id: "qwen3.8-max", supported_endpoint_types: ["openai"] },
            { id: "kimi-k3", supported_endpoint_types: ["openai"] },
            {
              id: "qwen3.8-max-preview",
              supported_endpoint_types: ["openai-response-compact"],
            },
          ],
        }),
      });
    },
  );
  await page.route(
    "https://new-api-qwen-kimi.example/v1/chat/completions",
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.stream === false) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "New API Qwen Kimi title" } }],
          }),
        });
        return;
      }
      chatBodies.push(body);
      responseIndex += 1;
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: {
                content: `New API Qwen Kimi answer ${responseIndex}`,
              },
              finish_reason: "stop",
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await selectSettingsOption(page, settings, "API type", "New API");
  await settings
    .getByLabel("API URL")
    .fill("https://new-api-qwen-kimi.example/v1");
  await settings.getByLabel("API key").fill("new-api-qwen-kimi-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await settings.getByRole("checkbox", { name: "Enable kimi-k3" }).click();
  await settings
    .getByRole("checkbox", { name: "Enable qwen3.8-max-preview" })
    .click();
  await settings.getByRole("button", { name: "Close" }).click();

  const choose = async (label: string) => {
    await page.getByRole("button", { name: /^Reasoning effort:/u }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
  };
  const send = async (message: string, answer: string) => {
    await page
      .getByRole("textbox", { name: "Message CherryChat" })
      .fill(message);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(answer)).toBeVisible();
  };

  await choose("Off");
  await send("New API Qwen", "New API Qwen Kimi answer 1");
  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "kimi-k3" }).click();
  const kimiDefault = "Model default (Kimi official: Max)";
  await expect(
    page.getByRole("button", {
      name: `Reasoning effort: ${kimiDefault}`,
    }),
  ).toBeVisible();
  await choose("Maximum");
  await send("New API Kimi", "New API Qwen Kimi answer 2");

  expect(chatBodies).toHaveLength(2);
  expect(chatBodies[0]).toMatchObject({
    model: "qwen3.8-max",
    enable_thinking: false,
  });
  expect(chatBodies[0]).not.toHaveProperty("reasoning_effort");
  expect(chatBodies[1]).toMatchObject({
    model: "kimi-k3",
    reasoning_effort: "max",
  });
  expect(chatBodies[1]).not.toHaveProperty("temperature");
  expect(chatBodies[1]).not.toHaveProperty("top_p");

  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "qwen3.8-max-preview" }).click();
  await expect(
    page.getByRole("status", { name: "Automatic reasoning" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Reasoning effort:/u }),
  ).toHaveCount(0);
});

test("routes Gemini native Custom API discovery and chat through its adapter", async ({
  page,
}) => {
  const mobile = test.info().project.name === "mobile-chrome";
  let discoveryRequest = false;
  let chatRequestBody: Record<string, unknown> | null = null;
  let gemini25RequestBody: Record<string, unknown> | null = null;
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["gpt-4.1-mini"],
    defaultModel: "gpt-4.1-mini",
  });
  await page.route(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    async (route) => {
      discoveryRequest = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            {
              name: "models/gemini-3.1-pro",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/gemini-2.5-flash",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      });
    },
  );
  await page.route(
    "**/v1beta/models/gemini-2.5-flash:streamGenerateContent**",
    async (route) => {
      gemini25RequestBody = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({
            candidates: [
              { content: { parts: [{ text: "Gemini 2.5 answer" }] } },
            ],
          })}`,
          "data: [DONE]",
          "",
        ].join("\n\n"),
      });
    },
  );
  await page.route(
    "**/v1beta/models/gemini-3.1-pro:streamGenerateContent**",
    async (route) => {
      chatRequestBody = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "Native reasoning", thought: true }],
                },
              },
            ],
          })}`,
          `data: ${JSON.stringify({
            candidates: [
              { content: { parts: [{ text: "Gemini native answer" }] } },
            ],
            usageMetadata: {
              promptTokenCount: 12,
              candidatesTokenCount: 4,
              thoughtsTokenCount: 3,
              totalTokenCount: 19,
            },
          })}`,
          "data: [DONE]",
          "",
        ].join("\n\n"),
      });
    },
  );
  await page.goto("/");
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await selectSettingsOption(page, settings, "API type", "Gemini");
  await expect(settings.getByLabel("API type")).toContainText("Gemini");
  await expect(settings.getByLabel("API URL")).toHaveValue(
    "https://generativelanguage.googleapis.com",
  );
  await settings.getByLabel("API key").fill("gemini-test-key");
  await settings.getByRole("button", { name: "Save connection" }).click();
  await expect.poll(() => discoveryRequest).toBe(true);
  await expect(settings.getByLabel("2 models found")).toBeVisible();
  await settings
    .getByRole("checkbox", {
      name: "Enable gemini-3.1-pro",
    })
    .click();
  await settings
    .getByRole("checkbox", {
      name: "Enable gemini-2.5-flash",
    })
    .click();
  await settings.getByRole("button", { name: "Close" }).click();

  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "gemini-3.1-pro" }).click();
  await page
    .getByRole("button", { name: "Reasoning effort: Model default" })
    .click();
  await page.getByRole("option", { name: "Medium" }).click();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Hello Gemini");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Gemini native answer")).toBeVisible();
  expect(chatRequestBody).toMatchObject({
    contents: [
      {
        role: "user",
        parts: [{ text: "Hello Gemini" }],
      },
    ],
    generationConfig: {
      thinkingConfig: {
        includeThoughts: true,
        thinkingLevel: "medium",
      },
    },
  });

  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page
    .getByRole("complementary", { name: "Chat history" })
    .locator(".new-chat-button")
    .click();
  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "gemini-2.5-flash" }).click();
  await page
    .getByRole("button", { name: "Reasoning effort: Model default" })
    .click();
  await expect(page.getByRole("option", { name: "Off" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Auto" })).toBeVisible();
  await page.getByRole("option", { name: "Low" }).click();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Hello Gemini 2.5");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Gemini 2.5 answer")).toBeVisible();
  expect(gemini25RequestBody).toMatchObject({
    generationConfig: {
      thinkingConfig: {
        includeThoughts: true,
        thinkingBudget: 1_228,
      },
    },
  });
  expect(gemini25RequestBody).not.toHaveProperty(
    "generationConfig.thinkingConfig.thinkingLevel",
  );

  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const reloadedSettings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, reloadedSettings, "Model service");
  await expect(
    reloadedSettings.getByRole("combobox", { name: "API type" }),
  ).toContainText("Gemini");
});

test("runs New API Gemini tools, reload replay, and stop on the AI SDK runtime", async ({
  page,
}) => {
  const mobile = test.info().project.name === "mobile-chrome";
  const chatRequests: Record<string, unknown>[] = [];
  const chatHeaders: Record<string, string>[] = [];
  let tavilyPosts = 0;
  let releaseStoppedRequest: () => void = () => undefined;

  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["gpt-4.1-mini"],
    defaultModel: "gpt-4.1-mini",
  });
  await page.route("https://new-api.example/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "gemini-3.1-pro",
            supported_endpoint_types: ["gemini"],
          },
        ],
      }),
    });
  });
  await page.route("https://search.example/gemini/search", async (route) => {
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
    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        results: [
          {
            title: "Gemini provider guide",
            url: "https://example.com/gemini/provider-guide",
            content: "Provider guidance from the search fixture",
          },
        ],
      }),
    });
  });
  await page.route(
    "https://new-api.example/v1beta/models/gemini-3.1-pro:*GenerateContent**",
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(":generateContent")) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "New API Gemini title" }],
                },
                finishReason: "STOP",
              },
            ],
          }),
        });
        return;
      }

      const requestIndex = chatRequests.length + 1;
      chatRequests.push(
        route.request().postDataJSON() as Record<string, unknown>,
      );
      chatHeaders.push(route.request().headers());
      if (requestIndex === 4) {
        await new Promise<void>((resolve) => {
          releaseStoppedRequest = resolve;
        });
        await route.abort("aborted").catch(() => undefined);
        return;
      }

      const events =
        requestIndex === 1
          ? [
              {
                candidates: [
                  {
                    content: {
                      role: "model",
                      parts: [
                        {
                          functionCall: {
                            name: "web_search",
                            args: { query: "Gemini provider guide" },
                          },
                          thoughtSignature: "gemini-e2e-signature",
                        },
                      ],
                    },
                    finishReason: "STOP",
                  },
                ],
              },
            ]
          : [
              {
                candidates: [
                  {
                    content: {
                      role: "model",
                      parts: [
                        {
                          text:
                            requestIndex === 2
                              ? "New API Gemini searched."
                              : "Reloaded Gemini answer.",
                        },
                      ],
                    },
                    finishReason: "STOP",
                  },
                ],
              },
            ];
      await route.fulfill({
        contentType: "text/event-stream",
        body: `${events
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join("")}data: [DONE]\n\n`,
      });
    },
  );

  await page.goto("/");
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await selectSettingsOption(page, settings, "API type", "New API");
  await settings.getByLabel("API URL").fill("https://new-api.example/v1");
  await settings.getByLabel("API key").fill("new-api-gemini-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByLabel("1 model found")).toBeVisible();
  await settings
    .getByRole("checkbox", { name: "Enable gemini-3.1-pro" })
    .click();
  await selectSettingsPage(page, settings, "Web search");
  await settings.getByLabel("Tavily API key").fill("tvly-gemini-e2e-key");
  await settings
    .getByLabel("Tavily API URL")
    .fill("https://search.example/gemini");
  await settings.getByRole("switch", { name: "Allow web search" }).click();
  await settings.getByRole("button", { name: "Save web search" }).click();
  await expect(settings.getByText("Web search settings saved.")).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();

  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "gemini-3.1-pro" }).click();
  await page
    .getByRole("button", { name: "Enable web search for this chat" })
    .click();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Search Gemini guide");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("New API Gemini searched.")).toBeVisible();
  await expect(page.getByText("Sources found: 1")).toBeVisible();
  await expect.poll(() => tavilyPosts).toBe(1);
  await expect.poll(() => chatRequests.length).toBe(2);
  expect(chatHeaders[0]).toMatchObject({
    authorization: "Bearer new-api-gemini-key",
    "x-goog-api-key": "new-api-gemini-key",
  });
  expect(JSON.stringify(chatRequests[1])).toContain("gemini-e2e-signature");
  await expect(page.getByText("gemini-e2e-signature")).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("New API Gemini searched.")).toBeVisible();
  await expect(page.getByText("Sources found: 1")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Continue after reload");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Reloaded Gemini answer.")).toBeVisible();
  await expect.poll(() => chatRequests.length).toBe(3);
  expect(JSON.stringify(chatRequests[2])).toContain("gemini-e2e-signature");

  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Stop this response");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => chatRequests.length).toBe(4);
  const stopButton = page.getByRole("button", { name: "Stop generating" });
  await expect(stopButton).toBeVisible();
  await stopButton.click();
  releaseStoppedRequest();
  await expect(stopButton).toBeHidden();
  expect(chatRequests).toHaveLength(4);
  await expectNoHorizontalOverflow(page.locator("body"));
});

test("routes direct Anthropic discovery and chat through its adapter", async ({
  page,
}) => {
  const mobile = test.info().project.name === "mobile-chrome";
  let discoveryHeaders: Record<string, string> | null = null;
  let chatHeaders: Record<string, string> | null = null;
  let chatRequestBody: Record<string, unknown> | null = null;
  const model = "claude-sonnet-4-6";

  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["gpt-4.1-mini"],
    defaultModel: "gpt-4.1-mini",
  });
  await page.route("https://api.anthropic.com/v1/models", async (route) => {
    discoveryHeaders = route.request().headers();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: model }] }),
    });
  });
  await page.route("https://api.anthropic.com/v1/messages", async (route) => {
    const requestBody = route.request().postDataJSON() as Record<
      string,
      unknown
    >;
    if (requestBody.stream === false) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "anthropic-title",
          type: "message",
          role: "assistant",
          model,
          content: [{ type: "text", text: "Anthropic title" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 4, output_tokens: 2 },
        }),
      });
      return;
    }

    chatHeaders = route.request().headers();
    chatRequestBody = requestBody;
    await route.fulfill({
      contentType: "text/event-stream",
      body: anthropicSse([
        anthropicMessageStart(model),
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "thinking_delta",
            thinking: "Anthropic direct reasoning.",
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "signature_delta",
            signature: "anthropic-direct-signature",
          },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: {
            type: "text_delta",
            text: "Anthropic direct answer.",
          },
        },
        { type: "content_block_stop", index: 1 },
        anthropicMessageDelta("end_turn"),
        { type: "message_stop" },
      ]),
    });
  });

  await page.goto("/");
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await selectSettingsOption(page, settings, "API type", "Anthropic");
  await expect(settings.getByLabel("API URL")).toHaveValue(
    "https://api.anthropic.com",
  );
  await settings.getByLabel("API key").fill("anthropic-direct-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByLabel("1 model found")).toBeVisible();
  await settings.getByRole("checkbox", { name: `Enable ${model}` }).click();
  await settings.getByRole("button", { name: "Close" }).click();

  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: model }).click();
  await page
    .getByRole("button", { name: "Reasoning effort: Model default" })
    .click();
  await page.getByRole("option", { name: "Medium" }).click();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Hello Anthropic");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Anthropic direct answer.")).toBeVisible();
  await expect.poll(() => chatRequestBody).not.toBeNull();
  expect(discoveryHeaders).toMatchObject({
    "x-api-key": "anthropic-direct-key",
  });
  expect(discoveryHeaders).not.toHaveProperty("authorization");
  expect(chatHeaders).toMatchObject({
    "x-api-key": "anthropic-direct-key",
  });
  expect(chatHeaders).not.toHaveProperty("authorization");
  expect(chatRequestBody).toMatchObject({
    model,
    stream: true,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
  });
  await expect(page.getByText("anthropic-direct-signature")).toHaveCount(0);
});

test("runs New API Anthropic tools, reload replay, and stop on the AI SDK runtime", async ({
  page,
}) => {
  const mobile = test.info().project.name === "mobile-chrome";
  const model = "claude-sonnet-4-6";
  const chatRequests: Record<string, unknown>[] = [];
  const chatHeaders: Record<string, string>[] = [];
  let tavilyPosts = 0;
  let releaseStoppedRequest: () => void = () => undefined;

  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["gpt-4.1-mini"],
    defaultModel: "gpt-4.1-mini",
  });
  await page.route(
    "https://new-api-anthropic.example/v1/models",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: model,
              supported_endpoint_types: ["anthropic"],
            },
          ],
        }),
      });
    },
  );
  await page.route("https://search.example/anthropic/search", async (route) => {
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
    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        results: [
          {
            title: "Anthropic provider guide",
            url: "https://example.com/anthropic/provider-guide",
            content: "Provider guidance from the Anthropic search fixture",
          },
        ],
      }),
    });
  });
  await page.route(
    "https://new-api-anthropic.example/v1/messages",
    async (route) => {
      const requestBody = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      if (requestBody.stream === false) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            id: "anthropic-new-api-title",
            type: "message",
            role: "assistant",
            model,
            content: [{ type: "text", text: "New API Anthropic title" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 4, output_tokens: 2 },
          }),
        });
        return;
      }

      const requestIndex = chatRequests.length + 1;
      chatRequests.push(requestBody);
      chatHeaders.push(route.request().headers());
      if (requestIndex === 4) {
        await new Promise<void>((resolve) => {
          releaseStoppedRequest = resolve;
        });
        await route.abort("aborted").catch(() => undefined);
        return;
      }

      const events =
        requestIndex === 1
          ? [
              anthropicMessageStart(model),
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "thinking", thinking: "" },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: {
                  type: "thinking_delta",
                  thinking: "I should search Anthropic guidance.",
                },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: {
                  type: "signature_delta",
                  signature: "anthropic-e2e-signature",
                },
              },
              { type: "content_block_stop", index: 0 },
              {
                type: "content_block_start",
                index: 1,
                content_block: {
                  type: "redacted_thinking",
                  data: "anthropic-e2e-redacted-data",
                },
              },
              { type: "content_block_stop", index: 1 },
              {
                type: "content_block_start",
                index: 2,
                content_block: {
                  type: "tool_use",
                  id: "anthropic-search-call",
                  name: "web_search",
                  input: {},
                },
              },
              {
                type: "content_block_delta",
                index: 2,
                delta: {
                  type: "input_json_delta",
                  partial_json: JSON.stringify({
                    query: "Anthropic provider guide",
                  }),
                },
              },
              { type: "content_block_stop", index: 2 },
              anthropicMessageDelta("tool_use", 8),
              { type: "message_stop" },
            ]
          : [
              anthropicMessageStart(model, 20),
              {
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: "" },
              },
              {
                type: "content_block_delta",
                index: 0,
                delta: {
                  type: "text_delta",
                  text:
                    requestIndex === 2
                      ? "New API Anthropic searched."
                      : "Reloaded Anthropic answer.",
                },
              },
              { type: "content_block_stop", index: 0 },
              anthropicMessageDelta("end_turn", 4),
              { type: "message_stop" },
            ];
      await route.fulfill({
        contentType: "text/event-stream",
        body: anthropicSse(events),
      });
    },
  );

  await page.goto("/");
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await selectSettingsOption(page, settings, "API type", "New API");
  await settings
    .getByLabel("API URL")
    .fill("https://new-api-anthropic.example/v1");
  await settings.getByLabel("API key").fill("new-api-anthropic-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByLabel("1 model found")).toBeVisible();
  await settings.getByRole("checkbox", { name: `Enable ${model}` }).click();
  await selectSettingsPage(page, settings, "Web search");
  await settings.getByLabel("Tavily API key").fill("tvly-anthropic-e2e-key");
  await settings
    .getByLabel("Tavily API URL")
    .fill("https://search.example/anthropic");
  await settings.getByRole("switch", { name: "Allow web search" }).click();
  await settings.getByRole("button", { name: "Save web search" }).click();
  await expect(settings.getByText("Web search settings saved.")).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();

  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: model }).click();
  await page
    .getByRole("button", { name: "Reasoning effort: Model default" })
    .click();
  await page.getByRole("option", { name: "Medium" }).click();
  await page
    .getByRole("button", { name: "Enable web search for this chat" })
    .click();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Search Anthropic guide");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("New API Anthropic searched.")).toBeVisible();
  await expect(page.getByText("Sources found: 1")).toBeVisible();
  await expect.poll(() => tavilyPosts).toBe(1);
  await expect.poll(() => chatRequests.length).toBe(2);
  expect(chatHeaders[0]).toMatchObject({
    authorization: "Bearer new-api-anthropic-key",
    "x-api-key": "new-api-anthropic-key",
  });
  expect(JSON.stringify(chatRequests[1])).toContain("anthropic-e2e-signature");
  expect(JSON.stringify(chatRequests[1])).toContain(
    "anthropic-e2e-redacted-data",
  );
  await expect(page.getByText("anthropic-e2e-signature")).toHaveCount(0);
  await expect(page.getByText("anthropic-e2e-redacted-data")).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("New API Anthropic searched.")).toBeVisible();
  await expect(page.getByText("Sources found: 1")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Continue after Anthropic reload");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Reloaded Anthropic answer.")).toBeVisible();
  await expect.poll(() => chatRequests.length).toBe(3);
  expect(JSON.stringify(chatRequests[2])).toContain("anthropic-e2e-signature");
  expect(JSON.stringify(chatRequests[2])).toContain(
    "anthropic-e2e-redacted-data",
  );

  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Stop this Anthropic response");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => chatRequests.length).toBe(4);
  const stopButton = page.getByRole("button", { name: "Stop generating" });
  await expect(stopButton).toBeVisible();
  await stopButton.click();
  releaseStoppedRequest();
  await expect(stopButton).toBeHidden();
  expect(chatRequests).toHaveLength(4);
  await expectNoHorizontalOverflow(page.locator("body"));
});

test("routes OpenAI Responses discovery and chat through its adapter", async ({
  page,
}) => {
  const mobile = test.info().project.name === "mobile-chrome";
  let discoveryRequest = false;
  const chatRequestBodies: Record<string, unknown>[] = [];
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: false,
    models: ["gpt-4.1-mini"],
    defaultModel: "gpt-4.1-mini",
  });
  await page.route("https://api.openai.com/v1/models", async (route) => {
    discoveryRequest = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: "gpt-5.4-mini" }] }),
    });
  });
  await page.route("https://api.openai.com/v1/responses", async (route) => {
    const requestBody = route.request().postDataJSON() as Record<
      string,
      unknown
    >;
    if (requestBody.stream === false) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "response-title",
          created_at: 1,
          model: "gpt-5.4-mini",
          output: [
            {
              type: "message",
              role: "assistant",
              id: "message-title",
              content: [
                {
                  type: "output_text",
                  text: "Responses title",
                  annotations: [],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 4,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 2,
            output_tokens_details: { reasoning_tokens: 0 },
          },
        }),
      });
      return;
    }
    const responseIndex = chatRequestBodies.length + 1;
    chatRequestBodies.push(requestBody);
    await route.fulfill({
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({
          type: "response.created",
          response: {
            id: `response-${responseIndex}`,
            created_at: responseIndex,
            model: "gpt-5.4-mini",
          },
        })}`,
        `data: ${JSON.stringify({
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "reasoning",
            id: `reasoning-${responseIndex}`,
            encrypted_content: null,
          },
        })}`,
        `data: ${JSON.stringify({
          type: "response.reasoning_summary_text.delta",
          item_id: `reasoning-${responseIndex}`,
          summary_index: 0,
          delta: `Responses reasoning ${responseIndex}`,
        })}`,
        `data: ${JSON.stringify({
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "reasoning",
            id: `reasoning-${responseIndex}`,
            encrypted_content: `encrypted-context-${responseIndex}`,
          },
        })}`,
        `data: ${JSON.stringify({
          type: "response.output_item.added",
          output_index: 1,
          item: { type: "message", id: `message-${responseIndex}` },
        })}`,
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          item_id: `message-${responseIndex}`,
          delta: `Responses native answer ${responseIndex}`,
        })}`,
        `data: ${JSON.stringify({
          type: "response.output_item.done",
          output_index: 1,
          item: { type: "message", id: `message-${responseIndex}` },
        })}`,
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            status: "completed",
            error: null,
            incomplete_details: null,
            usage: {
              input_tokens: 11,
              output_tokens: 6,
              total_tokens: 17,
              output_tokens_details: { reasoning_tokens: 2 },
            },
          },
        })}`,
        "",
      ].join("\n\n"),
    });
  });

  await page.goto("/");
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await settings.getByRole("combobox", { name: "API type" }).click();
  await expect(
    page.getByRole("option", { name: "OpenAI Responses" }),
  ).toBeVisible();
  await expect(page.getByRole("option", { name: "OpenRouter" })).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: "Alibaba Bailian" }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "OpenAI Responses" }).click();
  await expect(settings.getByLabel("API URL")).toHaveValue(
    "https://api.openai.com",
  );
  await settings.getByLabel("API key").fill("responses-test-key");
  await settings.getByRole("button", { name: "Save connection" }).click();
  await expect.poll(() => discoveryRequest).toBe(true);
  await settings.getByRole("checkbox", { name: "Enable gpt-5.4-mini" }).click();
  await settings.getByRole("button", { name: "Close" }).click();

  await page.locator(".model-selector-trigger").click();
  await page.getByRole("option", { name: "gpt-5.4-mini" }).click();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Hello Responses");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Responses native answer 1")).toBeVisible();
  await expect.poll(() => chatRequestBodies.length).toBeGreaterThan(0);
  expect(chatRequestBodies[0]).toMatchObject({
    model: "gpt-5.4-mini",
    input: expect.arrayContaining([
      {
        role: "user",
        content: [{ type: "input_text", text: "Hello Responses" }],
      },
    ]),
    stream: true,
  });

  expect(chatRequestBodies[0]).toMatchObject({
    store: false,
    include: ["reasoning.encrypted_content"],
  });
  await page.reload();
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Continue Responses");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Responses native answer 2")).toBeVisible();
  await expect.poll(() => chatRequestBodies.length).toBe(2);
  expect(chatRequestBodies[1]?.input).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "reasoning",
        id: "reasoning-1",
        encrypted_content: "encrypted-context-1",
      }),
      expect.objectContaining({
        role: "user",
        content: [{ type: "input_text", text: "Continue Responses" }],
      }),
    ]),
  );
});
