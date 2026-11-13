import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["dark", "light"]) {
  for (const width of [390, 800, 1280]) {
    test(`skill grouping toolbar ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=skills&skills=1&theme=${theme}&lang=en`,
      );
      const grouping = page.getByRole("button", { name: "Group with AI", exact: true });
      const create = page.getByRole("button", { name: "New group", exact: true });
      const settings = page.getByRole("button", { name: "Manage in Models", exact: true });
      await expect(grouping).toBeVisible();
      await expect(settings).toBeVisible();
      await expect(page.getByText(/Model set in Settings/)).toHaveCount(0);
      const boxes = await Promise.all(
        [create, grouping, settings].map((button) => button.boundingBox()),
      );
      expect(new Set(boxes.map((box) => Math.round(box!.y))).size).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      mkdirSync("temp/verification/2026-11-13-skill-grouping", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-11-13-skill-grouping/toolbar-${theme}-${width}.png`,
      });
      // This SettingsView fixture has no workspace navigation owner. Verify its
      // public navigation request without pretending to exercise the app shell.
      await page.evaluate(() => {
        window.addEventListener(
          "bycoda:open-models-settings",
          (event) => {
            document.documentElement.dataset.requestedModelsTab = (
              event as CustomEvent<string>
            ).detail;
          },
          { once: true },
        );
      });
      await settings.click();
      await expect(page.locator("html")).toHaveAttribute("data-requested-models-tab", "roles");
    });
  }
}

for (const theme of ["dark", "light"]) {
  for (const width of [800, 1280]) {
    test(`skill folder search reveal ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=general&skills=1&theme=${theme}&lang=en`,
      );
      const reveal = async () => {
        await page.getByRole("button", { name: "Search settings", exact: true }).click();
        await page
          .getByRole("combobox", { name: "Search settings", exact: true })
          .fill("Skill folders");
        await page.getByRole("option").first().click();
      };
      await reveal();
      const folders = page.locator('[role="dialog"] [data-setting-id="skill-folders"]');
      await expect(folders).toBeVisible();
      await page.screenshot({
        path: `temp/verification/component-families/skill-search-${theme}-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(folders).toHaveCount(0);
      await reveal();
      await expect(folders).toBeVisible();
    });
  }
}

for (const theme of ["dark", "light"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`skills workspace ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=skills&skills=1&theme=${theme}`,
      );
      await page.getByRole("button", { name: "arc", exact: true }).click();
      const editor = page.getByRole("textbox", { name: "Skill instructions", exact: true });
      await expect(editor).toBeVisible();
      await editor.fill("---\nname: arc\n---\n\n# Edited instructions\n");
      await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
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

// Production skill editor, memory-only filesystem/Host fixture ports.
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`skill save feedback ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=skills&skills=1&theme=${theme}`,
      );
      await page.getByRole("button", { name: "arc", exact: true }).click();
      const editor = page.getByRole("textbox", { name: "Skill instructions", exact: true });
      await expect(editor).toBeVisible();
      await editor.fill("---\nname: arc\n---\n\n# Updated instructions\n");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const saved = page.getByRole("button", { name: "Saved", exact: true });
      await expect(saved).toBeVisible();
      await expect(saved).toBeDisabled();
      await expect(page.getByText("Skill saved.", { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("complementary", { name: "Skill preview" }).locator("footer"),
      ).not.toContainText("Saved");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      mkdirSync("temp/verification/action-feedback", { recursive: true });
      await page.screenshot({
        path: `temp/verification/action-feedback/skills-saved-${theme}-${width}.png`,
      });
      await editor.fill("---\nname: arc\n---\n\n# Further edit\n");
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      await expect(saved).toHaveCount(0);
    });

for (const theme of ["dark", "light"]) {
  for (const width of [800, 1280]) {
    test(`skills library across machines ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 860 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=skills&skills=1&machines=1&theme=${theme}`,
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
for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`shared collection presentation ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const dir = "temp/verification/component-inventory-skills";
      mkdirSync(dir, { recursive: true });
      for (const section of ["terminal", "notifications"]) {
        await page.goto(
          `/tests/browser/settings/settings.html?section=${section}&${section}=1&theme=${theme}`,
        );
        const collection = page.locator(".settings-collection").first();
        await expect(collection).toHaveAttribute("data-surface-variant", "card");
        const row = collection.locator("[data-action-host]").first();
        await expect(row).toBeVisible();
        await row.scrollIntoViewIfNeeded();
        await row.hover();
        expect(await row.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
          "linear-gradient",
        );
        const button = row.getByRole("button").first();
        await button.focus();
        await expect(button).toBeFocused();
        await page.screenshot({ path: `${dir}/${section}-${theme}-${width}.png` });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
      await page.goto(
        `/tests/browser/settings/settings.html?section=skills&skills=1&machines=1&theme=${theme}`,
      );
      const skill = page.getByRole("button", { name: "remote-notes", exact: true });
      const row = skill.locator("xpath=ancestor::*[@data-action-host][1]");
      await expect(row).toHaveCount(1);
      await skill.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(skill).toBeFocused();
      expect(await skill.evaluate((el) => getComputedStyle(el).outlineWidth)).not.toBe("0px");
      const action = row.getByRole("button", { name: "Actions for remote-notes", exact: true });
      await expect(action).toHaveCSS("opacity", "1");
      await row.hover();
      await page.screenshot({ path: `${dir}/skill-row-${theme}-${width}.png` });
      await skill.click();
      // At 800px the preview replaces the visible library; its retained row remains selected.
      await expect(
        page.locator('[data-action-host][data-selected="true"]').filter({
          has: page.locator('button[aria-label="remote-notes"]'),
        }),
      ).toHaveCount(1);
    });
  }
