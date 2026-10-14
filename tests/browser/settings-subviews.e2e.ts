import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const lang of ["en", "tr", "de", "fr", "es", "pt", "zh-CN", "ja"]) {
  for (const theme of ["light", "dark"]) for (const width of [390, 1440]) {
    test(`account, skill and archive subviews: ${lang} ${theme} ${width}`, async ({ page }) => {
      mkdirSync("temp/verification/settings-integrated/subviews", { recursive: true });
      const prefix = `temp/verification/settings-integrated/subviews/${lang}-${theme}-${width}`;
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const open = async (section: string) => {
        await page.goto(`/tests/browser/settings.html?lang=${lang}&theme=${theme}&section=${section}`);
        await expect(page.locator("main")).toHaveAttribute("data-fixture-labels", /account/);
        return JSON.parse((await page.locator("main").getAttribute("data-fixture-labels"))!) as Record<string, string>;
      };
      const themeLabels = await open("appearance");
      await expect(page.locator("html")).toHaveClass(theme === "light" ? /theme-light/ : /^(?!.*theme-light)/);
      await expect(page.getByRole("radio", { name: themeLabels.theme, exact: true })).toHaveAttribute("aria-checked", "true");
      await page.locator("details.settings-advanced").evaluateAll((nodes) => {
        for (const node of nodes) (node as HTMLDetailsElement).open = true;
      });
      const brightness = page.locator('[data-setting-id="dark-lightness"]').getByRole("slider");
      if (theme === "light") await expect(brightness).toHaveAttribute("aria-disabled", "true");
      else await expect(brightness).not.toHaveAttribute("aria-disabled", "true");
      await page.screenshot({ path: `${prefix}-appearance-theme.png` });
      const scroller = page.locator("[data-settings-scroller]");
      const dimensions = await scroller.evaluate((node) => ({ height: node.clientHeight, total: node.scrollHeight }));
      for (let top = 0, frame = 0; top < dimensions.total; top += Math.max(1, dimensions.height - 80), frame++) {
        await scroller.evaluate((node, top) => { node.scrollTop = top; }, top);
        await page.screenshot({ path: `temp/verification/settings-integrated/screens/${lang}-${theme}-${width}-appearance-${frame}.png` });
      }
      const labels = await open("providers");
      const accounts = page.locator('[data-setting-id="provider-accounts"]');
      const add = accounts.getByRole("button", { name: labels.account, exact: true });
      for (const [index, provider] of ["Claude Code", "Codex"].entries()) {
        await page.getByRole("button", { name: new RegExp(`^${provider},`) }).click();
        await add.click();
        const form = accounts.locator("form");
        await expect(form).toBeVisible();
        await expect(form.locator("input")).toBeFocused();
        await form.locator("input").fill("A very long review account name for layout checks");
        expect(await form.evaluate((node) => node.scrollWidth <= node.clientWidth + 2)).toBe(true);
        await page.screenshot({ path: `${prefix}-account-${index}.png` });
        await form.getByRole("button", { name: labels.cancel, exact: true }).click();
        await expect(form).toHaveCount(0);
      }
      const skillLabels = await open("skills");
      const addSkill = page.getByRole("button", { name: skillLabels.skill, exact: true });
      await addSkill.click();
      const name = page.getByRole("textbox", { name: skillLabels.skillName, exact: true });
      await expect(name).toBeFocused();
      await name.fill("review-settings");
      await page.screenshot({ path: `${prefix}-skill-form.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("button", { name: skillLabels.cancel, exact: true }).click();
      await expect(name).toHaveCount(0);
      await expect(addSkill).toBeFocused();

      await page.addInitScript(() => localStorage.setItem("bycoda.archivedProjects", JSON.stringify([
        { path: "/fixture/long-archived-project-name-for-settings-review", archivedAt: 1 },
      ])));
      const archiveLabels = await open("archive");
      const remove = page.locator('[data-setting-id="archived-projects"]').getByRole("button", { name: archiveLabels.delete, exact: true });
      await remove.click();
      const confirmation = page.getByRole("dialog");
      await expect(confirmation).toBeVisible();
      await expect(confirmation.getByRole("button", { name: archiveLabels.cancel, exact: true })).toBeFocused();
      await expect(page.locator("main")).toHaveAttribute("data-fixture-deletions", "0");
      expect(await confirmation.evaluate((node) => node.scrollWidth <= node.clientWidth + 2)).toBe(true);
      await page.screenshot({ path: `${prefix}-archive-confirmation.png` });
      await page.keyboard.press("Escape");
      await expect(confirmation).toHaveCount(0);
      await expect(page.locator("main")).toHaveAttribute("data-fixture-deletions", "0");
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bycoda.archivedProjects")!).length)).toBe(1);
      expect(errors).toEqual([]);
    });
  }
}
