import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";

import {
  mockConfig,
  mockModels,
  saveByokConnection,
} from "./chat-test-helpers";
import {
  expectNoHorizontalOverflow,
  selectSettingsOption,
  selectSettingsPage,
  waitForChatAppReady,
} from "./settings-helpers";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const GENERATION_URL = "https://images.example.test/v1/images/generations";
const EDIT_URL = "https://images.example.test/v1/images/edits";
const GENERATED_IMAGE_URL = "https://images.example.test/generated.png";
const IMAGE_MODEL = "gpt-image-e2e";

test("generates and edits persistent images without desktop or mobile overflow", async ({
  page,
}) => {
  test.skip(
    !["chromium", "mobile-chrome"].includes(test.info().project.name),
    "Chrome desktop/mobile image flow",
  );
  const mobile = test.info().project.name === "mobile-chrome";
  const provider = await installImageProviderRoutes(page);
  await prepareByokImagePage(page, mobile);

  await page
    .getByRole("button", { name: "Switch to image generation" })
    .click();
  const composer = page.locator("form.composer");
  const prompt = page.getByRole("textbox", {
    name: "Describe the image you want to create",
  });
  await page
    .getByRole("combobox", { name: "Image size" })
    .selectOption("1536x1024");
  await page
    .getByRole("combobox", { name: "Image quality" })
    .selectOption("high");
  await expectNoHorizontalOverflow(composer);

  await prompt.fill("Create a persistent cherry image");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => provider.generationBodies.length).toBe(1);
  expect(provider.generationBodies[0]).toEqual({
    model: IMAGE_MODEL,
    prompt: "Create a persistent cherry image",
    size: "1536x1024",
    quality: "high",
    n: 1,
  });
  await expect(generatedImages(page)).toHaveCount(1);
  await expect(
    page.getByText(`Image model: ${IMAGE_MODEL} · 1536x1024 · High`),
  ).toBeVisible();

  await page.getByRole("button", { name: "Use as reference image" }).click();
  await expect(page.getByLabel("Reference image 1")).toBeVisible();
  await expect(page.getByText("1 / 16", { exact: true })).toBeVisible();
  await prompt.fill("Edit the cherry while preserving its structure");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => provider.editBodies.length).toBe(1);
  const editBody = provider.editBodies[0] ?? "";
  expect(editBody).toContain('name="image[]"');
  expect(editBody.match(/name="image\[\]"/gu)).toHaveLength(1);
  expect(editBody).toContain("Edit the cherry while preserving its structure");
  expect(provider.editAuthorizations).toEqual(["Bearer image-e2e-key"]);
  await expect(generatedImages(page)).toHaveCount(2);

  await page.reload();
  if (mobile) {
    const sidebar = page.getByRole("button", { name: "Open sidebar" });
    await expect(sidebar).toBeEnabled();
    await sidebar.click();
  }
  await waitForChatAppReady(page, "Settings");
  if (mobile) {
    await page
      .getByRole("complementary", { name: "Chat history" })
      .getByRole("button", { name: "Close sidebar" })
      .click();
  }
  await expect(generatedImages(page)).toHaveCount(2);
  await expect(
    page.getByText(`Image model: ${IMAGE_MODEL} · 1536x1024 · High`),
  ).toHaveCount(2);
  await expectNoHorizontalOverflow(page.locator("body"));
});

test("keeps Hosted image credentials and upstream targets out of the browser", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop Hosted flow");
  await mockConfig(page, {
    byokEnabled: false,
    hostedEnabled: true,
    hostedImageGenerationEnabled: true,
    hostedImageGenerationModel: "hosted-image-model",
    models: ["hosted-chat-model"],
    defaultModel: "hosted-chat-model",
    titleModel: "hosted-chat-model",
    authenticated: true,
  });
  let hostedBody: unknown = null;
  let hostedHeaders: Record<string, string> = {};
  await page.route("**/api/image-generation", async (route) => {
    const postData = route.request().postData();
    hostedBody = postData ? (JSON.parse(postData) as unknown) : null;
    hostedHeaders = await route.request().allHeaders();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }),
    });
  });
  await page.goto("/");

  const settings = await openSettings(page, false);
  await selectSettingsPage(page, settings, "Image generation");
  await expect(settings.getByText("Hosted service available")).toBeVisible();
  await expect(settings.getByText("hosted-image-model")).toBeVisible();
  await expect(settings.getByLabel("Image generation URL")).toHaveCount(0);
  await expect(settings.getByLabel("Image edit URL")).toHaveCount(0);
  await settings.getByRole("button", { name: "Close" }).click();

  await page
    .getByRole("button", { name: "Switch to image generation" })
    .click();
  await page
    .getByRole("textbox", {
      name: "Describe the image you want to create",
    })
    .fill("Hosted image without browser secrets");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => hostedBody).not.toBeNull();
  expect(hostedBody).toEqual({
    model: "hosted-image-model",
    prompt: "Hosted image without browser secrets",
    size: "1024x1024",
    quality: "auto",
    n: 1,
  });
  expect(hostedHeaders.authorization).toBeUndefined();
  expect(hostedHeaders["x-cherrychat-mode"]).toBe("hosted");
  const pageText = await page.locator("body").innerText();
  expect(pageText).not.toContain("IMAGE_GENERATION_API_KEY");
  expect(pageText).not.toContain("IMAGE_GENERATION_URL");
  expect(pageText).not.toContain("image-deployment-key");
  await expect(generatedImages(page)).toHaveCount(1);
});

test("restores ordered image references from a full backup and can retry them", async ({
  browser,
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop backup flow");
  const sourceProvider = await installImageProviderRoutes(page);
  await prepareByokImagePage(page, false);
  await generateImageWithGeneratedReference(page);
  await expect.poll(() => sourceProvider.editBodies.length).toBe(1);

  const sourceSettings = await openSettings(page, false);
  await selectSettingsPage(page, sourceSettings, "Data");
  const downloadPromise = page.waitForEvent("download");
  await sourceSettings
    .getByRole("button", { name: "Export full backup" })
    .click();
  const backupPath = await (await downloadPromise).path();
  if (!backupPath) throw new Error("Backup download path is unavailable");

  const targetContext = await createEnglishContext(browser);
  const target = await targetContext.newPage();
  const targetProvider = await installImageProviderRoutes(target);
  await mockConfig(target);
  await target.goto("/");
  const targetSettings = await openSettings(target, false);
  await selectSettingsPage(target, targetSettings, "Data");
  await targetSettings.locator('input[type="file"]').setInputFiles(backupPath);
  await target
    .getByRole("alertdialog")
    .getByRole("button", { name: "Import backup", exact: true })
    .click();
  await expect(target.getByRole("alertdialog")).toBeHidden();

  await saveImageGenerationSettings(target, targetSettings);
  await targetSettings.getByRole("button", { name: "Close" }).click();
  await target
    .getByRole("button", {
      name: "Create a persistent cherry image",
      exact: true,
    })
    .click();
  await expect(generatedImages(target)).toHaveCount(2);
  await target.getByRole("button", { name: "Regenerate" }).last().click();

  await expect.poll(() => targetProvider.editBodies.length).toBe(1);
  expect(targetProvider.editBodies[0]).toContain('name="image[]"');
  await expect(generatedImages(target)).toHaveCount(2);
  await targetContext.close();
});

async function prepareByokImagePage(page: Page, mobile: boolean) {
  await mockConfig(page);
  await mockModels(page);
  await page.goto("/");
  await saveByokConnection(page, mobile);
  const settings = await openSettings(page, mobile);
  await saveImageGenerationSettings(page, settings);
  await settings.getByRole("button", { name: "Close" }).click();
}

async function saveImageGenerationSettings(page: Page, settings: Locator) {
  await selectSettingsPage(page, settings, "Image generation");
  await settings.getByLabel("Image generation URL").fill(GENERATION_URL);
  await settings.getByLabel("Image edit URL").fill(EDIT_URL);
  await settings
    .getByRole("textbox", { name: "API key", exact: true })
    .fill("image-e2e-key");
  await settings.getByLabel("Image model").fill(IMAGE_MODEL);
  await selectSettingsOption(page, settings, "Image size", "1536 x 1024");
  await selectSettingsOption(page, settings, "Image quality", "High");
  await settings
    .getByRole("button", { name: "Save image generation settings" })
    .click();
  await expect(
    settings.getByText("Image generation settings saved."),
  ).toBeVisible();
}

async function openSettings(page: Page, mobile: boolean) {
  if (mobile) {
    const sidebar = page.getByRole("button", { name: "Open sidebar" });
    if (await sidebar.isVisible()) await sidebar.click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await expect(settings).toBeVisible();
  return settings;
}

async function generateImageWithGeneratedReference(page: Page) {
  await page
    .getByRole("button", { name: "Switch to image generation" })
    .click();
  const prompt = page.getByRole("textbox", {
    name: "Describe the image you want to create",
  });
  await prompt.fill("Create a persistent cherry image");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(generatedImages(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Use as reference image" }).click();
  await prompt.fill("Edit the cherry while preserving its structure");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(generatedImages(page)).toHaveCount(2);
}

function generatedImages(page: Page) {
  return page
    .locator("article.message-assistant")
    .getByAltText("Attached image");
}

async function installImageProviderRoutes(page: Page) {
  const generationBodies: unknown[] = [];
  const editBodies: string[] = [];
  const editAuthorizations: Array<string | undefined> = [];
  await page.route("**/generated.png", async (route) => {
    await route.fulfill({
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: Buffer.from(PNG_BASE64, "base64"),
    });
  });
  await page.route("**/v1/images/generations", async (route) => {
    if (await fulfillImageCorsPreflight(route)) return;
    const postData = route.request().postData() ?? "";
    generationBodies.push(JSON.parse(postData) as unknown);
    const headers = await route.request().allHeaders();
    expect(headers.authorization).toBe("Bearer image-e2e-key");
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ data: [{ url: GENERATED_IMAGE_URL }] }),
    });
  });
  await page.route("**/v1/images/edits", async (route) => {
    if (await fulfillImageCorsPreflight(route)) return;
    editBodies.push(route.request().postDataBuffer()?.toString("utf8") ?? "");
    const headers = await route.request().allHeaders();
    editAuthorizations.push(headers.authorization);
    await fulfillImage(route);
  });
  return { generationBodies, editBodies, editAuthorizations };
}

async function fulfillImage(route: Route) {
  await route.fulfill({
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }),
  });
}

async function fulfillImageCorsPreflight(route: Route) {
  if (route.request().method() !== "OPTIONS") return false;
  await route.fulfill({
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "authorization, content-type",
    },
  });
  return true;
}

async function createEnglishContext(browser: Browser) {
  return browser.newContext({ locale: "en-US" });
}
