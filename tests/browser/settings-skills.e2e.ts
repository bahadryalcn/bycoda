import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["dark", "light"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`skills workspace ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings.html?section=skills&skills=1&theme=${theme}`);
      await page.getByRole("button", { name: "arc", exact: true }).click();
      const editor = page.getByRole("textbox", { name: "Skill instructions", exact: true });
      await expect(editor).toBeVisible();
      await editor.fill("---\nname: arc\n---\n\n# Edited instructions\n");
      await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText("Skill saved.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const panel = page.getByRole("complementary", { name: "Skill preview" });
      const bounds = await panel.boundingBox();
      expect(bounds!.height).toBeGreaterThan(600);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(901);
      if (width === 1440) {
        await expect(page.getByRole("searchbox", { name: "Filter skills" })).toBeVisible();
        const list = await page.getByRole("region", { name: "Skills", exact: true }).boundingBox();
        expect(bounds!.width).toBeGreaterThan(list!.width);
        const actions = page.getByRole("button", { name: "Actions for arc", exact: true });
        await actions.click();
        const menu = page.getByRole("menu", { name: "Actions for arc", exact: true });
        await expect(menu).toBeVisible();
        await expect(page.getByRole("menuitem", { name: "Disable arc" })).toBeFocused();
        await page.keyboard.press("End");
        await expect(page.getByRole("menuitem", { name: "Delete arc" })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(actions).toBeFocused();
        await expect(panel).toBeVisible();
      }
      mkdirSync("temp/verification/skills-workspace", { recursive: true });
      await page.screenshot({ path: `temp/verification/skills-workspace/${theme}-${width}.png` });
      await page.getByRole("button", { name: "Close skill preview" }).click();
      await expect(page.getByRole("searchbox", { name: "Filter skills" })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

for (const theme of ["dark", "light"]) {
  for (const width of [800, 1280]) {
    test(`skills library across machines ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 860 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings.html?section=skills&skills=1&machines=1&theme=${theme}`,
      );
      const dir = "temp/verification/skills-redesign";
      mkdirSync(dir, { recursive: true });
      await expect(page.getByRole("button", { name: "remote-notes", exact: true })).toBeVisible();
      await expect(page.getByRole("img", { name: "On tailm", exact: true }).first()).toBeVisible();
      await expect(page.getByText("Permission", { exact: true })).toHaveCount(0);
      await page.screenshot({ path: `${dir}/list-${theme}-${width}.png` });

      await expect(
        page.getByRole("button", { name: "Copy skill-2 to tailm", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Copy arc to tailm", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "skill-2", exact: true }).click();
      await page.getByRole("tab", { name: "Machines", exact: true }).click();
      const machines = page.getByRole("list", { name: "Machines", exact: true });
      await expect(machines).toContainText("Not installed");
      await page.screenshot({ path: `${dir}/machines-${theme}-${width}.png` });
      await page.getByRole("button", { name: "Close skill preview" }).click();

      await page.getByRole("button", { name: "Discover skills", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({ path: `${dir}/discover-${theme}-${width}.png` });
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "New skill", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Skill name" })).toHaveValue("");
      await page.screenshot({ path: `${dir}/new-skill-${theme}-${width}.png` });
      await page.keyboard.press("Escape");
      expect(errors).toEqual([]);
    });
  }
}
