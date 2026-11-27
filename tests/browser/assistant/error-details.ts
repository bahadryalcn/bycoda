import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Failures show a short plain headline; the Host's error text sits behind the Details control.
 * Opens the first Details control inside `scope` and expects its technical text to include `text`.
 */
export async function expectErrorDetail(page: Page, text: string | RegExp, scope?: Locator) {
  const trigger = (scope ?? page).getByRole("button", { name: /^Details/ }).first();
  await trigger.click();
  await expect(
    page.getByRole("dialog", { name: /^Details/ }).getByLabel("Error details"),
  ).toContainText(text);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /^Details/ })).toHaveCount(0);
}
