import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  selectSettingsModel,
  selectSettingsOption,
  selectSettingsPage,
  waitForChatAppReady,
} from "./settings-helpers";

const defaultConfig = {
  byokEnabled: true,
  hostedEnabled: false,
  hostedWebSearchEnabled: false,
  models: [] as string[],
  defaultModel: null as string | null,
  titleModel: null as string | null,
  authenticated: false,
  requestTimeouts: {
    modelListMs: 30_000,
    chatFirstByteMs: 300_000,
    chatIdleMs: 300_000,
    chatTotalMs: 1_800_000,
  },
};

async function mockConfig(
  page: Page,
  overrides: Partial<typeof defaultConfig> = {},
) {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ...defaultConfig, ...overrides }),
    });
  });
}

async function mockModels(page: Page) {
  await page.route("https://api.openai.com/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: "gpt-4.1-mini" }] }),
    });
  });
}

async function saveByokConnection(
  page: Page,
  mobile: boolean,
  enabledModels: readonly string[] = [],
) {
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settingsWorkspace = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settingsWorkspace, "Model service");
  await page.getByLabel("API key").fill("test-only-key");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settingsWorkspace.getByText("Connection saved.")).toBeVisible();
  for (const modelId of enabledModels) {
    await settingsWorkspace
      .getByRole("checkbox", { name: `Enable ${modelId}` })
      .click();
  }
  if (enabledModels.length > 0) {
    await expect(
      settingsWorkspace.getByText(
        /Saved automatically with \d+ models enabled/u,
      ),
    ).toBeVisible();
  }
  await settingsWorkspace.getByRole("button", { name: "Close" }).click();
  await expect(settingsWorkspace).toBeHidden();
}

async function prepareByokPage(page: Page, mobile = false) {
  await mockConfig(page);
  await mockModels(page);
  await page.goto("/");
  await saveByokConnection(page, mobile);
}

type ControlledStreamWindow = Window & {
  __cherryChatStreamControl?: {
    ready: boolean;
    push: (content: string) => void;
    finish: () => void;
  };
};

async function installControlledChatStream(page: Page) {
  await page.addInitScript(() => {
    const target = window as ControlledStreamWindow;
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

    target.__cherryChatStreamControl = {
      ready: false,
      push(content) {
        controller?.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: { content },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
          ),
        );
      },
      finish() {
        if (!controller) return;
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        controller = null;
        if (target.__cherryChatStreamControl) {
          target.__cherryChatStreamControl.ready = false;
        }
      },
    };

    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url !== "https://api.openai.com/v1/chat/completions") {
        return originalFetch(input, init);
      }

      const payload =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as { stream?: boolean })
          : null;
      if (payload?.stream === false) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Controlled stream title" } }],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        new ReadableStream<Uint8Array>({
          start(nextController) {
            controller = nextController;
            if (target.__cherryChatStreamControl) {
              target.__cherryChatStreamControl.ready = true;
            }
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
  });
}

async function pushControlledChunk(page: Page, content: string) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as ControlledStreamWindow).__cherryChatStreamControl?.ready,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate((chunk) => {
    (window as ControlledStreamWindow).__cherryChatStreamControl?.push(chunk);
  }, content);
}

async function finishControlledStream(page: Page) {
  await page.evaluate(() => {
    (window as ControlledStreamWindow).__cherryChatStreamControl?.finish();
  });
}

function anthropicSse(events: readonly Record<string, unknown>[]): string {
  return events
    .map(
      (event) =>
        `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
}

function anthropicMessageStart(model: string, inputTokens = 10) {
  return {
    type: "message_start",
    message: {
      id: "anthropic-e2e-message",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens },
    },
  };
}

function anthropicMessageDelta(stopReason: string, outputTokens = 6) {
  return {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  };
}

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
        data: [{ id: "gpt-4.1-mini" }, { id: "o3-mini" }],
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
  await expect(modelTrigger).toHaveAccessibleName(
    "Selected model: gpt-4.1-mini",
  );
  await expect(page.locator(".chat-error")).toHaveCount(0);
  const notice = page.locator(".model-switch-divider");
  await expect(notice).toHaveText("Model changed from o3-mini to gpt-4.1-mini");
  await expect(
    notice.locator("xpath=ancestor::*[contains(@class, 'message-column')]"),
  ).toHaveCount(1);

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

  await page.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit message" });
  await editDialog
    .getByRole("textbox", { name: "Message content" })
    .fill("Edited hello");
  await editDialog.getByRole("button", { name: "Save only" }).click();
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

  await page.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit message" });
  await editDialog
    .getByRole("textbox", { name: "Message content" })
    .fill("Edited and sent immediately");
  await editDialog.getByRole("button", { name: "Save and send" }).click();

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
    models: ["hosted-model"],
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
  await trigger.click();
  expect(await page.getByRole("option").allTextContents()).toEqual([
    defaultLabel,
    "Off",
    "High",
    "Maximum",
  ]);
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
      query: "Tavily web search connection test",
      maxResults: 6,
    });
    await route.fulfill({
      status: expireHostedSession ? 401 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        expireHostedSession
          ? { error: { code: "UNAUTHORIZED", message: "expired" } }
          : {
              query: "Tavily web search connection test",
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
  await expect(settings.getByText("Tavily is connected.")).toBeVisible();

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
