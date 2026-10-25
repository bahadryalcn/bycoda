import { test, expect } from "@playwright/test";
import type {} from "./text-actions";

const variants = [
  { width: 1000, light: false },
  { width: 390, light: false },
  { width: 1000, light: true },
  { width: 390, light: true },
];

for (const target of ["reprompt", "en"] as const) {
  const title = target === "reprompt" ? "Reprompt" : "Translate to English";
  const waiting = target === "reprompt" ? "Rewriting…" : "Translating…";
  const apply = target === "reprompt" ? "Apply prompt" : "Apply translation";
  test(`${title} starts once with Settings defaults, streams and applies across sizes and themes`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const variant of variants) {
      await page.setViewportSize({ width: variant.width, height: 800 });
      await page.goto(
        `/tests/browser/text-actions.html?target=${target}${variant.light ? "&light" : ""}`,
        { waitUntil: "domcontentloaded" },
      );
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => window.__textActionsFixture.snapshot()))
        .toMatchObject([
          {
            cwd: "/fixture-project",
            model: "fixture-default",
            modelSettings: { effort: "high" },
            providerAccountId: "default",
            aborted: false,
          },
        ]);
      await expect(dialog.getByText(waiting, { exact: false })).toHaveCount(1);
      await expect(dialog.getByRole("button", { name: apply, exact: true })).toBeDisabled();
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      if (target === "reprompt" && variant.width === 1000 && !variant.light) {
        await page.screenshot({
          path: "temp/verification/2026-10-25-text-actions/desktop-dark-pending.png",
        });
      }
      await page.evaluate(() => window.__textActionsFixture.delta("Clear fixture prompt"));
      await expect(dialog.getByText("Clear fixture prompt", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: apply, exact: true })).toBeDisabled();
      await page.evaluate(() =>
        window.__textActionsFixture.resolve("Clear fixture prompt with a concrete result."),
      );
      await expect(dialog.getByRole("button", { name: apply, exact: true })).toBeEnabled();
      await expect(dialog.getByText(waiting, { exact: false })).toHaveCount(0);
      await expect(dialog.getByRole("status")).toContainText("Ready");
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (target === "reprompt" && variant.width === 390 && variant.light) {
        await page.screenshot({
          path: "temp/verification/2026-10-25-text-actions/narrow-light-ready.png",
        });
      }
      await dialog.getByRole("button", { name: apply, exact: true }).press("Enter");
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => window.__textActionsFixture.applied())).toBe(
        "Clear fixture prompt with a concrete result.",
      );
      expect(await page.evaluate(() => window.__textActionsFixture.snapshot())).toHaveLength(1);
    }
  });

  test(`${title} honors its override and aborts on keyboard close`, async ({ page }) => {
    await page.goto(`/tests/browser/text-actions.html?target=${target}&override`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("dialog", { name: title, exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__textActionsFixture.snapshot()))
      .toMatchObject([
        {
          model: "fixture-override",
          modelSettings: { effort: "medium" },
          aborted: false,
        },
      ]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.__textActionsFixture.snapshot()[0].aborted))
      .toBe(true);
  });
}
