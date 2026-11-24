import { expect, test } from "@playwright/test";

for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`opens flat Activity and selects conversations at ${width} ${light ? "light" : "dark"}`, async ({
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
        const rows = ["x-1", "failed", "approval", "question", "retry", "waiting", "done"];
        expect(
          await list
            .locator(":scope > [data-live-agent-card]")
            .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-live-agent-card"))),
        ).toEqual(rows);
        for (const id of rows) {
          await list.locator(`[data-live-agent-card="${id}"]`).click();
          await expect(page.locator("[data-selected]")).toHaveText(id);
        }
        if (surface === rail) await list.evaluate((element) => (element.scrollTop = 0));
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
