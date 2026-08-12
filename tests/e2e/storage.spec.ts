import { expect, test, type Page } from "@playwright/test";

async function mockUpstream(page: Page) {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        byokEnabled: true,
        hostedEnabled: false,
        hostedWebSearchEnabled: false,
        hostedWebSearchProvider: null,
        hostedWebSearchProviders: [],
        models: [],
        defaultModel: null,
        authenticated: false,
      }),
    });
  });
  await page.route("https://api.openai.com/v1/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [{ id: "gpt-4.1-mini" }] }),
    });
  });
  let generation = 0;
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      generation += 1;
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: `Memory answer ${generation}` },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
}

async function openSettingsCategory(page: Page, category: string) {
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await settings.getByRole("tab", { name: category, exact: true }).click();
  return settings;
}

async function saveByok(page: Page, apiKey: string) {
  const settings = await openSettingsCategory(page, "Model service");
  await page.getByLabel("API key").fill(apiKey);
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
}

test("falls back to page memory while preserving the BYOK connection", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop storage flow");
  await page.addInitScript(() => {
    const nativePrototype = Object.getPrototypeOf(window.indexedDB) as object;
    Object.defineProperty(nativePrototype, "open", {
      configurable: true,
      value() {
        throw new DOMException(
          "IndexedDB disabled by test",
          "InvalidStateError",
        );
      },
    });
  });
  await mockUpstream(page);
  await page.goto("/");

  await expect(
    page.getByText(
      "Chats cannot be saved in this browser right now. Current content may be lost after refresh or close.",
    ),
  ).toBeVisible();

  await saveByok(page, "storage-test-key");

  const composer = page.getByRole("textbox", { name: "Message CherryChat" });
  await composer.fill("Before refresh");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Memory answer 1")).toBeVisible();

  await page.reload();
  await expect(page.getByText("No chats yet")).toBeVisible();
  const settings = await openSettingsCategory(page, "Model service");
  await expect(page.getByLabel("API key")).toHaveValue("storage-test-key");
  await settings.getByRole("button", { name: "Close" }).click();

  await composer.fill("After refresh");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Memory answer 2")).toBeVisible();
});

test("clears chats, credentials, settings, and the hosted session", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop storage flow");
  await mockUpstream(page);
  let signedOut = false;
  await page.route("**/api/auth", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }
    signedOut = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false }),
    });
  });
  await page.goto("/");

  await saveByok(page, "clear-test-key");
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Clear me");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Memory answer 1")).toBeVisible();

  await openSettingsCategory(page, "Data");
  await page.getByRole("button", { name: "Clear all local data" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Clear all local data", exact: true })
    .click();

  await expect(page.getByText("No chats yet")).toBeVisible();
  expect(signedOut).toBe(true);
  await openSettingsCategory(page, "Model service");
  await expect(page.getByLabel("API key")).toHaveValue("");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(window.localStorage).filter((key) =>
          key.startsWith("cherrychat."),
        ),
      ),
    )
    .toEqual([]);
});

test("clears every chat without removing the saved connection", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop storage flow");
  await mockUpstream(page);
  await page.goto("/");
  await saveByok(page, "preserved-key");
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Keep key");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Memory answer 1")).toBeVisible();

  const settings = await openSettingsCategory(page, "Data");
  await page.getByRole("button", { name: "Clear all chats" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Clear all chats", exact: true })
    .click();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("No chats yet")).toBeVisible();

  await openSettingsCategory(page, "Model service");
  await expect(page.getByLabel("API key")).toHaveValue("preserved-key");
});

test("blocks the composer while the browser is offline", async ({ page }) => {
  test.skip(test.info().project.name !== "chromium", "desktop offline flow");
  await mockUpstream(page);
  await page.goto("/");

  await page.context().setOffline(true);
  await expect(
    page.getByText("You are offline. Reconnect before sending a message."),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message CherryChat" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

  await page.context().setOffline(false);
  await expect(
    page.getByText("You are offline. Reconnect before sending a message."),
  ).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "Message CherryChat" }),
  ).toBeEnabled();
});
