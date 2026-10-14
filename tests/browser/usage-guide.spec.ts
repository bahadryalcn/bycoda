import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/onboarding.html?guide";
const captures = "temp/verification/2026-10-14-usage-guide";

test("walks through the character guide, restores previous steps and finishes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixture);
  const guide = page.getByRole("alertdialog");
  await expect(guide.getByRole("heading", { name: "Start a chat" })).toBeVisible();
  await expect(guide.getByRole("button", { name: "← Back" })).toBeDisabled();
  await expect
    .poll(() =>
      guide
        .locator(".usage-guide-character")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: `${captures}/chat-dark.png`, animations: "disabled" });
  await guide.getByRole("button", { name: "Continue →" }).click();
  await expect(guide.getByText("Leia Organa")).toBeVisible();
  await expect(guide.locator('[aria-current="step"]')).toContainText("Queue message");
  await guide.getByRole("button", { name: "← Back" }).click();
  await expect(guide.getByText("Obi-Wan Kenobi")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await guide.getByRole("button", { name: "Continue →" }).click();
    await expect(guide.locator(".usage-guide-progress")).toHaveText(`Step ${i + 2} of 5`);
  }
  await expect(guide.getByText("Chewbacca")).toBeVisible();
  await guide.getByRole("button", { name: "Done", exact: true }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.locator("[data-usage-guide-running]")).toHaveCount(0);
  await page.getByRole("button", { name: "Reopen guide" }).click();
  await expect(guide.getByText("Obi-Wan Kenobi")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("keeps actions visible in Turkish on narrow, short and wide screens", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 760 },
    { width: 768, height: 540 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${fixture}&lang=tr`);
    const guide = page.getByRole("alertdialog");
    await expect(guide.getByRole("heading", { name: "Chat başlat" })).toBeVisible();
    await expect(guide.getByRole("button", { name: "Devam →" })).toBeInViewport();
    await expect(guide.getByRole("button", { name: "Rehberi kapat" })).toBeInViewport();
    const bounds = await guide.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({
      path: `${captures}/chat-tr-${viewport.width}.png`,
      animations: "disabled",
    });
    await guide.getByRole("button", { name: "Rehberi kapat" }).click();
    await expect(guide).toHaveCount(0);
  }
});

test("supports light appearance, keyboard navigation and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixture);
  await page.evaluate(() => {
    document.documentElement.classList.add("theme-light");
    document.documentElement.classList.remove("dark");
    document.documentElement.dataset.accent = "blue";
  });
  const guide = page.getByRole("alertdialog");
  await expect(guide).toBeVisible();
  await expect(guide.locator(".usage-guide-scroll")).toHaveCSS("animation-name", "none");
  await expect(guide.locator(".usage-guide-progress")).toHaveText("Step 1 of 5");
  await guide.getByRole("button", { name: "Continue →" }).focus();
  await page.keyboard.press("Enter");
  await expect(guide.getByText("Leia Organa")).toBeVisible();
  await expect(guide.locator(".usage-guide-progress")).toHaveText("Step 2 of 5");
  await page.keyboard.press("Tab");
  await expect(guide.locator(":focus")).toHaveCount(1);
  await page.screenshot({ path: `${captures}/queue-light.png`, animations: "disabled" });
});
