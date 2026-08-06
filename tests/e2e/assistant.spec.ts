import { expect, test, type Page } from "@playwright/test";

const defaultConfig = {
  byokEnabled: true,
  hostedEnabled: false,
  hostedWebSearchEnabled: false,
  models: [] as string[],
  defaultModel: null as string | null,
  authenticated: false,
};

async function mockAssistantPage(page: Page) {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(defaultConfig),
    });
  });
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
                delta: { content: "Assistant reply" },
                finish_reason: null,
              },
            ],
          })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""),
      });
    },
  );
}

async function expectTopbarFits(page: Page) {
  const assistant = page.locator(".assistant-selector-trigger");
  const model = page.locator(".model-selector-trigger");
  const theme = page.locator(".theme-switcher-trigger");
  const [assistantBox, modelBox, themeBox, viewport] = await Promise.all([
    assistant.boundingBox(),
    model.boundingBox(),
    theme.boundingBox(),
    page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    })),
  ]);

  expect(assistantBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(themeBox).not.toBeNull();
  expect(
    (assistantBox?.x ?? 0) + (assistantBox?.width ?? 0),
  ).toBeLessThanOrEqual((modelBox?.x ?? 0) + 1);
  expect((modelBox?.x ?? 0) + (modelBox?.width ?? 0)).toBeLessThanOrEqual(
    (themeBox?.x ?? 0) + 1,
  );
  expect((themeBox?.x ?? 0) + (themeBox?.width ?? 0)).toBeLessThanOrEqual(
    viewport.clientWidth + 1,
  );
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
}

async function expectConversationCount(
  page: Page,
  expected: number,
  mobile: boolean,
) {
  const sidebar = page.getByRole("complementary", { name: "Chat history" });
  const wasOpen = mobile && (await sidebar.isVisible());
  if (mobile && !wasOpen) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await expect(sidebar).toBeVisible();
  }
  await expect(sidebar.locator(".conversation-item")).toHaveCount(expected);
  if (mobile && !wasOpen) {
    await sidebar.getByRole("button", { name: "Close sidebar" }).click();
    await expect(sidebar).toBeHidden();
  }
}

test("manages Assistant context without partitioning chat history", async ({
  page,
}) => {
  await mockAssistantPage(page);
  await page.goto("/");
  const mobile = test.info().project.name === "mobile-chrome";

  const assistantTrigger = page.getByRole("button", {
    name: "Current assistant: Default Assistant",
  });
  await expect(assistantTrigger).toBeVisible();
  await expectTopbarFits(page);
  await page.screenshot({
    path: `test-results/assistant-topbar-${test.info().project.name}.png`,
    fullPage: true,
  });

  await assistantTrigger.click();
  const defaultOption = page.getByRole("option", {
    name: "Default Assistant",
  });
  await expect(defaultOption).toBeFocused();
  await page.getByRole("button", { name: "Create assistant" }).click();

  const editor = page.getByRole("dialog", { name: "Create assistant" });
  await expect(editor).toBeVisible();
  await editor.getByLabel("Assistant name").fill("Research helper");
  await editor.getByRole("button", { name: "Code" }).click();
  await editor
    .getByLabel("Response instructions")
    .fill("Compare sources and cite evidence.");
  const editorBox = await editor.boundingBox();
  const viewport = page.viewportSize();
  expect(editorBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(editorBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((editorBox?.x ?? 0) + (editorBox?.width ?? 0)).toBeLessThanOrEqual(
    viewport?.width ?? Number.POSITIVE_INFINITY,
  );
  expect((editorBox?.y ?? 0) + (editorBox?.height ?? 0)).toBeLessThanOrEqual(
    viewport?.height ?? Number.POSITIVE_INFINITY,
  );
  await page.screenshot({
    path: `test-results/assistant-editor-${test.info().project.name}.png`,
    fullPage: true,
  });
  await editor.getByRole("button", { name: "Save assistant" }).click();
  await expect(editor).toBeHidden();

  await assistantTrigger.click();
  await page
    .getByRole("button", { name: "Edit assistant Research helper" })
    .click();
  const editDialog = page.getByRole("dialog", { name: "Edit assistant" });
  await editDialog.getByLabel("Assistant name").fill("Research pro");
  await editDialog.getByRole("button", { name: "Close" }).click();
  const discardDialog = page.getByRole("alertdialog", {
    name: "Discard assistant changes?",
  });
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(editDialog).toBeVisible();
  await editDialog.getByRole("button", { name: "Save assistant" }).click();
  await expect(editDialog).toBeHidden();
  await expect(page.locator(".dialog-backdrop")).toHaveCount(0);

  await assistantTrigger.click();
  const assistantPopover = page.locator(".assistant-selector-popover");
  await expect(assistantPopover).toHaveCSS("opacity", "1");
  await expect(
    page.getByRole("option", { name: "Research pro" }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/assistant-popover-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("option", { name: "Research pro" }).click();
  await expect(
    page.getByRole("button", { name: "Current assistant: Research pro" }),
  ).toBeVisible();
  await expectConversationCount(page, 1, mobile);

  await page
    .getByRole("button", { name: "Current assistant: Research pro" })
    .click();
  await page.getByRole("option", { name: "Default Assistant" }).click();
  await expect(assistantTrigger).toBeVisible();
  await expectConversationCount(page, 1, mobile);

  const composer = page.getByRole("textbox", { name: "Message CherryChat" });
  await composer.fill("Keep this message in the original chat");
  await page.getByRole("button", { name: "Send" }).click();
  const sentMessage = page
    .locator(".message-user")
    .getByText("Keep this message in the original chat");
  await expect(sentMessage).toBeVisible();
  await expect(page.getByText("Assistant reply")).toBeVisible();

  await assistantTrigger.click();
  await page.getByRole("option", { name: "Research pro" }).click();
  await expect(
    page.getByRole("button", { name: "Current assistant: Research pro" }),
  ).toBeVisible();
  await expect(sentMessage).toBeHidden();
  await expectConversationCount(page, 2, mobile);

  await page
    .getByRole("button", { name: "Current assistant: Research pro" })
    .click();
  await page
    .getByRole("button", { name: "Delete assistant Research pro" })
    .click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: 'Delete "Research pro"?',
  });
  await deleteDialog.getByRole("button", { name: "Delete assistant" }).click();
  await expect(deleteDialog).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Current assistant: Research pro (deleted)",
    }),
  ).toBeVisible();
  await expectConversationCount(page, 2, mobile);

  if (mobile) {
    await page.getByRole("button", { name: "Open sidebar" }).click();
  }
  await page
    .getByRole("complementary", { name: "Chat history" })
    .locator(".conversation-drawer-actions")
    .getByRole("button", { name: "New chat", exact: true })
    .click();
  await expect(assistantTrigger).toBeVisible();
  await expectConversationCount(page, 3, mobile);
});
