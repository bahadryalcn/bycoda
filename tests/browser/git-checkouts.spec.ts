import { test, expect } from "@playwright/test";

test("checkout rows preserve identity, keyboard disclosure and searchable selection", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.goto("/tests/browser/git-workspace.html?checkouts");
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      const row = page.locator(
        '[data-git-repository="/trees/audit/very-long-worktree-folder-name"]',
      );
      await expect(row.locator("header")).toContainText(
        "audit/2026-10-14-long-branch-name-for-responsive-review",
      );
      await expect(row.locator('header button[aria-label="Stage All Changes"]')).toHaveCount(0);
      await expect(page.locator("[data-current-checkout]")).toContainText("Current");
      expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`checkouts-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
  const detached = page.locator('[data-git-repository="/trees/detached"]');
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(detached.locator("header")).toContainText("fd3caac");
  const toggle = detached.locator("header button[aria-expanded]").first();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(detached.locator('header button[aria-label="Stage All Changes"]')).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Working copy: All checkouts", exact: true }).click();
  await page.getByRole("combobox").fill("detached");
  await page.getByRole("option", { name: "Detached · /trees/detached", exact: true }).click();
  await expect(page.locator("[data-git-repository]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Working copy: Detached · /trees/detached", exact: true }),
  ).toBeVisible();
});
