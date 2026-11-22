import { expect, test } from "@playwright/test";

for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`opens grouped Activity and selects conversations at ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        `/tests/browser/workspace/working-project-summary.html?issues${light ? "&light" : ""}`,
      );
      const rail = page.locator('[data-fixture="rail"]');
      const sidebar = page.locator('[data-fixture="sidebar"]');
      for (const surface of [rail, sidebar]) {
        const header = surface.getByRole("button", { name: /^Activity/ });
        const list = surface.locator("[data-live-agents-list]");
        await expect(header).toHaveAttribute("aria-expanded", "false");
        await expect(header).not.toContainText("new");
        await expect(list).toBeHidden();
        await header.press("Enter");
        await expect(header).toHaveAttribute("aria-expanded", "true");
        await expect(list.locator("[data-live-agents-group]")).toHaveCount(3);
        await expect(
          list.locator('[data-live-agent-card="failed"], [data-live-agent-card="done"]'),
        ).toHaveCount(0);
        for (const id of ["approval", "question", "retry", "x-1", "waiting"]) {
          await list.locator(`[data-live-agent-card="${id}"]`).click();
          await expect(page.locator("[data-selected]")).toHaveText(id);
        }
        await list.locator('[data-live-agent-card="approval"]').scrollIntoViewIfNeeded();
      }
      await page.screenshot({
        path: testInfo.outputPath(`activity-${light ? "light" : "dark"}-${width}.png`),
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}
