import { expect, type Locator, type Page } from "@playwright/test";

export async function waitForChatAppReady(page: Page, settingsName: string) {
  const settingsTrigger = page.locator("[data-settings-trigger]:visible");
  await expect(settingsTrigger).toHaveCount(1);
  await expect(settingsTrigger).toHaveAccessibleName(settingsName);
  await expect(settingsTrigger).toBeEnabled();
  return settingsTrigger;
}

export async function selectSettingsPage(
  page: Page,
  settings: Locator,
  name: string,
) {
  const desktopTab = settings.getByRole("tab", { name, exact: true });
  if (await desktopTab.isVisible()) {
    await desktopTab.click();
  } else {
    await settings.locator(".settings-mobile-nav-trigger").click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
  await expect(
    settings.getByRole("heading", { name, exact: true }).first(),
  ).toBeVisible();
}

export async function selectSettingsOption(
  page: Page,
  settings: Locator,
  label: string,
  option: string,
) {
  const trigger = settings.getByRole("combobox", { name: label, exact: true });
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  return trigger;
}

export async function selectSettingsModel(
  page: Page,
  settings: Locator,
  label: string,
  model: string,
) {
  const trigger = settings.getByRole("button", { name: label, exact: true });
  await trigger.click();
  await page.getByRole("option", { name: model, exact: true }).click();
  return trigger;
}

export async function expectNoHorizontalOverflow(locator: Locator) {
  const dimensions = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}
