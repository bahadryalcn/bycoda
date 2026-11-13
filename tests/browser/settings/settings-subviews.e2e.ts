import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`Models work limit usage feedback ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      mkdirSync("temp/verification/models-work-limits", { recursive: true });
      for (const state of ["normal", "reached", "uncertain", "unlimited"]) {
        const flags =
          state === "normal" ? "" : state === "unlimited" ? "&unlimited&uncertain" : `&${state}`;
        await page.goto(
          `/tests/browser/settings/settings.html?modelLimits&theme=${theme}&lang=en${flags}`,
        );
        await expect(
          page.getByText(
            state === "reached"
              ? "Used today: 2h 5m of 2h 0m"
              : state === "unlimited"
                ? "Used today: 1h 15m"
                : "Used today: 1h 15m of 2h 0m",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(page.getByText("Limit reached", { exact: true })).toHaveCount(
          state === "reached" ? 1 : 0,
        );
        if (state === "reached")
          expect(
            (await page.getByText("Limit reached", { exact: true }).boundingBox())!.width,
          ).toBeLessThan(200);
        await expect(page.getByRole("meter")).toHaveCount(
          state === "normal" || state === "reached" ? 1 : 0,
        );
        if (state === "uncertain" || state === "unlimited")
          await expect(
            page.getByText(
              state === "uncertain"
                ? "Today's agent time is incomplete. New work waits until tomorrow while a daily limit is set."
                : "Today's agent time is incomplete.",
              { exact: true },
            ),
          ).toBeVisible();
        await page
          .getByRole("spinbutton", { name: "Daily agent minutes", exact: true })
          .fill("2880");
        await expect(
          page.getByText(
            state === "reached"
              ? "Used today: 2h 5m of 2h 0m"
              : state === "unlimited"
                ? "Used today: 1h 15m"
                : "Used today: 1h 15m of 2h 0m",
            { exact: true },
          ),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `temp/verification/models-work-limits/${state}-${theme}-${width}.png`,
        });
      }
    });

// Real template controls with memory-only settings persistence.
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`template save feedback ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings/settings.html?section=chat&theme=${theme}&lang=en`);
      await page.getByRole("button", { name: "Add template", exact: true }).click();
      await page.getByRole("textbox", { name: "Template name", exact: true }).fill("Review code");
      const text = page.getByRole("textbox", { name: "Template text", exact: true });
      await text.fill("Find bugs and explain their impact.");
      await page.getByRole("button", { name: "Save templates", exact: true }).click();
      const saved = page.getByRole("button", { name: "Saved", exact: true });
      await expect(saved).toBeVisible();
      await expect(saved).toBeDisabled();
      await saved.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      mkdirSync("temp/verification/action-feedback", { recursive: true });
      await page.screenshot({
        path: `temp/verification/action-feedback/templates-saved-${theme}-${width}.png`,
      });
      await text.fill("Unsaved revision");
      await expect(page.getByRole("button", { name: "Save templates", exact: true })).toBeEnabled();
      await expect(saved).toHaveCount(0);
    });

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 1024, 1440]) {
    test(`compact chat settings: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings/settings.html?section=chat&theme=${theme}&lang=en`);
      const chat = page.locator(".chat-settings");
      await page.getByRole("button", { name: "About this page", exact: true }).click();
      await expect(page.getByText("Changes save automatically", { exact: true })).toHaveCount(1);
      await page.keyboard.press("Escape");
      // With no templates the group shows only its empty row; Save appears once there is an edit.
      await expect(chat.getByText("No templates yet", { exact: true })).toBeVisible();
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
      // Rarely changed conversation options stay behind their explicit toggle.
      const advanced = chat.getByRole("button", {
        name: "Advanced conversation settings",
        exact: true,
      });
      await expect(advanced).toHaveAttribute("aria-expanded", "false");
      await advanced.click();
      await expect(advanced).toHaveAttribute("aria-expanded", "true");
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
            `/tests/browser/settings/settings.html?lang=${lang}&theme=${theme}&section=${section}`,
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
        // The scheme is a segmented radio group (System / Light / Dark), not three buttons.
        await expect(
          page.getByRole("radio", { name: themeLabels.theme, exact: true }),
        ).toBeChecked();
        await expect(page.locator("details.settings-advanced")).toHaveCount(0);
        // Dark-mode depth is an always-visible slider in the Tone group of the Theme tab.
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
        // "New skill" opens a small dialog over the library; Cancel closes it and returns focus.
        await page
          .getByRole("dialog", { name: skillLabels.skill, exact: true })
          .getByRole("button", { name: skillLabels.cancel, exact: true })
          .click();
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
      await page.goto(`/tests/browser/settings/settings.html?section=mcp&mcp=1&theme=${theme}`);
      const connections = page.locator("#setting-mcp-servers");
      const list = connections.getByRole("region", { name: "MCP connections", exact: true });
      // One row per connection; each row owns exactly one actions menu button.
      const details = list.locator("[data-collection-key]:has(button[aria-haspopup='menu'])");
      // The continuous list renders every loaded connection below its window threshold,
      // without a "Show more connections" continuation or a range status.
      await expect(details).toHaveCount(25);
      await expect(
        connections.getByRole("button", { name: "Show more connections", exact: true }),
      ).toHaveCount(0);
      for (const row of await details.all())
        await expect(row.locator("button[aria-haspopup='menu']")).toHaveCount(1);
      await page.screenshot({
        path: `temp/verification/2026-10-16-ui-system/W5a-SETTINGS-mcp-${theme}-${width}.png`,
      });
      const scroller = page.locator("[data-settings-scroller]");
      await connections.getByRole("searchbox", { name: "Search MCP servers" }).fill("server-24");
      await expect(details).toHaveCount(1);
      // Rows no longer expand inline: the config path stays searchable and is reached from the
      // row's actions menu (Show config / Copy config path).
      await connections
        .getByRole("searchbox", { name: "Search MCP servers" })
        .fill("config-24.json");
      await expect(details).toHaveCount(1);
      await expect(details).toContainText("server-24");
      await details.getByRole("button", { name: "Actions for server-24", exact: true }).click();
      const actions = page.getByRole("menu", { name: "Actions for server-24", exact: true });
      await expect(
        actions.getByRole("menuitem", { name: "Show config", exact: true }),
      ).toBeEnabled();
      await expect(
        actions.getByRole("menuitem", { name: "Copy config path", exact: true }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(actions).toHaveCount(0);
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
      await expect(details).toHaveCount(12);
      await expect(connections.getByRole("status")).toHaveCount(0);
      mkdirSync("temp/verification/2026-10-15-mcp", { recursive: true });
      await page.screenshot({ path: `temp/verification/2026-10-15-mcp/${theme}-${width}.png` });
    });
  }
