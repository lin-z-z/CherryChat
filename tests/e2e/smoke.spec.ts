import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  selectSettingsPage,
  selectSettingsModel,
  selectSettingsOption,
} from "./settings-helpers";

const defaultConfig = {
  byokEnabled: true,
  hostedEnabled: false,
  hostedWebSearchEnabled: false,
  hostedWebSearchProvider: null as "tavily" | "exa" | "grok" | null,
  hostedWebSearchProviders: [] as Array<"tavily" | "exa" | "grok">,
  models: [] as string[],
  defaultModel: null as string | null,
  authenticated: false,
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

test("renders the CherryChat shell", async ({ page }) => {
  await mockConfig(page);
  await page.goto("/");
  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Selected model: gpt-4.1-mini" }),
  ).toBeVisible();
  await expect(page.locator('[name="reasoningEffort"]')).toHaveCount(0);
  const themeButton = page.getByRole("button", { name: /Theme:/u });
  await expect(themeButton).toBeVisible();
  await themeButton.click();
  await expect(
    page.getByRole("menuitemradio", { name: "System" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const sidebarButton = page.getByRole("button", { name: "Open sidebar" });
  if (test.info().project.name === "mobile-chrome") {
    await expect(sidebarButton).toBeVisible();
    await sidebarButton.click();
    const closeSidebarButton = page
      .getByRole("complementary", { name: "Chat history" })
      .getByRole("button", { name: "Close sidebar" });
    await expect(closeSidebarButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sidebarButton).toBeFocused();
    await sidebarButton.click();
  } else {
    await expect(sidebarButton).toBeHidden();
  }

  await expect(
    page.getByRole("heading", { name: "CherryChat", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What can I help with?" }),
  ).toBeVisible();
  const emptyHeading = page.getByRole("heading", {
    name: "What can I help with?",
  });
  const [emptyMarkBox, emptyHeadingBox] = await Promise.all([
    page.locator(".chat-empty-mark").boundingBox(),
    emptyHeading.boundingBox(),
  ]);
  expect(
    Math.abs((emptyMarkBox?.y ?? 0) - (emptyHeadingBox?.y ?? 0)),
  ).toBeLessThanOrEqual(2);
  await expect(page.locator(".sidebar-brand-mark img")).toHaveAttribute(
    "src",
    "/icon.svg",
  );
  await expect(page.locator(".chat-empty-mark img")).toHaveAttribute(
    "src",
    "/icon.svg",
  );
  await expect(page.getByText("No chats yet")).toBeVisible();
  const history = page.getByRole("complementary", { name: "Chat history" });
  const historyHeading = history.locator(".conversation-history-heading");
  const historySearch = historyHeading.getByRole("button", {
    name: "Search chats",
  });
  await expect(historySearch).toBeVisible();
  const primaryActions = history.locator(".conversation-drawer-actions");
  await expect(primaryActions.getByRole("button")).toHaveCount(1);
  await expect(
    primaryActions.getByRole("button", { name: "Search chats" }),
  ).toHaveCount(0);
  const newChatButton = primaryActions.getByRole("button", {
    name: "New chat",
  });
  await expect(newChatButton).toHaveCSS("border-style", "solid");
  const [newChatBox, newChatLabelBox] = await Promise.all([
    newChatButton.boundingBox(),
    newChatButton.locator(".new-chat-button-label").boundingBox(),
  ]);
  expect(newChatBox?.height ?? 0).toBeGreaterThanOrEqual(
    test.info().project.name === "mobile-chrome" ? 44 : 40,
  );
  expect(
    Math.abs(
      (newChatBox?.x ?? 0) +
        (newChatBox?.width ?? 0) / 2 -
        ((newChatLabelBox?.x ?? 0) + (newChatLabelBox?.width ?? 0) / 2),
    ),
  ).toBeLessThanOrEqual(2);
  await expect(history.locator(".conversation-tabs")).toHaveCount(0);
  await history.getByRole("button", { name: "Archived chats" }).click();
  await expect(
    history.getByRole("heading", { name: "Archived chats" }),
  ).toBeVisible();
  await expect(history.getByText("No archived chats")).toBeVisible();
  await expect(historySearch).toHaveCount(0);
  await history.getByRole("button", { name: "Back to chats" }).click();
  if (test.info().project.name === "mobile-chrome") {
    await history.getByRole("button", { name: "Close sidebar" }).click();
    await sidebarButton.click();
  }
  await expect(historySearch).toBeVisible();
  await expect(history.getByRole("button", { name: "New chat" })).toBeVisible();
  const settingsButton = page.getByRole("button", { name: "Settings" });
  await settingsButton.click();
  const settingsWorkspace = page.getByRole("main", { name: "Settings" });
  await expect(settingsWorkspace).toBeVisible();
  const settingsClose = settingsWorkspace.getByRole("button", {
    name: "Close",
  });
  const mobile = test.info().project.name === "mobile-chrome";
  if (mobile) {
    await expect(
      settingsWorkspace.locator(".settings-mobile-nav-trigger"),
    ).toHaveAccessibleName("Settings page: Appearance");
  } else {
    await expect(settingsWorkspace.getByRole("tab")).toHaveCount(7);
  }
  await expect(
    settingsWorkspace.getByText("Instructions & context", { exact: true }),
  ).toHaveCount(0);
  await selectSettingsOption(page, settingsWorkspace, "Theme", "Dark");
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("cherrychat.theme")))
    .toBe("dark");
  await selectSettingsOption(page, settingsWorkspace, "Theme", "System");
  await selectSettingsPage(page, settingsWorkspace, "Model service");
  const connectionMethod = settingsWorkspace.getByRole("button", {
    name: "Connection method: Custom API",
  });
  await connectionMethod.click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(2);
  await page
    .getByRole("menuitemradio", { name: /Use an access code/u })
    .click();
  const accessCode = page.getByRole("textbox", {
    name: "Access code",
    exact: true,
  });
  await expect(accessCode).toBeVisible();
  await expect(accessCode).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(accessCode).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(accessCode).toHaveAttribute("type", "password");
  await expect(
    settingsWorkspace.getByText(
      "Use an access code is not available in this CherryChat setup and cannot be saved yet.",
    ),
  ).toBeVisible();
  await expect(
    settingsWorkspace.getByRole("button", { name: "Save connection" }),
  ).toBeDisabled();
  await page.screenshot({
    path: `test-results/settings-access-code-${test.info().project.name}.png`,
    fullPage: true,
  });
  await settingsWorkspace
    .getByRole("button", { name: "Connection method: Use an access code" })
    .click();
  await page.getByRole("menuitemradio", { name: /Custom API/u }).click();
  await expect(page.getByLabel("API URL")).toBeVisible();
  await expect(page.getByLabel("API key")).toBeVisible();
  await selectSettingsPage(page, settingsWorkspace, "Model management");
  await expect(
    page.getByRole("heading", { name: "Model roles", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Model settings", { exact: true }).first(),
  ).toBeVisible();
  await expectNoHorizontalOverflow(settingsWorkspace);
  await settingsClose.click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(settingsWorkspace).toBeHidden();
  if (test.info().project.name === "mobile-chrome") {
    await expect(sidebarButton).toBeFocused();
  } else {
    await expect(settingsButton).toBeFocused();
  }

  await page.screenshot({
    path: `test-results/shell-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("uses one adaptive sidebar and a compact composer", async ({ page }) => {
  await mockConfig(page, {
    defaultModel: "gpt-5",
    models: ["gpt-5", "o3-mini"],
  });
  await page.goto("/");
  const mobile = test.info().project.name === "mobile-chrome";
  await expect(page.locator("aside[aria-label]")).toHaveCount(1);
  await expect(page.locator('select[name="activeModel"]')).toHaveCount(0);

  const modelTrigger = page.locator(".model-selector-trigger");
  await expect(modelTrigger).toHaveAccessibleName("Selected model: gpt-5");
  await modelTrigger.click();
  const modelSearch = page.getByRole("searchbox", { name: "Search models" });
  await expect(modelSearch).toBeFocused();
  await modelSearch.fill("o3");
  await page.getByRole("option", { name: "o3-mini" }).click();
  await expect(modelTrigger).toHaveAccessibleName("Selected model: o3-mini");
  await expect(page.locator(".model-switch-notice")).toHaveCount(0);
  await expect(page.locator(".model-switch-divider")).toHaveCount(0);
  // o3-mini is catalogue-marked as text-only. Use the vision-capable default
  // model for the composer geometry assertions below.
  await modelTrigger.click();
  await page.getByRole("searchbox", { name: "Search models" }).fill("gpt-5");
  await page.getByRole("option", { name: "gpt-5" }).click();
  await expect(modelTrigger).toHaveAccessibleName("Selected model: gpt-5");

  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  const sidebar = page.getByRole("complementary", { name: "Chat history" });
  await expect(sidebar).toBeVisible();
  const expandedWidth = (await sidebar.boundingBox())?.width ?? 0;
  expect(expandedWidth).toBeGreaterThanOrEqual(mobile ? 300 : 250);
  expect(expandedWidth).toBeLessThanOrEqual(mobile ? 305 : 270);

  if (mobile) {
    await sidebar.getByRole("button", { name: "Close sidebar" }).click();
    await expect(sidebar).toBeHidden();
  } else {
    await sidebar.getByRole("button", { name: "Close sidebar" }).click();
    await expect(sidebar).toHaveClass(/collapsed/u);
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeLessThanOrEqual(60);
    expect((await sidebar.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(
      52,
    );
  }

  const composer = page.locator("form.composer");
  await expect(composer).toBeVisible();
  const frame = composer.locator(":scope > #message-input-container");
  await expect(frame).toHaveClass(/composer-frame/u);
  const inputShell = frame.locator(":scope > .composer-input-shell");
  const actionRow = frame.locator(":scope > .composer-action-row");
  const upload = actionRow
    .locator(".composer-toolbar-left")
    .getByRole("button", { name: "Add image" });
  const reasoning = actionRow
    .locator(".composer-toolbar-right")
    .getByRole("button", { name: "Reasoning effort: Model default" });
  const send = actionRow
    .locator(".composer-toolbar-right")
    .getByRole("button", { name: "Send" });
  await expect(inputShell).toBeVisible();
  await expect(actionRow).toBeVisible();
  await expect(upload).toBeVisible();
  await expect(reasoning).toBeVisible();
  await expect(send).toBeVisible();
  await expect(page.locator(".chat-stage")).toHaveClass(/chat-stage-empty/u);
  const composerHeight = (await composer.boundingBox())?.height ?? 0;
  expect(composerHeight).toBeGreaterThanOrEqual(80);
  expect(composerHeight).toBeLessThanOrEqual(132);

  const textbox = page.getByRole("textbox", { name: "Message CherryChat" });
  await expect(textbox).toBeEnabled();
  await expect(inputShell.locator("textarea")).toHaveCount(1);
  await expect(actionRow.locator("textarea")).toHaveCount(0);
  const [
    stageBox,
    titleBox,
    inputBox,
    actionBox,
    frameBox,
    uploadBox,
    reasoningBox,
    sendBox,
  ] = await Promise.all(
    [
      page.locator(".chat-stage"),
      page.getByText("What can I help with?", { exact: true }),
      inputShell,
      actionRow,
      frame,
      upload,
      reasoning,
      send,
    ].map((control) => control.boundingBox()),
  );
  expect(stageBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect((inputBox?.y ?? 0) + (inputBox?.height ?? 0)).toBeLessThanOrEqual(
    (actionBox?.y ?? 0) + 1,
  );
  const actionCenters = [uploadBox, reasoningBox, sendBox].map((box) =>
    box ? box.y + box.height / 2 : Number.POSITIVE_INFINITY,
  );
  expect(
    Math.max(...actionCenters) - Math.min(...actionCenters),
  ).toBeLessThanOrEqual(3);
  expect(
    (titleBox?.y ?? Number.POSITIVE_INFINITY) + (titleBox?.height ?? 0),
  ).toBeLessThan(frameBox?.y ?? Number.NEGATIVE_INFINITY);
  const emptyGroupCenter =
    ((titleBox?.y ?? 0) + (frameBox?.y ?? 0) + (frameBox?.height ?? 0)) / 2;
  const stageCenter = (stageBox?.y ?? 0) + (stageBox?.height ?? 0) / 2;
  const frameCenter = (frameBox?.y ?? 0) + (frameBox?.height ?? 0) / 2;
  expect(Math.abs(frameCenter - stageCenter)).toBeLessThanOrEqual(
    mobile ? 90 : 60,
  );
  expect(frameBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    mobile ? (stageBox?.width ?? 0) - 20 : 800,
  );
  expect(Math.abs(emptyGroupCenter - stageCenter)).toBeLessThanOrEqual(
    mobile ? 110 : 90,
  );
  await reasoning.click();
  await page.getByRole("option", { name: "High" }).click();
  await expect(
    actionRow
      .locator(".composer-toolbar-right")
      .getByRole("button", { name: "Reasoning effort: High" }),
  ).toBeVisible();
  const frameHeightBeforeFocus = (await frame.boundingBox())?.height ?? 0;
  await textbox.focus();
  await expect(textbox).toBeFocused();
  await expect(textbox).toHaveCSS("outline-style", "none");
  await expect(textbox).toHaveCSS("box-shadow", "none");
  expect((await frame.boundingBox())?.height ?? 0).toBeCloseTo(
    frameHeightBeforeFocus,
    0,
  );
  const frameOverflow = await frame.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(frameOverflow.scrollWidth).toBeLessThanOrEqual(
    frameOverflow.clientWidth,
  );
  await expect(page.locator(".chat-disclaimer")).toHaveCount(0);
});

test("supports the seven settings destinations without horizontal overflow", async ({
  page,
}) => {
  await mockConfig(page);
  await page.goto("/");
  const mobile = test.info().project.name === "mobile-chrome";
  const openSidebar = page.getByRole("button", { name: "Open sidebar" });
  if (mobile) await openSidebar.click();
  const history = page.getByRole("complementary", { name: "Chat history" });
  const newChatButton = history.getByRole("button", {
    name: "New chat",
    exact: true,
  });
  await expect(newChatButton).toBeVisible();
  await newChatButton.click();

  if (mobile) await openSidebar.click();
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  const titleFontSizes = await settings
    .locator(".settings-header h1")
    .evaluate((heading) => {
      const parent = heading.querySelector<HTMLElement>(
        ".settings-title-parent",
      );
      const current = heading.lastElementChild;
      if (!parent || !(current instanceof HTMLElement)) {
        throw new Error("Missing settings breadcrumb title");
      }
      return {
        current: getComputedStyle(current).fontSize,
        parent: getComputedStyle(parent).fontSize,
      };
    });
  expect(titleFontSizes.parent).toBe(titleFontSizes.current);
  if (mobile) {
    const pageMenu = settings.locator(".settings-mobile-nav-trigger");
    await expect(pageMenu).toHaveAccessibleName("Settings page: Appearance");
    await pageMenu.click();
    await expect(page.getByRole("menuitem")).toHaveCount(7);
    await expect(
      page.getByRole("menuitem", { name: "Model service", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Web search", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Image generation", exact: true }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "About", exact: true }).click();
    await expect(
      settings.getByRole("heading", { name: "About", exact: true }).first(),
    ).toBeVisible();
  } else {
    const appearanceTab = settings.getByRole("tab", { name: "Appearance" });
    const aboutTab = settings.getByRole("tab", { name: "About" });
    const serviceTab = settings.getByRole("tab", { name: "Model service" });
    await expect(settings.getByRole("tab")).toHaveCount(7);
    await expect(
      settings.getByRole("tab", { name: "Web search", exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByRole("tab", { name: "Image generation", exact: true }),
    ).toBeVisible();
    await expect(appearanceTab).toHaveAttribute("aria-selected", "true");
    await appearanceTab.focus();
    await appearanceTab.press("End");
    await expect(aboutTab).toHaveAttribute("aria-selected", "true");
    await expect(aboutTab).toBeFocused();
    await aboutTab.press("Home");
    await expect(appearanceTab).toHaveAttribute("aria-selected", "true");
    await expect(appearanceTab).toBeFocused();
    await appearanceTab.press("ArrowRight");
    await expect(serviceTab).toHaveAttribute("aria-selected", "true");
    await expect(serviceTab).toBeFocused();

    if (test.info().project.name === "chromium") {
      for (const width of [1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await settings.evaluate((workspace) => {
          const sidebar =
            workspace.querySelector<HTMLElement>(".settings-sidebar");
          const header = workspace.querySelector<HTMLElement>(
            ".settings-header-inner",
          );
          const section = workspace.querySelector<HTMLElement>(
            ".settings-ui-section",
          );
          if (!sidebar || !header || !section) {
            throw new Error("Missing settings layout region");
          }
          const sidebarBox = sidebar.getBoundingClientRect();
          const headerBox = header.getBoundingClientRect();
          const sectionBox = section.getBoundingClientRect();
          return {
            gap: sectionBox.left - sidebarBox.right,
            headerLeft: headerBox.left,
            sectionLeft: sectionBox.left,
            sectionWidth: sectionBox.width,
          };
        });
        expect(geometry.gap).toBeLessThanOrEqual(48);
        expect(
          Math.abs(geometry.headerLeft - geometry.sectionLeft),
        ).toBeLessThanOrEqual(1);
        expect(geometry.sectionWidth).toBeGreaterThan(width * 0.55);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }

  await selectSettingsPage(page, settings, "About");
  await expect(
    settings.getByRole("heading", { name: "Product information" }),
  ).toBeVisible();
  await expect(settings.locator(".settings-about-identity")).toBeVisible();
  await expect(settings.locator(".settings-about-list > div")).toHaveCount(5);
  await expect(
    settings.getByRole("link", { name: "Open repository" }),
  ).toHaveAttribute("href", "https://github.com/lin-z-z/CherryChat");
  await expectNoHorizontalOverflow(settings);
  await page.screenshot({
    path: `test-results/settings-about-${test.info().project.name}-light.png`,
    fullPage: true,
  });

  await selectSettingsPage(page, settings, "Model service");
  await expectNoHorizontalOverflow(settings);
  const availableModelsRow = settings.locator(
    ".settings-ui-row:has(.settings-model-discovery-actions)",
  );
  await expect(
    availableModelsRow.getByRole("button", { name: "Refresh models" }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Save model selection" }),
  ).toHaveCount(0);
  const serviceFlow = await Promise.all([
    availableModelsRow.boundingBox(),
    settings.locator(".settings-model-enablement-block").boundingBox(),
  ]);
  expect(serviceFlow[0]).not.toBeNull();
  expect(serviceFlow[1]).not.toBeNull();
  expect(serviceFlow[1]!.y).toBeGreaterThanOrEqual(
    serviceFlow[0]!.y + serviceFlow[0]!.height - 1,
  );
  await settings.getByRole("tabpanel").focus();
  await page.screenshot({
    path: `test-results/settings-service-${test.info().project.name}-light.png`,
    fullPage: true,
  });

  await selectSettingsPage(page, settings, "Web search");
  const searchResultSlider = settings.getByRole("slider", {
    name: "Sources per search",
  });
  await expect(searchResultSlider).toHaveAttribute("aria-valuemin", "1");
  await expect(searchResultSlider).toHaveAttribute("aria-valuemax", "50");
  await expect(searchResultSlider).toHaveAttribute("aria-valuenow", "5");
  await searchResultSlider.press("ArrowRight");
  await expect(searchResultSlider).toHaveAttribute("aria-valuenow", "6");
  for (const control of [
    settings.locator(".settings-source-value"),
    settings.getByRole("switch", { name: "Allow web search" }),
  ]) {
    const rightAlignment = await control.evaluate((element) => {
      const controlColumn = element.closest<HTMLElement>(
        ".settings-ui-row-control",
      );
      if (!controlColumn) throw new Error("Missing Web search control column");
      return (
        controlColumn.getBoundingClientRect().right -
        element.getBoundingClientRect().right
      );
    });
    expect(Math.abs(rightAlignment)).toBeLessThanOrEqual(1);
  }
  await expectNoHorizontalOverflow(settings);
  await page.screenshot({
    path: `test-results/settings-web-search-${test.info().project.name}-light.png`,
    fullPage: true,
  });

  await selectSettingsPage(page, settings, "Image generation");
  await expect(settings.getByLabel("Provider base URL")).toBeVisible();
  await expect(
    settings.getByRole("textbox", { name: "API key", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("textbox", { name: "Image model", exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(settings);
  await page.screenshot({
    path: `test-results/settings-image-generation-${test.info().project.name}-light.png`,
    fullPage: true,
  });

  await selectSettingsPage(page, settings, "Data");
  await expect(
    settings.getByRole("heading", { name: "Full backup" }),
  ).toBeVisible();
  await expect(
    settings.getByRole("heading", { name: "Current chat" }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Export full backup", exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Import backup", exact: true }),
  ).toBeVisible();
  const includeReasoningSwitch = settings.getByRole("switch", {
    name: "Include reasoning content",
  });
  const switchAlignment = await includeReasoningSwitch.evaluate((control) => {
    const controlColumn = control.closest<HTMLElement>(
      ".settings-ui-row-control",
    );
    if (!controlColumn) throw new Error("Missing Data control column");
    const columnBox = controlColumn.getBoundingClientRect();
    const switchBox = control.getBoundingClientRect();
    return columnBox.right - switchBox.right;
  });
  expect(Math.abs(switchAlignment)).toBeLessThanOrEqual(1);
  for (const buttonName of ["Clear all chats", "Clear all local data"]) {
    const dangerButton = settings.getByRole("button", {
      name: buttonName,
      exact: true,
    });
    const rightAlignment = await dangerButton.evaluate((button) => {
      const controlColumn = button.closest<HTMLElement>(
        ".settings-ui-row-control",
      );
      if (!controlColumn) throw new Error("Missing Data control column");
      return (
        controlColumn.getBoundingClientRect().right -
        button.getBoundingClientRect().right
      );
    });
    expect(Math.abs(rightAlignment)).toBeLessThanOrEqual(1);
  }
  await expectNoHorizontalOverflow(settings);
  await page.screenshot({
    path: `test-results/settings-data-${test.info().project.name}-light.png`,
    fullPage: true,
  });

  await selectSettingsPage(page, settings, "Model management");
  await expect(
    settings.getByRole("heading", { name: "Model settings" }),
  ).toBeVisible();
  const defaultModelForm = settings.locator(".settings-default-model-form");
  const modelPicker = settings.locator(".settings-model-picker");
  const compatibilityRows = settings.locator(".settings-capability-row");
  await expect(defaultModelForm).toBeVisible();
  await expect(modelPicker).toBeVisible();
  await expect(compatibilityRows).toHaveCount(7);
  await expect(
    settings.getByRole("heading", { name: "Tool use" }),
  ).toBeVisible();
  await expect(
    settings.getByRole("heading", {
      name: "Response randomness",
    }),
  ).toBeVisible();
  await expect(
    settings.getByRole("heading", { name: "Response diversity" }),
  ).toBeVisible();
  await expect(settings.getByRole("slider")).toHaveCount(2);
  await expect(
    settings.getByRole("switch", { name: "Streaming response" }),
  ).toBeChecked();
  const temperatureSwitch = settings.getByRole("switch", {
    name: "Enable response randomness",
  });
  const temperatureValue = settings.getByRole("spinbutton", {
    name: "Response randomness value",
  });
  await expect(temperatureSwitch).not.toBeChecked();
  await expect(temperatureValue).toBeDisabled();
  await temperatureSwitch.click();
  await temperatureValue.fill("3");
  await expect(temperatureValue).toHaveValue("2");
  await temperatureValue.fill("");
  await expect(temperatureValue).toHaveValue("2");
  await temperatureValue.fill("0.7");
  const topPSwitch = settings.getByRole("switch", {
    name: "Enable response diversity",
  });
  const topPValue = settings.getByRole("spinbutton", {
    name: "Response diversity value",
  });
  await topPSwitch.click();
  await topPValue.fill("-1");
  await expect(topPValue).toHaveValue("0");
  await topPSwitch.click();
  await settings.getByRole("button", { name: "Save model settings" }).click();
  await expect(settings.getByText(/Model settings saved for/u)).toBeVisible();
  await expect(settings.locator('input[name="maxTokensValue"]')).toHaveCount(0);
  await expect(settings.getByLabel("Custom JSON parameters")).toHaveCount(0);
  await expectNoHorizontalOverflow(settings);
  if (mobile) {
    const controlBox = await defaultModelForm.boundingBox();
    expect(controlBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(170);
  } else {
    const [selectBox, saveBox, pickerBox, selectedModelBox] = await Promise.all(
      [
        settings.getByLabel("Default model").boundingBox(),
        settings
          .getByRole("button", { name: "Save default model", exact: true })
          .boundingBox(),
        modelPicker.boundingBox(),
        settings.getByLabel("Selected model").boundingBox(),
      ],
    );
    expect(
      Math.abs(
        (selectBox?.y ?? 0) +
          (selectBox?.height ?? 0) -
          ((saveBox?.y ?? 0) + (saveBox?.height ?? 0)),
      ),
    ).toBeLessThanOrEqual(2);
    expect(selectedModelBox?.width ?? 0).toBeGreaterThan(
      (pickerBox?.width ?? Number.POSITIVE_INFINITY) * 0.9,
    );
  }
  await modelPicker.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/settings-model-management-${test.info().project.name}-light-top.png`,
    fullPage: true,
  });
  await compatibilityRows.last().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/settings-model-management-${test.info().project.name}-light-bottom.png`,
    fullPage: true,
  });
  await settings.getByRole("tabpanel").focus();
  await page.screenshot({
    path: `test-results/settings-${test.info().project.name}-light.png`,
    fullPage: true,
  });

  await selectSettingsPage(page, settings, "Appearance");
  await selectSettingsOption(page, settings, "Theme", "Dark");
  await selectSettingsPage(page, settings, "About");
  await expectNoHorizontalOverflow(settings);
  await page.screenshot({
    path: `test-results/settings-about-${test.info().project.name}-dark.png`,
    fullPage: true,
  });
  await selectSettingsPage(page, settings, "Model service");
  await expectNoHorizontalOverflow(settings);
  await settings.getByRole("tabpanel").focus();
  await page.screenshot({
    path: `test-results/settings-service-${test.info().project.name}-dark.png`,
    fullPage: true,
  });
  await selectSettingsPage(page, settings, "Data");
  await expectNoHorizontalOverflow(settings);
  await page.screenshot({
    path: `test-results/settings-data-${test.info().project.name}-dark.png`,
    fullPage: true,
  });
  await selectSettingsPage(page, settings, "Model management");
  await expectNoHorizontalOverflow(settings);
  await modelPicker.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/settings-model-management-${test.info().project.name}-dark-top.png`,
    fullPage: true,
  });
  await compatibilityRows.last().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/settings-model-management-${test.info().project.name}-dark-bottom.png`,
    fullPage: true,
  });
  await settings.getByRole("tabpanel").focus();
  await page.screenshot({
    path: `test-results/settings-${test.info().project.name}-dark.png`,
    fullPage: true,
  });
});

test("keeps connection drafts local and confirms discarded changes", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop settings flow");
  await mockConfig(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model service");
  await page.getByLabel("API key").fill("draft-only-key");
  await expect(
    page.getByText("This connection has unsaved changes."),
  ).toBeVisible();

  const close = settings.getByRole("button", { name: "Close" });
  await close.click();
  const discardDialog = page.getByRole("alertdialog");
  await expect(
    discardDialog.getByRole("button", { name: "Cancel" }),
  ).toBeFocused();
  await discardDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(close).toBeFocused();
  await expect(page.getByLabel("API key")).toHaveValue("draft-only-key");

  await close.click();
  await discardDialog
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(settings).toBeHidden();
  await page.getByRole("button", { name: "Settings" }).click();
  const reopened = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, reopened, "Model service");
  await expect(page.getByLabel("API key")).toHaveValue("");
});

test("persists the default model and scopes compatibility by model", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "desktop settings flow");
  await mockConfig(page, {
    models: ["gpt-4.1-mini", "gpt-5"],
    defaultModel: "gpt-4.1-mini",
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("main", { name: "Settings" });
  await selectSettingsPage(page, settings, "Model management");

  const defaultModel = await selectSettingsModel(
    page,
    settings,
    "Default model",
    "gpt-5",
  );
  await expect(defaultModel).toContainText("gpt-5");
  await settings
    .getByRole("button", { name: "Save default model", exact: true })
    .click();
  await expect(settings.getByText("Default model saved.")).toBeVisible();

  const selectedModel = settings.getByLabel("Selected model");
  const contextCapacity = settings.getByLabel("Context window");
  const reasoningSupport = settings.getByRole("switch", {
    name: "Reasoning support",
  });
  const imageInput = settings.getByRole("switch", { name: "Image input" });
  await expect(selectedModel).toContainText("gpt-4.1-mini");
  await expect(contextCapacity).toHaveValue("1047576");
  await expect(
    settings.getByText(
      "Model capabilities use the model catalogue recommendation",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await reasoningSupport.click();
  await imageInput.click();
  await contextCapacity.fill("42424");
  await settings
    .getByRole("button", { name: "Save model settings", exact: true })
    .click();
  await expect(
    settings.getByText("Model settings saved for gpt-4.1-mini."),
  ).toBeVisible();
  await expect(
    settings.getByText("Model capabilities use custom settings", {
      exact: true,
    }),
  ).toBeVisible();

  await selectSettingsModel(page, settings, "Selected model", "gpt-5");
  await expect(contextCapacity).toHaveValue("400000");
  await expect(reasoningSupport).toBeChecked();
  await expect(imageInput).toBeChecked();
  await expect(settings.getByLabel("Reasoning options")).toHaveValue(
    "minimal, low, medium, high",
  );
  await expect(
    settings.getByText(
      "Model capabilities use the model catalogue recommendation",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await selectSettingsModel(page, settings, "Selected model", "gpt-4.1-mini");
  await expect(contextCapacity).toHaveValue("42424");
  await expect(
    settings.getByText("Model capabilities use custom settings", {
      exact: true,
    }),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
  await expect(
    page.getByRole("status", { name: "Automatic reasoning" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add image" })).toHaveCount(0);

  await page
    .getByRole("complementary", { name: "Chat history" })
    .getByRole("button", { name: "New chat", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Selected model: gpt-5" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Selected model: gpt-5" }),
  ).toBeVisible();
});

test("keeps the tablet workspace compact at the desktop boundary", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "chromium", "single tablet viewport");
  await page.setViewportSize({ width: 768, height: 900 });
  await mockConfig(page);
  await page.goto("/");
  await expect(page.locator(".conversation-drawer")).not.toHaveClass(
    /expanded/u,
  );

  const layout = await page.evaluate(() => {
    const drawer = document.querySelector<HTMLElement>(".conversation-drawer");
    const workspace = document.querySelector<HTMLElement>(".chat-workspace");
    const composer = document.querySelector<HTMLElement>(".composer-region");
    if (!drawer || !workspace || !composer) throw new Error("Missing shell");
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      drawerWidth: drawer.getBoundingClientRect().width,
      workspaceWidth: workspace.getBoundingClientRect().width,
      composerWidth: composer.getBoundingClientRect().width,
    };
  });

  expect(layout.documentWidth).toBe(layout.viewportWidth);
  expect(layout.drawerWidth).toBeGreaterThanOrEqual(52);
  expect(layout.drawerWidth).toBeLessThanOrEqual(60);
  expect(layout.workspaceWidth).toBeGreaterThan(700);
  expect(layout.composerWidth).toBeGreaterThan(650);
});

test("publishes an installable manifest without registering a service worker", async ({
  page,
}) => {
  await mockConfig(page);
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  expect(await manifestResponse.json()).toMatchObject({
    name: "CherryChat",
    display: "standalone",
    start_url: "/",
    icons: [
      { src: "/icon-192.png", sizes: "192x192" },
      { src: "/icon-512.png", sizes: "512x512" },
    ],
  });
  expect((await page.request.get("/icon-192.png")).ok()).toBe(true);
  expect((await page.request.get("/icon-512.png")).ok()).toBe(true);
  expect(
    await page.evaluate(async () =>
      "serviceWorker" in navigator
        ? (await navigator.serviceWorker.getRegistrations()).length
        : 0,
    ),
  ).toBe(0);
});
