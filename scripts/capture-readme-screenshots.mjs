import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const imageDirectory = resolve(repositoryRoot, "docs/images");
const externalBaseUrl = process.env.CHERRYCHAT_SCREENSHOT_BASE_URL?.trim();

const screenshotPaths = {
  desktop: resolve(imageDirectory, "cherrychat-desktop.png"),
  settings: resolve(imageDirectory, "cherrychat-settings.png"),
  mobile: resolve(imageDirectory, "cherrychat-mobile.png"),
  imageGeneration: resolve(imageDirectory, "cherrychat-image-generation.png"),
};

const publicConfig = {
  byokEnabled: true,
  hostedEnabled: false,
  hostedWebSearchEnabled: false,
  hostedWebSearchProvider: null,
  hostedWebSearchProviders: [],
  hostedImageGenerationEnabled: false,
  hostedImageGenerationModel: null,
  hostedImageGenerationProfiles: [],
  hostedImageGenerationDefaultProfileId: null,
  imageGenerationTimeoutMs: 300_000,
  imageGenerationMaximumRequestBytes: 8 * 1024 * 1024,
  models: [],
  defaultModel: null,
  titleModel: null,
  authenticated: false,
  requestTimeouts: {
    modelListMs: 30_000,
    chatFirstByteMs: 300_000,
    chatIdleMs: 300_000,
    chatTotalMs: 1_800_000,
  },
};

const modelResponse = {
  object: "list",
  data: [
    { id: "gpt-4.1-mini", object: "model", owned_by: "demo" },
    { id: "deepseek-v4-flash", object: "model", owned_by: "demo" },
    { id: "gemini-2.5-flash", object: "model", owned_by: "demo" },
  ],
};

const assistantText = [
  "CherryChat keeps this conversation in your browser and lets you choose the model service.",
  "",
  "- Connect with your own provider key",
  "- Keep hosted credentials on your deployment",
  "- Export a private backup when you need one",
].join("\n");

let serverProcess = null;
let serverOutput = "";

try {
  await mkdir(imageDirectory, { recursive: true });
  const baseUrl = externalBaseUrl ?? (await startLocalServer());
  const browser = await launchBrowser();
  try {
    const generatedImageBase64 = await createMockGeneratedImage(browser);
    await captureDesktop(browser, baseUrl, generatedImageBase64);
    await captureMobile(browser, baseUrl, generatedImageBase64);
  } finally {
    await browser.close();
  }
  process.stdout.write(
    `README screenshots written to ${imageDirectory.replaceAll("\\", "/")}\n`,
  );
} finally {
  await stopLocalServer();
}

async function captureDesktop(browser, baseUrl, generatedImageBase64) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  try {
    const { page, unexpectedRequests } = await preparePage(
      context,
      baseUrl,
      {
        mobile: false,
      },
      generatedImageBase64,
    );
    await stabilizePage(page);
    await page.screenshot({ path: screenshotPaths.desktop });

    await openSettings(page, false);
    await stabilizePage(page);
    await page.screenshot({ path: screenshotPaths.settings });
    await captureImageGeneration(page);
    await stabilizePage(page);
    await page.screenshot({ path: screenshotPaths.imageGeneration });
    assertNoUnexpectedRequests(unexpectedRequests);
  } finally {
    await context.close();
  }
}

async function captureMobile(browser, baseUrl, generatedImageBase64) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  try {
    const { page, unexpectedRequests } = await preparePage(
      context,
      baseUrl,
      {
        mobile: true,
      },
      generatedImageBase64,
    );
    await stabilizePage(page);
    await page.screenshot({ path: screenshotPaths.mobile });
    assertNoUnexpectedRequests(unexpectedRequests);
  } finally {
    await context.close();
  }
}

async function preparePage(context, baseUrl, { mobile }, generatedImageBase64) {
  const baseOrigin = new URL(baseUrl).origin;
  const unexpectedRequests = [];
  await context.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem("cherrychat.language", "en");
    window.localStorage.setItem("cherrychat.theme", "light");
  });
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === baseOrigin) {
      if (requestUrl.pathname === "/api/config") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(publicConfig),
        });
        return;
      }
      await route.continue();
      return;
    }

    if (
      requestUrl.origin === "https://api.openai.com" &&
      requestUrl.pathname === "/v1/models"
    ) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(modelResponse),
      });
      return;
    }

    if (
      requestUrl.origin === "https://api.openai.com" &&
      requestUrl.pathname === "/v1/chat/completions"
    ) {
      const requestBody = route.request().postDataJSON();
      if (requestBody?.stream === false) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ message: { content: "Private AI workspace" } }],
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({
            choices: [
              {
                index: 0,
                delta: { content: assistantText },
                finish_reason: null,
              },
            ],
          })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""),
      });
      return;
    }

    if (
      requestUrl.origin === "https://api.openai.com" &&
      requestUrl.pathname === "/v1/images/generations"
    ) {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "authorization,content-type",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
          },
        });
        return;
      }
      const authorization = await route.request().headerValue("authorization");
      const requestBody = route.request().postDataJSON();
      if (
        authorization !== "Bearer screenshot-image-key" ||
        requestBody?.model !== "gpt-image-2" ||
        requestBody?.prompt !== "A quiet reading corner with cherry-red accents"
      ) {
        throw new Error(
          "Screenshot image request did not match the mock contract",
        );
      }
      await route.fulfill({
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          data: [
            {
              b64_json: generatedImageBase64,
              revised_prompt:
                "A quiet modern reading corner with cherry-red accents",
            },
          ],
          output_format: "png",
        }),
      });
      return;
    }

    unexpectedRequests.push(route.request().url());
    await route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "load", timeout: 120_000 });
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).waitFor();
  } else {
    await page.locator("[data-settings-trigger]:visible").waitFor();
  }
  await page.waitForLoadState("load");
  await page.waitForTimeout(250);
  await configureDemoConnection(page, mobile);

  const composer = page.getByRole("textbox", { name: "Message CherryChat" });
  await composer.fill("How can a small team use CherryChat privately?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Connect with your own provider key").waitFor();
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForTimeout(250);
  return { page, unexpectedRequests };
}

async function configureDemoConnection(page, mobile) {
  const settings = await openSettings(page, mobile);
  const apiKey = settings.getByLabel("API key");
  await apiKey.fill("demo-browser-key");
  await settings
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await settings.getByText("Connection saved.").waitFor();
  await settings.getByText("gpt-4.1-mini", { exact: true }).first().waitFor();
  await settings.getByRole("button", { name: "Close" }).click();
  await settings.waitFor({ state: "hidden" });
}

async function captureImageGeneration(page) {
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Image generation");
  await settings.getByLabel("Service URL").fill("https://api.openai.com");
  await settings
    .getByRole("textbox", { name: "API key", exact: true })
    .fill("screenshot-image-key");
  await settings
    .getByRole("button", { name: "Save image generation settings" })
    .click();
  await settings.getByText("Image generation settings saved.").waitFor();
  await settings.getByRole("button", { name: "Close" }).click();
  await settings.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Image", exact: true }).click();
  const prompt = page.getByRole("textbox", {
    name: "Describe the image you want to create",
  });
  await prompt.fill("A quiet reading corner with cherry-red accents");
  await page.getByRole("button", { name: "Send" }).click();
  await page
    .locator("article.message-assistant")
    .getByAltText("Attached image")
    .waitFor();
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForTimeout(300);
}

async function openSettings(page, mobile) {
  if (mobile) {
    const sidebarButton = page.getByRole("button", { name: "Open sidebar" });
    if (await sidebarButton.isVisible()) await sidebarButton.click();
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await settings.waitFor();
  const modelServiceTab = settings.getByRole("tab", {
    name: "Model service",
    exact: true,
  });
  if (await modelServiceTab.isVisible()) {
    await modelServiceTab.click();
  } else {
    await settings.locator(".settings-mobile-nav-trigger").click();
    await page
      .getByRole("menuitem", { name: "Model service", exact: true })
      .click();
  }
  await settings
    .getByRole("heading", { name: "Model service", exact: true })
    .first()
    .waitFor();
  await page.waitForTimeout(200);
  return settings;
}

async function selectSettingsPage(page, settings, name) {
  const tab = settings.getByRole("tab", { name, exact: true });
  if (await tab.isVisible()) {
    await tab.click();
  } else {
    await settings.locator(".settings-mobile-nav-trigger").click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
}

async function stabilizePage(page) {
  if ((await page.locator("style[data-screenshot-stability]").count()) === 0) {
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation: none !important;
          caret-color: transparent !important;
          transition: none !important;
        }
      `,
    });
    await page
      .locator("style")
      .last()
      .evaluate((element) =>
        element.setAttribute("data-screenshot-stability", "true"),
      );
  }
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await document.fonts.ready;
  });
  await page.waitForTimeout(50);
}

async function createMockGeneratedImage(browser) {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 1024px; height: 1024px; overflow: hidden; }
        #art { position: relative; width: 1024px; height: 1024px; background: #f2eee7; }
        .wall { position: absolute; inset: 0 0 300px; background: #e8dfd2; }
        .window { position: absolute; left: 116px; top: 112px; width: 388px; height: 408px; border: 30px solid #314a52; background: #b9d9df; }
        .window::before { content: ""; position: absolute; left: 149px; top: 0; width: 24px; height: 348px; background: #314a52; }
        .window::after { content: ""; position: absolute; left: 0; top: 152px; width: 328px; height: 24px; background: #314a52; }
        .sun { position: absolute; right: 58px; top: 48px; width: 78px; height: 78px; border-radius: 50%; background: #f1c45a; }
        .shelf { position: absolute; right: 82px; top: 154px; width: 338px; height: 32px; background: #5a4637; box-shadow: 0 186px 0 #5a4637; }
        .book { position: absolute; width: 44px; bottom: 32px; background: #c8443c; }
        .book.one { left: 34px; height: 116px; }
        .book.two { left: 84px; height: 146px; background: #365f58; }
        .book.three { left: 134px; height: 128px; background: #e0a445; }
        .book.four { left: 236px; height: 148px; background: #476b85; }
        .floor { position: absolute; inset: 724px 0 0; background: #9a7355; }
        .rug { position: absolute; left: 176px; bottom: 62px; width: 680px; height: 220px; border-radius: 50%; background: #d7c7b5; }
        .chair { position: absolute; left: 484px; top: 482px; width: 330px; height: 310px; border-radius: 88px 88px 48px 48px; background: #b52f38; }
        .chair::before { content: ""; position: absolute; left: 38px; top: 38px; width: 254px; height: 144px; border-radius: 58px; background: #d94a4e; }
        .chair::after { content: ""; position: absolute; left: 80px; bottom: -116px; width: 26px; height: 138px; background: #3f342e; box-shadow: 152px 0 0 #3f342e; }
        .table { position: absolute; left: 230px; top: 660px; width: 260px; height: 32px; border-radius: 6px; background: #4e3a30; }
        .table::after { content: ""; position: absolute; left: 112px; top: 30px; width: 34px; height: 194px; background: #4e3a30; }
        .bowl { position: absolute; left: 296px; top: 611px; width: 130px; height: 58px; border-radius: 12px 12px 64px 64px; background: #315b54; }
        .cherry { position: absolute; width: 42px; height: 42px; border-radius: 50%; background: #c72f3b; }
        .cherry.a { left: 302px; top: 580px; }
        .cherry.b { left: 342px; top: 564px; }
        .cherry.c { left: 382px; top: 583px; }
        .plant { position: absolute; right: 60px; bottom: 120px; width: 130px; height: 174px; border-radius: 50% 10% 50% 10%; background: #47715d; transform: rotate(-18deg); }
      </style>
      <main id="art" aria-label="Mock generated reading corner">
        <div class="wall"></div><div class="window"><div class="sun"></div></div>
        <div class="shelf"><i class="book one"></i><i class="book two"></i><i class="book three"></i><i class="book four"></i></div>
        <div class="floor"></div><div class="rug"></div><div class="chair"></div>
        <div class="table"></div><div class="bowl"></div>
        <i class="cherry a"></i><i class="cherry b"></i><i class="cherry c"></i><div class="plant"></div>
      </main>
    `);
    const image = await page.locator("#art").screenshot({ type: "png" });
    return image.toString("base64");
  } finally {
    await context.close();
  }
}

function assertNoUnexpectedRequests(requests) {
  if (requests.length === 0) return;
  throw new Error(
    `Screenshot capture blocked unexpected external requests:\n${requests.join("\n")}`,
  );
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (chromeError) {
    try {
      return await chromium.launch({ headless: true });
    } catch (chromiumError) {
      throw new AggregateError(
        [chromeError, chromiumError],
        "Unable to launch Chrome or Playwright Chromium",
      );
    }
  }
}

async function startLocalServer() {
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextCli = resolve(repositoryRoot, "node_modules/next/dist/bin/next");
  serverProcess = spawn(
    process.execPath,
    [
      nextCli,
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serverProcess.stdout?.on("data", rememberServerOutput);
  serverProcess.stderr?.on("data", rememberServerOutput);

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `Next.js screenshot server exited early.\n${serverOutput}`,
      );
    }
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return baseUrl;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.\n${serverOutput}`);
}

async function stopLocalServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill();
  const exited = await Promise.race([
    new Promise((resolveExit) =>
      serverProcess.once("exit", () => resolveExit(true)),
    ),
    new Promise((resolveTimeout) =>
      setTimeout(() => resolveTimeout(false), 5_000),
    ),
  ]);
  if (!exited && serverProcess.exitCode === null) {
    serverProcess.kill("SIGKILL");
  }
}

function rememberServerOutput(chunk) {
  serverOutput = `${serverOutput}${String(chunk)}`.slice(-12_000);
}

async function findAvailablePort() {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) rejectPort(error);
        else if (port === null) rejectPort(new Error("No available port"));
        else resolvePort(port);
      });
    });
  });
}
