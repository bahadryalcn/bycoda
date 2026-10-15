import { expect, test } from "@playwright/test";
const fixture = "/tests/browser/onboarding.html";
const captures = "temp/verification/2026-10-13-onboarding";

test("saves workspace and appearance choices, finishes directly and can reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixture);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "A workspace that fits you" })).toBeVisible();
  await dialog
    .locator(".onboarding-feature")
    .filter({ hasText: "Social Media" })
    .getByRole("checkbox")
    .uncheck();
  await expect(dialog.getByRole("heading", { name: "A workspace that fits you" })).toBeInViewport();
  await page.screenshot({ path: `${captures}/workspace-dark.png` });
  await dialog.getByRole("button", { name: /2\s*Appearance/ }).click();
  await expect(dialog.locator(".onboarding-crew-preview canvas")).toHaveCount(2);
  await expect
    .poll(() =>
      dialog
        .locator(".onboarding-crew-preview canvas")
        .evaluateAll((items) => items.every((item) => (item as HTMLCanvasElement).width > 100)),
    )
    .toBe(true);
  await dialog.locator('input[name="onboarding-crew"][value="star-wars"]').check();
  await dialog.locator('input[name="onboarding-appearance"][value="light"]').check();
  await expect(page.locator("html")).toHaveClass(/theme-light/);
  await expect(dialog.locator('input[name="onboarding-crew"][value="none"]')).toBeInViewport();
  await expect(dialog.getByRole("checkbox", { name: "Decorative animations" })).toBeInViewport();
  await page.screenshot({ path: `${captures}/appearance-light.png` });
  await dialog.getByRole("button", { name: /3\s*Agents/ }).click();
  await expect(dialog.getByRole("heading", { name: "Connect your agents" })).toBeVisible();
  await dialog.locator(".onboarding-provider-select select").selectOption("cursor");
  await dialog.getByRole("button", { name: "Add provider" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Use Cursor" })).toBeChecked();
  await page.screenshot({ path: `${captures}/providers-light.png` });
  await dialog.getByRole("button", { name: /4\s*Connections/ }).click();
  await expect(dialog.getByRole("button", { name: /Manage connections/ })).toBeVisible();
  await dialog.getByRole("button", { name: /5\s*Projects/ }).click();
  await dialog.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByText("Workspace ready")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Fixture tools" })
      .getByRole("button", { name: "Social Media" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reopen setup" }).click();
  await expect(
    dialog.locator(".onboarding-feature").filter({ hasText: "Social Media" }).getByRole("checkbox"),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: /2\s*Appearance/ }).click();
  await expect(dialog.locator('input[name="onboarding-crew"][value="star-wars"]')).toBeChecked();
  await expect(dialog.locator('input[name="onboarding-appearance"][value="light"]')).toBeChecked();
  await dialog.getByRole("button", { name: /3\s*Agents/ }).click();
  await expect(dialog.getByRole("checkbox", { name: "Use Cursor" })).toBeChecked();
  expect(errors).toEqual([]);
});

test("keeps navigation and footer accessible at narrow and short viewports", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 760 },
    { width: 820, height: 540 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${fixture}?lang=tr`);
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Sana uygun bir çalışma alanı" }),
    ).toBeVisible();
    await expect(dialog.locator(".onboarding-footer button.onboarding-primary")).toBeInViewport();
    await expect(dialog.getByRole("button", { name: /5\s*Projeler/ })).toBeInViewport();
    await dialog.getByRole("button", { name: /2\s*Görünüm/ }).click();
    await expect(dialog.locator(".onboarding-footer button.onboarding-primary")).toBeInViewport();
    await dialog.locator('input[name="onboarding-crew"][value="none"]').check();
    await expect(dialog.locator(".onboarding-footer button.onboarding-primary")).toBeInViewport();
    await page.screenshot({ path: `${captures}/appearance-tr-${viewport.width}.png` });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
