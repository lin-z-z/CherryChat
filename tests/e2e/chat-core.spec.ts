import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  selectSettingsOption,
  selectSettingsPage,
  waitForChatAppReady,
} from "./settings-helpers";

import {
  finishControlledStream,
  installControlledChatStream,
  mockConfig,
  mockModels,
  prepareByokPage,
  pushControlledChunk,
  saveByokConnection,
} from "./chat-test-helpers";
test("sends a BYOK chat and regenerates an assistant branch", async ({
  page,
}) => {
  await mockConfig(page);
  await mockModels(page);
  let generation = 0;
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      generation += 1;
      const answer = generation === 1 ? "First answer" : "Second answer";
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({
            choices: [
              {
                index: 0,
                delta: { content: answer },
                finish_reason: null,
              },
            ],
          })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""),
      });
    },
  );

  const mobile = test.info().project.name === "mobile-chrome";
  await page.goto("/");
  await saveByokConnection(page, mobile);

  const composer = page.getByRole("textbox", { name: "Message CherryChat" });
  await composer.fill("Hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("First answer")).toBeVisible();
  await expect(page.locator(".chat-stage")).not.toHaveClass(
    /chat-stage-empty/u,
  );
  const stageBox = await page.locator(".chat-stage").boundingBox();
  const frameBox = await page.locator(".composer-frame").boundingBox();
  expect(stageBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  expect(
    (stageBox?.y ?? 0) +
      (stageBox?.height ?? 0) -
      ((frameBox?.y ?? 0) + (frameBox?.height ?? 0)),
  ).toBeGreaterThanOrEqual(
    test.info().project.name === "mobile-chrome" ? 12 : 20,
  );

  const geometry = await page
    .locator(".chat-workspace")
    .evaluate((workspace) => {
      const composer = workspace.querySelector<HTMLElement>(".composer-region");
      const frame = workspace.querySelector<HTMLElement>(".composer-frame");
      const messages = workspace.querySelector<HTMLElement>(".message-column");
      if (!composer || !frame) throw new Error("Missing composer geometry");
      if (!messages) throw new Error("Missing message geometry");
      const workspaceBox = workspace.getBoundingClientRect();
      const composerBox = composer.getBoundingClientRect();
      const frameBox = frame.getBoundingClientRect();
      const messagesBox = messages.getBoundingClientRect();
      return {
        composerCenter: composerBox.left + composerBox.width / 2,
        frameLeftInset: frameBox.left - composerBox.left,
        frameRightInset: composerBox.right - frameBox.right,
        messageCenter: messagesBox.left + messagesBox.width / 2,
        messageWidth: messagesBox.width,
        composerFormCenter: frameBox.left + frameBox.width / 2,
        composerFormWidth: frameBox.width,
        workspaceCenter: workspaceBox.left + workspaceBox.width / 2,
      };
    });
  expect(
    Math.abs(geometry.workspaceCenter - geometry.composerCenter),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(geometry.frameLeftInset - geometry.frameRightInset),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(geometry.messageCenter - geometry.composerFormCenter),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(geometry.messageWidth - geometry.composerFormWidth),
  ).toBeLessThanOrEqual(mobile ? 2 : 2);
  const userMark = page.locator("article.message-user .user-mark");
  if (mobile) {
    await expect(userMark).toBeHidden();
  } else {
    await expect(userMark).toBeVisible();
  }
  await page.screenshot({
    path: `test-results/chat-populated-${test.info().project.name}.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "Copy" }).first().hover();
  await expect(page.getByRole("tooltip", { name: "Copy" })).toBeVisible();
  await page.getByRole("button", { name: "Regenerate" }).hover();
  await expect(page.getByRole("tooltip", { name: "Regenerate" })).toBeVisible();
  await page
    .locator("article.message-assistant")
    .last()
    .getByRole("button", { name: "Clear context from here" })
    .hover();
  await expect(
    page.getByRole("tooltip", { name: "Clear context from here" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(page.getByText("Second answer")).toBeVisible();
  await expect(page.getByText("2/2")).toBeVisible();
  expect(generation).toBe(2);
});

test("keeps 401 and 429 LLM failures inside retryable assistant branches", async ({
  page,
}) => {
  const mobile = test.info().project.name === "mobile-chrome";
  let generation = 0;
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      generation += 1;
      if (generation === 1) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "UNAUTHORIZED", message: "invalid test key" },
          }),
        });
        return;
      }
      if (generation === 2) {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "RATE_LIMITED", message: "test rate limit" },
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
              delta: { content: "Recovered after retry" },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await prepareByokPage(page, mobile);

  await page.getByRole("textbox", { name: "Message CherryChat" }).fill("Hello");
  await page.getByRole("button", { name: "Send" }).click();

  let errorCard = page.locator(".message-error-card");
  await expect(errorCard).toContainText("API key or access code is invalid");
  await expect(page.locator(".chat-error")).toHaveCount(0);
  await errorCard.getByRole("button", { name: "Regenerate" }).click();
  await expect(errorCard).toContainText("Too many requests");
  await expect(page.getByText("2/2")).toBeVisible();
  await expect(page.locator(".chat-error")).toHaveCount(0);
  if (test.info().project.name === "chromium") {
    await page.screenshot({
      path: "test-results/chat-message-error-chromium.png",
      fullPage: true,
    });
  }

  await page.reload();
  errorCard = page.locator(".message-error-card");
  await expect(errorCard).toContainText("Too many requests");
  await errorCard.getByRole("button", { name: "Regenerate" }).click();

  await expect(page.getByText("Recovered after retry")).toBeVisible();
  await expect(page.getByText("3/3")).toBeVisible();
  expect(generation).toBe(3);
});

test("preserves partial output when an SSE response ends without DONE", async ({
  page,
}) => {
  const mobile = test.info().project.name === "mobile-chrome";
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "Partial answer remains" },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      });
    },
  );
  await prepareByokPage(page, mobile);

  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Stream failure");
  await page.getByRole("button", { name: "Send" }).click();

  const assistant = page.locator("article.message-assistant").last();
  await expect(assistant).toContainText("Partial answer remains");
  await expect(assistant.locator(".message-error-card")).toContainText(
    "The model response could not be read",
  );
  await expect(page.locator(".chat-error")).toHaveCount(0);
});

test("shows a configured request timeout on the affected assistant message", async ({
  page,
}) => {
  const mobile = test.info().project.name === "mobile-chrome";
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route
        .fulfill({
          contentType: "text/event-stream",
          body: "data: [DONE]\n\n",
        })
        .catch(() => undefined);
    },
  );
  await mockConfig(page, {
    requestTimeouts: {
      modelListMs: 30_000,
      chatFirstByteMs: 100,
      chatIdleMs: 1_000,
      chatTotalMs: 1_000,
    },
  });
  await mockModels(page);
  await page.goto("/");
  await saveByokConnection(page, mobile);

  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Timeout this request");
  await page.getByRole("button", { name: "Send" }).click();

  const assistant = page.locator("article.message-assistant").last();
  await expect(assistant.locator(".message-error-card")).toContainText(
    "The model response timed out",
  );
  await expect(
    assistant.getByRole("button", { name: "Regenerate" }),
  ).toBeVisible();
  await expect(page.locator(".chat-error")).toHaveCount(0);
});

test("shows model changes only inside an active chat", async ({ page }) => {
  await mockConfig(page);
  await page.route("https://api.openai.com/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [{ id: "gpt-4.1-mini" }, { id: "gpt-5-mini" }, { id: "o3-mini" }],
      }),
    });
  });
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "Model switch answer" },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await page.goto("/");
  await saveByokConnection(page, test.info().project.name === "mobile-chrome", [
    "gpt-5-mini",
    "o3-mini",
  ]);

  const modelTrigger = page.locator(".model-selector-trigger");
  await modelTrigger.click();
  await page.getByRole("option", { name: "o3-mini" }).click();
  await expect(page.locator(".model-switch-divider")).toHaveCount(0);

  await page.getByRole("textbox", { name: "Message CherryChat" }).fill("Hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Model switch answer")).toBeVisible();
  await expect(modelTrigger).toHaveAccessibleName("Selected model: o3-mini");
  await expect(page.getByText("Model: o3-mini")).toBeVisible();

  await modelTrigger.click();
  await page.getByRole("option", { name: "gpt-4.1-mini" }).click();
  await modelTrigger.click();
  await page.getByRole("option", { name: "gpt-5-mini" }).click();
  await expect(modelTrigger).toHaveAccessibleName("Selected model: gpt-5-mini");
  await expect(page.locator(".chat-error")).toHaveCount(0);
  const notice = page.locator(".model-switch-divider");
  await expect(notice).toHaveText("Model changed from o3-mini to gpt-5-mini");
  await expect(
    notice.locator("xpath=ancestor::*[contains(@class, 'message-column')]"),
  ).toHaveCount(1);

  await modelTrigger.click();
  await page.getByRole("option", { name: "o3-mini" }).click();
  await expect(notice).toHaveCount(0);

  await modelTrigger.click();
  await page.getByRole("option", { name: "gpt-4.1-mini" }).click();

  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("After switch");
  await page.getByRole("button", { name: "Send" }).click();
  const switchedMessage = page
    .locator("article.message-user")
    .filter({ hasText: "After switch" });
  await expect(switchedMessage).toBeVisible();
  await expect(
    notice
      .locator("xpath=following::article[contains(@class, 'message-user')]")
      .filter({ hasText: "After switch" }),
  ).toHaveCount(1);

  await modelTrigger.click();
  await page.getByRole("option", { name: "gpt-5-mini" }).click();
  await expect(notice).toHaveText(
    "Model changed from gpt-4.1-mini to gpt-5-mini",
  );
});

test("regenerates with the newly selected model and keeps the old reply", async ({
  page,
}) => {
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
            choices: [{ message: { content: "Regeneration title" } }],
          }),
        });
        return;
      }
      generationRequests.push(payload);
      const answer =
        payload.model === "o3-mini"
          ? "Regenerated o3 answer"
          : "Original gpt answer";
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: answer },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await page.goto("/");
  await saveByokConnection(page, test.info().project.name === "mobile-chrome", [
    "o3-mini",
  ]);

  await page.getByRole("textbox", { name: "Message CherryChat" }).fill("Hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Original gpt answer")).toBeVisible();

  const modelTrigger = page.locator(".model-selector-trigger");
  await modelTrigger.click();
  await page.getByRole("option", { name: "o3-mini" }).click();
  await page.getByRole("button", { name: "Regenerate" }).click();

  await expect(page.getByText("Regenerated o3 answer")).toBeVisible();
  expect(generationRequests).toHaveLength(2);
  expect(generationRequests[1]).toMatchObject({ model: "o3-mini" });
  await expect(page.getByText("Model: o3-mini")).toBeVisible();
  await expect(page.getByText("2/2")).toBeVisible();

  await page.getByRole("button", { name: "Previous version" }).click();
  await expect(page.getByText("Original gpt answer")).toBeVisible();
  await expect(page.getByText("Model: gpt-4.1-mini")).toBeVisible();
});

test("uses saved non-streaming and optional model parameters", async ({
  page,
}) => {
  let requestBody: Record<string, unknown> | null = null;
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: "Complete response" } }],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        }),
      });
    },
  );
  await prepareByokPage(page, test.info().project.name === "mobile-chrome");

  if (test.info().project.name === "mobile-chrome") {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model management");
  await settings.getByRole("switch", { name: "Streaming response" }).click();
  await settings
    .getByRole("switch", { name: "Enable response randomness" })
    .click();
  await settings
    .getByRole("spinbutton", { name: "Response randomness value" })
    .fill("0.6");
  await settings.getByRole("button", { name: "Save model settings" }).click();
  await settings.getByRole("button", { name: "Close" }).click();

  await page.getByRole("textbox", { name: "Message CherryChat" }).fill("Hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Complete response")).toBeVisible();
  expect(requestBody).toMatchObject({ temperature: 0.6 });
  expect(requestBody).not.toHaveProperty("stream");
  expect(requestBody).not.toHaveProperty("stream_options");
  expect(requestBody).not.toHaveProperty("top_p");
});

test("allows another send while automatic title generation is pending", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop generation flow");
  let releaseTitle: () => void = () => undefined;
  let markTitleStarted: () => void = () => undefined;
  let generation = 0;
  const titleRelease = new Promise<void>((resolve) => {
    releaseTitle = resolve;
  });
  const titleStarted = new Promise<void>((resolve) => {
    markTitleStarted = resolve;
  });

  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      const payload: unknown = route.request().postDataJSON();
      const isTitleRequest =
        typeof payload === "object" &&
        payload !== null &&
        "stream" in payload &&
        payload.stream === false;
      if (isTitleRequest) {
        markTitleStarted();
        await titleRelease;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "Generated title" } }],
          }),
        });
        return;
      }

      generation += 1;
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: {
                content:
                  generation === 1 ? "First main answer" : "Second main answer",
              },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await prepareByokPage(page);

  const composer = page.getByRole("textbox", { name: "Message CherryChat" });
  await composer.fill(
    "This first message is intentionally long enough to trigger automatic conversation title generation.",
  );
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("First main answer")).toBeVisible();
  await titleStarted;

  try {
    await expect(composer).toBeEnabled();
    await composer.fill("Send while the title request is still pending");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Second main answer")).toBeVisible({
      timeout: 5_000,
    });
    expect(generation).toBe(2);
  } finally {
    releaseTitle();
  }
});

test("uses the fixed same-origin target when BYOK Base URL is empty", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop transport flow");
  await mockConfig(page);
  let chatHeaders: Record<string, string> | null = null;
  await page.route("**/api/models", async (route) => {
    expect(route.request().headers()["x-cherrychat-mode"]).toBe("byok");
    expect(route.request().headers().authorization).toBe(
      "Bearer fixed-target-key",
    );
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: "gpt-4.1-mini" }] }),
    });
  });
  await page.route("**/api/chat", async (route) => {
    chatHeaders = route.request().headers();
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: { content: "Fixed target answer" },
            finish_reason: null,
          },
        ],
      })}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await page.getByLabel("API URL").fill("");
  await page.getByLabel("API key").fill("fixed-target-key");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await settings.getByRole("button", { name: "Close" }).click();

  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Use the fixed target");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Fixed target answer")).toBeVisible();
  expect(chatHeaders).toMatchObject({
    authorization: "Bearer fixed-target-key",
    "x-cherrychat-mode": "byok",
  });
});

test("stops an in-flight response and regenerates it", async ({ page }) => {
  test.skip(test.info().project.name !== "chromium", "desktop flow");
  let releaseFirstRequest: () => void = () => undefined;
  let generation = 0;

  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      generation += 1;
      if (generation === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstRequest = resolve;
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
              delta: { content: "Recovered answer" },
              finish_reason: "stop",
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await prepareByokPage(page);

  await page.getByRole("textbox", { name: "Message CherryChat" }).fill("Wait");
  await page.getByRole("button", { name: "Send" }).click();
  const stopButton = page.getByRole("button", { name: "Stop generating" });
  await expect(stopButton).toBeVisible();
  await expect.poll(() => generation, { timeout: 15_000 }).toBe(1);
  const stopColor = await stopButton.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--primary)";
    document.body.append(probe);
    const primary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { background: getComputedStyle(element).backgroundColor, primary };
  });
  expect(stopColor.background).toBe(stopColor.primary);
  await page.screenshot({
    path: `test-results/chat-stop-${test.info().project.name}.png`,
    fullPage: true,
  });
  await stopButton.click();
  releaseFirstRequest();
  await expect(stopButton).toBeHidden();

  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect.poll(() => generation, { timeout: 15_000 }).toBe(2);
  await expect(page.getByText("Recovered answer")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("2/2")).toBeVisible();
  expect(generation).toBe(2);
});

test("stops before the first token without leaving a typing indicator", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop stop flow");
  let releaseRequest: () => void = () => undefined;

  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      await new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });
      await route.abort("aborted").catch(() => undefined);
    },
  );
  await prepareByokPage(page);

  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Stop before first token");
  await page.getByRole("button", { name: "Send" }).click();
  const stopButton = page.getByRole("button", { name: "Stop generating" });
  await expect(stopButton).toBeVisible();
  await stopButton.click();
  releaseRequest();
  await expect(stopButton).toBeHidden();

  await expect(page.locator(".typing-indicator")).toHaveCount(0);

  await page.reload();
  await expect(
    page
      .getByRole("complementary", { name: "Chat history" })
      .locator(".new-chat-button"),
  ).toBeEnabled();
  await expect(page.locator(".typing-indicator")).toHaveCount(0);
});

test("keeps a reader's scroll position during a long streamed response", async ({
  page,
}) => {
  await installControlledChatStream(page);
  const mobile = test.info().project.name === "mobile-chrome";
  await prepareByokPage(page, mobile);

  const composer = page.getByRole("textbox", { name: "Message CherryChat" });
  await composer.fill("Write a long response");
  await page.getByRole("button", { name: "Send" }).click();

  const firstChunk = `${Array.from(
    { length: 80 },
    (_, index) => `Streaming paragraph ${index + 1}.`,
  ).join("\n\n")}\n\nFIRST_STREAM_MARKER`;
  await pushControlledChunk(page, firstChunk);
  await expect(
    page.getByText("FIRST_STREAM_MARKER", { exact: false }),
  ).toBeVisible();

  const scrollArea = page.locator(".message-scroll-area");
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(() => scrollArea.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await scrollArea.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(() => scrollArea.evaluate((element) => element.scrollTop))
    .toBe(0);

  const jumpToLatest = page.getByRole("button", { name: "Jump to latest" });
  try {
    await expect(jumpToLatest).toBeVisible();
    await pushControlledChunk(page, "\n\nLATEST_STREAM_MARKER");
    await expect(
      page.getByText("LATEST_STREAM_MARKER", { exact: false }),
    ).toBeVisible();
    const scrollTopAfterToken = await scrollArea.evaluate(async (element) => {
      await new Promise<void>((resolve) => {
        let frames = 0;
        const nextFrame = () => {
          frames += 1;
          if (frames === 4) resolve();
          else requestAnimationFrame(nextFrame);
        };
        requestAnimationFrame(nextFrame);
      });
      return element.scrollTop;
    });
    expect(scrollTopAfterToken).toBeLessThanOrEqual(1);

    await jumpToLatest.click();
    await expect
      .poll(() =>
        scrollArea.evaluate(
          (element) =>
            element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThan(3);
    await expect(jumpToLatest).toBeHidden();
  } finally {
    await finishControlledStream(page);
  }
});

test("grows the composer for multiple lines and resets it after sending", async ({
  page,
}) => {
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "Textarea reset answer" },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  const mobile = test.info().project.name === "mobile-chrome";
  await prepareByokPage(page, mobile);

  const composer = page.getByRole("textbox", { name: "Message CherryChat" });
  const initialHeight = (await composer.boundingBox())?.height;
  expect(initialHeight).toBeDefined();
  await composer.fill("First line\nSecond line\nThird line\nFourth line");
  await expect
    .poll(async () => (await composer.boundingBox())?.height ?? 0)
    .toBeGreaterThan((initialHeight ?? 0) + 20);

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Textarea reset answer")).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect
    .poll(async () => (await composer.boundingBox())?.height ?? 0)
    .toBeLessThanOrEqual((initialHeight ?? 0) + 1);
});

test("saves a user edit without sending and can send the saved user leaf", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop flow");
  const generationRequests: Record<string, unknown>[] = [];
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      if (payload.stream === false) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "Edited chat title" } }],
          }),
        });
        return;
      }
      generationRequests.push(payload);
      const answer =
        generationRequests.length === 1
          ? "Original answer"
          : "Saved edit answer";
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: answer },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await prepareByokPage(page);

  await page.getByRole("textbox", { name: "Message CherryChat" }).fill("Hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Original answer")).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const inlineEditor = page.locator("article.message-user.is-editing");
  await expect(page.getByRole("dialog", { name: "Edit message" })).toHaveCount(
    0,
  );
  await inlineEditor
    .getByRole("textbox", { name: "Message content" })
    .fill("Edited hello");
  await inlineEditor.getByRole("button", { name: "Save only" }).click();
  await expect(page.getByText("Edited hello", { exact: true })).toBeVisible();
  await expect(page.getByText("2/2")).toBeVisible();
  expect(generationRequests).toHaveLength(1);

  await page.getByRole("button", { name: "Send this message" }).click();
  await expect(page.getByText("Saved edit answer")).toBeVisible();
  expect(generationRequests).toHaveLength(2);
  expect(generationRequests[1]).toMatchObject({
    messages: expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "Edited hello" }),
    ]),
  });

  await page.getByRole("button", { name: "Previous version" }).click();
  await expect(
    page.locator("article.message-user").getByText("Hello", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Original answer")).toBeVisible();
});

test("saves and sends an edited message immediately", async ({ page }) => {
  test.skip(test.info().project.name !== "chromium", "desktop flow");
  const generationRequests: Record<string, unknown>[] = [];
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      if (payload.stream === false) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "Edited chat title" } }],
          }),
        });
        return;
      }
      generationRequests.push(payload);
      const answer =
        generationRequests.length === 1
          ? "Original immediate answer"
          : "Edited immediate answer";
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: answer },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await prepareByokPage(page);

  await page.getByRole("textbox", { name: "Message CherryChat" }).fill("Hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Original immediate answer")).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const inlineEditor = page.locator("article.message-user.is-editing");
  await expect(page.getByRole("dialog", { name: "Edit message" })).toHaveCount(
    0,
  );
  await inlineEditor
    .getByRole("textbox", { name: "Message content" })
    .fill("Edited and sent immediately");
  await inlineEditor.getByRole("button", { name: "Save and send" }).click();

  await expect(page.getByText("Edited immediate answer")).toBeVisible();
  expect(generationRequests).toHaveLength(2);
  expect(generationRequests[1]).toMatchObject({
    messages: expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: "Edited and sent immediately",
      }),
    ]),
  });
  await expect(page.getByText("2/2")).toBeVisible();
});

test("keeps the inline message editor usable at desktop and mobile widths", async ({
  page,
}) => {
  await mockConfig(page);
  await mockModels(page);
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      const payload = route.request().postDataJSON() as { stream?: boolean };
      if (payload.stream === false) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "Inline editor title" } }],
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
              delta: { content: "Inline editor answer" },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );

  const mobile = test.info().project.name === "mobile-chrome";
  await page.goto("/");
  await saveByokConnection(page, mobile);
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Open the inline editor");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Inline editor answer")).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator("article.message-user.is-editing");
  const content = editor.getByRole("textbox", { name: "Message content" });
  await content.fill(
    "Keep a long editable draft visible inside the original message bubble. ".repeat(
      8,
    ),
  );
  await expect(page.getByRole("dialog", { name: "Edit message" })).toHaveCount(
    0,
  );
  await expect(editor.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Save only" })).toBeVisible();
  const saveAndSend = editor.getByRole("button", { name: "Save and send" });
  await expect(saveAndSend).toBeVisible();
  await expectNoHorizontalOverflow(page.locator("body"));
  await expectNoHorizontalOverflow(editor);

  if (mobile) {
    const saveOnlyBox = await editor
      .getByRole("button", { name: "Save only" })
      .boundingBox();
    const saveAndSendBox = await saveAndSend.boundingBox();
    expect(saveOnlyBox).not.toBeNull();
    expect(saveAndSendBox).not.toBeNull();
    expect(saveAndSendBox?.y).toBeGreaterThan(saveOnlyBox?.y ?? 0);
  }
});

test("keeps pending and sent images inside their composer and message layers on mobile", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "mobile-chrome", "mobile flow");
  let requestBody: string | null = null;
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      requestBody = route.request().postData();
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "Image received" },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await prepareByokPage(page, true);

  await page.locator('input[type="file"]').setInputFiles("public/icon-192.png");
  const preview = page.getByAltText("Image preview");
  await expect(preview).toBeVisible();
  expect
    .soft(
      await preview.evaluate(
        (image) => image.closest("form.composer") !== null,
      ),
    )
    .toBe(true);
  await page.getByRole("textbox", { name: "Message CherryChat" }).fill("Look");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Image received")).toBeVisible();
  await expect(page.getByAltText("Attached image")).toBeVisible();
  expect(requestBody).toContain('"type":"image_url"');
  const userMessage = page.locator("article.message-user").filter({
    hasText: "Look",
  });
  await expect(userMessage).toBeVisible();
  const messageLayers = await userMessage.evaluate((article) => {
    const bubble = article.querySelector(".message-bubble");
    const actions = article.querySelector(".message-actions");
    return {
      actionsAreBubbleSibling:
        bubble !== null &&
        actions !== null &&
        bubble.parentElement === actions.parentElement,
      imageInsideBubble:
        bubble?.querySelector('img[alt="Attached image"]') != null,
      textInsideBubble: bubble?.textContent?.includes("Look") ?? false,
    };
  });
  expect.soft(messageLayers).toEqual({
    actionsAreBubbleSibling: true,
    imageInsideBubble: true,
    textInsideBubble: true,
  });

  await page.reload();
  await expect(page.getByText("Image received")).toBeVisible();
  await expect(page.getByAltText("Attached image")).toBeVisible();
});

test("persists fixed theme and manual language", async ({ page }) => {
  test.skip(test.info().project.name !== "chromium", "desktop flow");
  test.slow();
  await page.emulateMedia({ colorScheme: "light" });
  await mockConfig(page);
  await mockModels(page);
  await page.goto("/");

  const root = page.locator("html");
  await expect(root).toHaveClass(/light/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveClass(/dark/);
  const themeSwitcher = page.getByRole("button", { name: "Theme: System" });
  await themeSwitcher.click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(root).toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("cherrychat.theme")))
    .toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveClass(/dark/);
  await page.reload();
  await waitForChatAppReady(page, "Settings");
  await expect(root).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Theme: Dark" }).click();
  await page.getByRole("menuitemradio", { name: "System" }).click();
  await expect(root).toHaveClass(/light/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("cherrychat.theme")))
    .toBe("system");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await expect(settings.getByLabel("Theme")).toContainText("System");
  await selectSettingsOption(page, settings, "Theme", "Light");
  await selectSettingsOption(page, settings, "Interface language", "简体中文");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("cherrychat.language")),
    )
    .toBe("zh-CN");
  await expect(root).toHaveClass(/light/);
  await page.reload();
  await waitForChatAppReady(page, "设置");
  await expect(root).toHaveClass(/light/);
  await page.reload();
  await waitForChatAppReady(page, "设置");
});

test("selects Chinese for a Chinese browser on first visit", async ({
  browser,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop flow");
  const context = await browser.newContext({ locale: "zh-CN" });
  const page = await context.newPage();
  await mockConfig(page);
  await page.goto("/");

  await expect(page.getByRole("button", { name: "设置" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "给 CherryChat 发消息" }),
  ).toBeVisible();
  await context.close();
});

test("uses source-aware first-use defaults and preserves saved choices", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop default flow");
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: true,
    hostedWebSearchEnabled: true,
    hostedWebSearchProvider: "tavily",
    hostedWebSearchProviders: ["tavily"],
    models: ["gpt-4.1-mini"],
    defaultModel: "gpt-4.1-mini",
  });
  await mockModels(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");

  await expect(
    settings.getByRole("button", {
      name: "Connection method: Use an access code",
    }),
  ).toBeVisible();
  await expect(
    settings.getByRole("textbox", { name: "Access code", exact: true }),
  ).toBeVisible();
  const connectionSaveBox = await settings
    .getByRole("button", { name: "Save connection" })
    .boundingBox();

  await selectSettingsPage(page, settings, "Web search");
  const allowSearch = settings.getByRole("switch", {
    name: "Allow web search",
  });
  await expect(allowSearch).toBeChecked();
  const webSearchSaveBox = await settings
    .getByRole("button", { name: "Save web search" })
    .boundingBox();
  if (!connectionSaveBox || !webSearchSaveBox) {
    throw new Error("Settings action buttons must be visible");
  }
  expect(
    Math.abs(
      connectionSaveBox.x +
        connectionSaveBox.width -
        (webSearchSaveBox.x + webSearchSaveBox.width),
    ),
  ).toBeLessThanOrEqual(1);
  await allowSearch.click();
  await settings.getByRole("button", { name: "Save web search" }).click();
  await expect(settings.getByText("Web search settings saved.")).toBeVisible();

  await selectSettingsPage(page, settings, "Model service");
  await settings
    .getByRole("button", {
      name: "Connection method: Use an access code",
    })
    .click();
  await page.getByRole("menuitemradio", { name: /Custom API/u }).click();
  await settings.getByLabel("API key").fill("test-only-key");
  await settings.getByRole("button", { name: "Save connection" }).click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  const restoredSettings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, restoredSettings, "Model service");
  await expect(
    restoredSettings.getByRole("button", {
      name: "Connection method: Custom API",
    }),
  ).toBeVisible();
  await expect(restoredSettings.getByLabel("API key")).toHaveValue(
    "test-only-key",
  );

  await selectSettingsPage(page, restoredSettings, "Web search");
  await expect(
    restoredSettings.getByRole("switch", { name: "Allow web search" }),
  ).not.toBeChecked();
  await expect(
    restoredSettings.getByText("Personal setup required"),
  ).toBeVisible();
  await expect(
    restoredSettings.getByRole("button", { name: "Test connection" }),
  ).toBeDisabled();
});

test("persists an allowed Hosted search provider independently from list order", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "chromium",
    "desktop hosted search flow",
  );
  await mockConfig(page, {
    byokEnabled: true,
    hostedEnabled: true,
    hostedWebSearchEnabled: true,
    hostedWebSearchProvider: "tavily",
    hostedWebSearchProviders: ["grok", "tavily"],
    models: ["gpt-4.1-mini"],
    defaultModel: "gpt-4.1-mini",
    authenticated: true,
  });
  await mockModels(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Web search");

  const provider = settings.getByRole("combobox", {
    name: "Search provider",
  });
  await expect(provider).toBeEnabled();
  await expect(provider).toContainText("Tavily");
  await provider.click();
  await expect(page.getByRole("option", { name: "Exa" })).toHaveCount(0);
  await page.getByRole("option", { name: "Grok" }).click();
  await settings.getByRole("button", { name: "Save web search" }).click();
  await expect(settings.getByText("Web search settings saved.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  const restoredSettings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, restoredSettings, "Web search");
  await expect(
    restoredSettings.getByRole("combobox", { name: "Search provider" }),
  ).toContainText("Grok");
});

test("uses the deployment title model until the browser saves another choice", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop title flow");
  const requestModels: string[] = [];
  await mockConfig(page, {
    byokEnabled: false,
    hostedEnabled: true,
    authenticated: true,
    models: ["grok-4.5", "deepseek-v4-pro"],
    defaultModel: "grok-4.5",
    titleModel: "deepseek-v4-pro",
  });
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      model: string;
      stream: boolean;
    };
    requestModels.push(body.model);
    if (!body.stream) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: "Deployment title model" } }],
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
            delta: { content: "Hosted answer" },
            finish_reason: "stop",
          },
        ],
      })}\n\ndata: [DONE]\n\n`,
    });
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill(
      "Explain how a deployment default title model differs from the model used for the main answer in this sufficiently detailed request.",
    );
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Hosted answer")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Deployment title model", exact: true }),
  ).toBeVisible();
  expect(requestModels).toEqual(["grok-4.5", "deepseek-v4-pro"]);
});

test("keeps both connection methods discoverable when Custom API is disabled", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop flow");
  await mockConfig(page, {
    byokEnabled: false,
    hostedEnabled: true,
    models: ["hosted-model", "hosted-model-2"],
    defaultModel: "hosted-model",
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");

  await expect(
    page.getByRole("button", {
      name: "Connection method: Use an access code",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Access code", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("API key")).toHaveCount(0);
  await expect(page.getByLabel("API URL")).toHaveCount(0);
  await expect(settings.getByRole("checkbox")).toHaveCount(0);

  await settings.getByRole("button", { name: "Close" }).click();
  await page.locator(".model-selector-trigger").click();
  await expect(
    page.getByRole("option", { name: "hosted-model", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "hosted-model-2" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings" }).click();
  await selectSettingsPage(page, settings, "Model service");

  await page
    .getByRole("button", { name: "Connection method: Use an access code" })
    .click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(2);
  await page.getByRole("menuitemradio", { name: /Custom API/u }).click();
  await expect(page.getByLabel("API URL")).toBeVisible();
  await expect(page.getByLabel("API key")).toBeVisible();
  await expect(
    settings.getByText(
      "Custom API is not available in this CherryChat setup and cannot be saved yet.",
    ),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Save connection" }),
  ).toBeDisabled();
});
