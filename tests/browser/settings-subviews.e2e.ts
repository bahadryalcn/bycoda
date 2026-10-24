import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 1024, 1440]) {
    test(`compact chat settings: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings.html?section=chat&theme=${theme}&lang=en`);
      const chat = page.locator(".chat-settings");
      await expect(chat.getByText("Changes save automatically", { exact: true })).toHaveCount(1);
      await expect(chat.getByRole("button", { name: "Save templates", exact: true })).toHaveCount(
        0,
      );
      const anchor = chat.getByRole("switch", { name: "Anchor prompts to top", exact: true });
      const wasChecked = await anchor.isChecked();
      await anchor.focus();
      await page.keyboard.press("Space");
      await expect(anchor).toBeChecked({ checked: !wasChecked });
      await page.reload();
      await expect(anchor).toBeChecked({ checked: !wasChecked });
      await expect(chat.locator("details, summary")).toHaveCount(0);
      await expect(
        chat.getByRole("switch", { name: "Resume at reset", exact: true }),
      ).toBeVisible();
      await expect(chat.locator("#setting-translation-model-default button").first()).toBeVisible();
      await expect(chat.locator("#setting-git-generation-default")).toHaveCount(0);
      await expect(chat.locator("#setting-chat-width button").first()).toBeVisible();
      const overflow = await chat.evaluate((root) =>
        [...root.querySelectorAll(".settings-row, .settings-group-heading, .settings-row-control")]
          .filter((node) => node.scrollWidth > node.clientWidth + 1)
          .map((node) => node.className),
      );
      expect(overflow).toEqual([]);
      mkdirSync("temp/verification/2026-10-18-chat-settings", { recursive: true });
      await page.locator("[data-settings-scroller]").evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({
        path: `temp/verification/2026-10-18-chat-settings/${theme}-${width}.png`,
      });
      await chat.getByRole("button", { name: "Add template", exact: true }).click();
      await expect(chat.getByRole("textbox", { name: "Template name", exact: true })).toBeVisible();
      await expect(chat.getByRole("button", { name: "Save templates", exact: true })).toBeEnabled();
    });
  }

for (const lang of ["en", "tr", "de", "fr", "es", "pt", "zh-CN", "ja"]) {
  for (const theme of ["light", "dark"])
    for (const width of [390, 1440]) {
      test(`account, skill and archive subviews: ${lang} ${theme} ${width}`, async ({ page }) => {
        mkdirSync("temp/verification/settings-integrated/subviews", { recursive: true });
        const prefix = `temp/verification/settings-integrated/subviews/${lang}-${theme}-${width}`;
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const open = async (section: string) => {
          await page.goto(
            `/tests/browser/settings.html?lang=${lang}&theme=${theme}&section=${section}`,
          );
          await expect(page.locator("main")).toHaveAttribute("data-fixture-labels", /account/);
          return JSON.parse(
            (await page.locator("main").getAttribute("data-fixture-labels"))!,
          ) as Record<string, string>;
        };
        const themeLabels = await open("appearance");
        await expect(page.locator("html")).toHaveClass(
          theme === "light" ? /theme-light/ : /^(?!.*theme-light)/,
        );
        await expect(
          page.getByRole("button", { name: themeLabels.theme, exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("details.settings-advanced")).toHaveCount(0);
        const brightness = page.locator('[data-setting-id="dark-lightness"]').getByRole("slider");
        if (theme === "light") await expect(brightness).toHaveAttribute("aria-disabled", "true");
        else await expect(brightness).not.toHaveAttribute("aria-disabled", "true");
        await page.screenshot({ path: `${prefix}-appearance-theme.png` });
        const scroller = page.locator("[data-settings-scroller]");
        const dimensions = await scroller.evaluate((node) => ({
          height: node.clientHeight,
          total: node.scrollHeight,
        }));
        for (
          let top = 0, frame = 0;
          top < dimensions.total;
          top += Math.max(1, dimensions.height - 80), frame++
        ) {
          await scroller.evaluate((node, top) => {
            node.scrollTop = top;
          }, top);
          await page.screenshot({
            path: `temp/verification/settings-integrated/screens/${lang}-${theme}-${width}-appearance-${frame}.png`,
          });
        }
        const labels = await open("providers");
        const accounts = page.locator('[data-setting-id="provider-accounts"]');
        const add = accounts.getByRole("button", { name: labels.account, exact: true });
        for (const [index, provider] of ["Claude Code", "Codex"].entries()) {
          const providerSearch = page.locator(".provider-cli-select").getByRole("button");
          if (await providerSearch.isVisible()) {
            await providerSearch.click();
            await page.getByRole("option", { name: new RegExp(`^${provider}`) }).click();
          } else {
            await page.getByRole("button", { name: new RegExp(`^${provider},`) }).click();
          }
          await add.click();
          const form = accounts.locator("form");
          await expect(form).toBeVisible();
          await expect(form.locator("input")).toBeFocused();
          await form.locator("input").fill("A very long review account name for layout checks");
          expect(await form.evaluate((node) => node.scrollWidth <= node.clientWidth + 2)).toBe(
            true,
          );
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
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.getByRole("button", { name: skillLabels.cancel, exact: true }).click();
        await expect(name).toHaveCount(0);
        await expect(addSkill).toBeFocused();

        await page.addInitScript(() =>
          localStorage.setItem(
            "bycoda.archivedProjects",
            JSON.stringify([
              { path: "/fixture/long-archived-project-name-for-settings-review", archivedAt: 1 },
            ]),
          ),
        );
        const archiveLabels = await open("archive");
        const remove = page
          .locator('[data-setting-id="archived-projects"]')
          .getByRole("button", { name: archiveLabels.delete, exact: true });
        await remove.click();
        const confirmation = page.getByRole("dialog");
        await expect(confirmation).toBeVisible();
        await expect(
          confirmation.getByRole("button", { name: archiveLabels.cancel, exact: true }),
        ).toBeFocused();
        await expect(page.locator("main")).toHaveAttribute("data-fixture-deletions", "0");
        expect(
          await confirmation.evaluate((node) => node.scrollWidth <= node.clientWidth + 2),
        ).toBe(true);
        await page.screenshot({ path: `${prefix}-archive-confirmation.png` });
        await page.keyboard.press("Escape");
        await expect(confirmation).toHaveCount(0);
        await expect(page.locator("main")).toHaveAttribute("data-fixture-deletions", "0");
        expect(
          await page.evaluate(
            () => JSON.parse(localStorage.getItem("bycoda.archivedProjects")!).length,
          ),
        ).toBe(1);
        expect(errors).toEqual([]);
      });
    }
}

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 1024, 1440]) {
    test(`compact MCP connections: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings.html?section=mcp&mcp=1&theme=${theme}`);
      const connections = page.locator("#setting-mcp-servers");
      const details = connections.locator("section:has(> h3[aria-label])");
      await expect(details).toHaveCount(8);
      await expect(connections.getByRole("status")).toHaveText("1–8 of 25 connections");
      await page.screenshot({
        path: `temp/verification/2026-10-16-ui-system/W5a-SETTINGS-mcp-${theme}-${width}.png`,
      });
      const scroller = page.locator("[data-settings-scroller]");
      await connections.getByRole("button", { name: "Next", exact: true }).click();
      await expect(connections.getByRole("status")).toHaveText("9–16 of 25 connections");
      await connections.getByRole("searchbox", { name: "Search MCP servers" }).fill("server-24");
      await expect(details).toHaveCount(1);
      await expect(connections.getByRole("status")).toHaveText("1–1 of 1 connections");
      await expect(details.getByText(/config-24.json/)).toBeVisible();
      expect(await scroller.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
        true,
      );
      await connections.getByRole("searchbox").fill("missing-server");
      await expect(connections.getByText("No MCP servers match your search.")).toBeVisible();
      await connections.getByRole("searchbox").fill("");
      const filters = connections.getByRole("button", { name: "Filters", exact: true });
      await filters.click();
      const filterDialog = page.getByRole("dialog", { name: "Filter MCP servers by provider" });
      await filterDialog.getByRole("button", { name: /^Codex/ }).click();
      await page.keyboard.press("Escape");
      await expect(filters).toBeFocused();
      await expect(connections.getByRole("status")).toHaveText("1–8 of 12 connections");
      mkdirSync("temp/verification/2026-10-15-mcp", { recursive: true });
      await page.screenshot({ path: `temp/verification/2026-10-15-mcp/${theme}-${width}.png` });
    });
  }
