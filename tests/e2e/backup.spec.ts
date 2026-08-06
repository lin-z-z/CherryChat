import {
  expect,
  test,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";

import { selectSettingsPage } from "./settings-helpers";

async function mockConfig(page: Page) {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        byokEnabled: true,
        hostedEnabled: false,
        hostedWebSearchEnabled: false,
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
}

async function saveByok(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await page.getByLabel("API key").fill("backup-test-key");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(settings.getByText("Connection saved.")).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
}

async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await expect(settings).toBeVisible();
  return settings;
}

test("generates one AI title after the content threshold", async ({ page }) => {
  test.skip(test.info().project.name !== "chromium", "desktop data flow");
  await mockConfig(page);
  let titleRequests = 0;
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        stream?: boolean;
      };
      if (body.stream === false) {
        titleRequests += 1;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "Generated Cherry Title" } }],
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
              delta: { content: "A sufficiently detailed answer." },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await page.goto("/");
  await saveByok(page);

  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill(
      "Explain CherryChat backup and export behavior in enough detail for a generated conversation title.",
    );
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.getByRole("button", { name: "Generated Cherry Title", exact: true }),
  ).toBeVisible();
  expect(titleRequests).toBe(1);
});

test("keeps the fallback title and does not retry a failed title request", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop data flow");
  await mockConfig(page);
  let titleRequests = 0;
  let mainRequests = 0;
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        stream?: boolean;
      };
      if (body.stream === false) {
        titleRequests += 1;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "title unavailable" }),
        });
        return;
      }
      mainRequests += 1;
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: `Answer ${mainRequests}` },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await page.goto("/");
  await saveByok(page);
  const composer = page.getByRole("textbox", { name: "Message CherryChat" });
  await composer.fill(
    "This first message is intentionally long enough to trigger title generation and exercise its failure fallback.",
  );
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Answer 1")).toBeVisible();
  await expect.poll(() => titleRequests).toBe(1);

  await composer.fill(
    "This second long message must not trigger another title request after the first attempt failed.",
  );
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Answer 2")).toBeVisible();
  await expect.poll(() => mainRequests).toBe(2);
  await page.waitForTimeout(200);
  expect(titleRequests).toBe(1);
});

test("exports and imports a credential-free full backup", async ({
  browser,
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop data flow");
  await mockConfig(page);
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "Backup answer" },
              finish_reason: null,
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      });
    },
  );
  await page.goto("/");
  await saveByok(page);
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Backup me");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Backup answer")).toBeVisible();
  const settings = await openSettings(page);
  await selectSettingsPage(page, settings, "Data");
  await expect(
    settings.getByText(
      "Backups may include chats and images. Store them only where you trust the location.",
      { exact: true },
    ),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export full backup" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  if (!backupPath) throw new Error("Backup download path is unavailable");

  const targetContext = await browser.newContext({ locale: "en-US" });
  const target = await targetContext.newPage();
  await mockConfig(target);
  await target.goto("/");
  const targetSettings = await openSettings(target);
  await selectSettingsPage(target, targetSettings, "Data");
  await targetSettings.locator('input[type="file"]').setInputFiles(backupPath);

  await target
    .getByRole("alertdialog")
    .getByRole("button", { name: "Import backup", exact: true })
    .click();
  await expect(target.getByRole("alertdialog")).toBeHidden();
  await selectSettingsPage(target, targetSettings, "Model service");
  await expect(target.getByLabel("API key")).toHaveValue("");
  await targetSettings.getByRole("button", { name: "Close" }).click();
  await expect(
    target.getByRole("button", { name: "Backup me", exact: true }),
  ).toBeVisible();
  await target.getByRole("button", { name: "Backup me", exact: true }).click();
  await expect(target.getByText("Backup answer")).toBeVisible();
  await targetContext.close();
});

test("keeps JSON, Markdown, and print reasoning choices consistent", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop data flow");
  await mockConfig(page);
  await page.route(
    "https://api.openai.com/v1/chat/completions",
    async (route) => {
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({
            choices: [
              {
                index: 0,
                delta: { reasoning_content: "Hidden reasoning" },
                finish_reason: null,
              },
            ],
          })}\n\n`,
          `data: ${JSON.stringify({
            choices: [
              {
                index: 0,
                delta: { content: "Visible answer" },
                finish_reason: null,
              },
            ],
          })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""),
      });
    },
  );
  await page.goto("/");
  await saveByok(page);
  await page
    .getByRole("textbox", { name: "Message CherryChat" })
    .fill("Export");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Visible answer")).toBeVisible();
  const settings = await openSettings(page);
  await selectSettingsPage(page, settings, "Data");

  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect(await readDownload(await jsonDownload)).not.toContain(
    "Hidden reasoning",
  );

  await page.getByLabel("Include reasoning content").check();
  const markdownDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Markdown" }).click();
  expect(await readDownload(await markdownDownload)).toContain(
    "Hidden reasoning",
  );

  await page.getByRole("button", { name: "Print preview" }).click();
  const preview = page.getByLabel("Print preview");
  await expect(preview).toContainText("Visible answer");
  await expect(preview).toContainText("Hidden reasoning");
  await expect(
    preview.getByRole("button", { name: "Print / Save PDF" }),
  ).toBeVisible();
});

async function readDownload(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
