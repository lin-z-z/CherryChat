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
};

const publicConfig = {
  byokEnabled: true,
  hostedEnabled: false,
  hostedWebSearchEnabled: false,
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
    await captureDesktop(browser, baseUrl);
    await captureMobile(browser, baseUrl);
  } finally {
    await browser.close();
  }
  process.stdout.write(
    `README screenshots written to ${imageDirectory.replaceAll("\\", "/")}\n`,
  );
} finally {
  await stopLocalServer();
}

async function captureDesktop(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  try {
    const { page, unexpectedRequests } = await preparePage(context, baseUrl, {
      mobile: false,
    });
    await page.screenshot({ path: screenshotPaths.desktop });

    await openSettings(page, false);
    await page.screenshot({ path: screenshotPaths.settings });
    assertNoUnexpectedRequests(unexpectedRequests);
  } finally {
    await context.close();
  }
}

async function captureMobile(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
  });
  try {
    const { page, unexpectedRequests } = await preparePage(context, baseUrl, {
      mobile: true,
    });
    await page.screenshot({ path: screenshotPaths.mobile });
    assertNoUnexpectedRequests(unexpectedRequests);
  } finally {
    await context.close();
  }
}

async function preparePage(context, baseUrl, { mobile }) {
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

    unexpectedRequests.push(route.request().url());
    await route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).waitFor();
  } else {
    await page.locator("[data-settings-trigger]:visible").waitFor();
  }
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
    [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
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
