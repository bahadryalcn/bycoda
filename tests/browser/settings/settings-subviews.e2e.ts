import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`direct MCP Hub management: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=mcp&mcp=1&mcpRemote&managedMcp&theme=${theme}`,
      );
      const settings = page.locator("#setting-mcp-servers");
      await settings.getByRole("radio", { name: "Project", exact: true }).click();
      await expect(settings.getByText("Office PC", { exact: true })).toBeVisible();
      await settings.getByRole("button", { name: "Add server", exact: true }).click();
      const add = page.getByRole("dialog", { name: "Add MCP server" });
      await expect(add.getByRole("button", { name: "Provider: bycoda Hub" })).toBeVisible();
      await expect(add.getByRole("button", { name: "Scope: Project" })).toBeVisible();
      await add.getByRole("textbox", { name: "Name", exact: true }).fill("catalog");
      await add
        .getByRole("textbox", { name: "Server URL", exact: true })
        .fill("https://mcp.example.test/server");
      const path = `temp/verification/mcp-hub-management/${theme}-${width}`;
      await page.screenshot({ path: `${path}-add.png` });
      await add.getByRole("button", { name: "Add server", exact: true }).click();
      await settings.getByRole("button", { name: "Open catalog", exact: true }).click();
      const detail = page.getByRole("dialog", { name: "catalog", exact: true });
      await expect(detail.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
      await page.screenshot({ path: `${path}-detail.png` });
      await detail.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Server URL" })).toHaveValue(
        "https://mcp.example.test/server",
      );
      await page
        .getByRole("textbox", { name: "Server URL" })
        .fill("https://mcp.example.test/edited");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      const enabled = detail.getByRole("switch", { name: "Enable catalog in Project" });
      await expect(enabled).toBeChecked();
      await enabled.click();
      await expect(enabled).not.toBeChecked();
      await detail.getByRole("button", { name: "Close" }).click();
      await expect(settings.getByRole("button", { name: "Open catalog" })).toContainText("Off");
      await settings.getByRole("radio", { name: "Global", exact: true }).click();
      await expect(settings.getByRole("button", { name: "Open catalog" })).toHaveCount(0);
    });
  }

for (const theme of ["light", "dark"])
  test(`provider Update all icon uses button text color in ${theme} mode`, async ({ page }) => {
    await page.goto(
      `/tests/browser/settings/settings.html?providersFixture&section=providers&theme=${theme}&lang=en`,
    );
    await page.getByRole("tab", { name: "Providers", exact: true }).click();
    const update = page.getByRole("button", { name: "Update all (1)", exact: true });
    const icon = update.locator("svg");
    await expect(icon).toBeVisible();
    await update.screenshot({ path: `temp/verification/provider-update-icon/${theme}.png` });
    const textColor = await update.evaluate((button) => getComputedStyle(button).color);
    await expect(icon).toHaveCSS("stroke", textColor);
  });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`provider account quota typography ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?providersFixture&providerQuotaFixture&section=providers&theme=${theme}&lang=en`,
      );
      await page
        .getByRole("tablist", { name: "Models", exact: true })
        .getByRole("tab", { name: "Providers", exact: true })
        .click();
      const picker = page.locator(".provider-cli-select").getByRole("button");
      if (await picker.isVisible()) {
        await picker.click();
        await page.getByRole("option", { name: /^Claude Code/ }).click();
      } else {
        await page
          .locator(".provider-cli-selector")
          .getByRole("button", { name: /^Claude Code,/ })
          .click();
      }

      const accounts = page.locator('[data-setting-id="provider-accounts"]:visible');
      const reset = accounts.locator(".provider-account-status").getByText(/^Resets in /);
      const remaining = accounts.getByText("8% left", { exact: true });
      await expect(reset).toBeVisible();
      await expect(remaining).toBeVisible();
      await accounts.screenshot({
        path: `temp/verification/provider-account-quota/${theme}-${width}.png`,
      });
      for (const detail of [reset, remaining]) {
        const row = detail.locator("xpath=ancestor::*[contains(@class, 'provider-account-row')]");
        const name = row.locator(".provider-account-name");
        const fontSize = (node: Element) => parseFloat(getComputedStyle(node).fontSize);
        expect(await detail.evaluate(fontSize)).toBeLessThanOrEqual(await name.evaluate(fontSize));
      }
      await expect(accounts.getByText(/Resets in /)).toHaveCount(1);
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`OpenCode free models ${theme} ${width}`, async ({ page }) => {
      const output = "temp/verification/opencode-free-models";
      mkdirSync(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?providersFixture&openCodePricing&section=providers&theme=${theme}&lang=en`,
      );
      await page
        .getByRole("tablist", { name: "Models", exact: true })
        .getByRole("tab", { name: "Providers", exact: true })
        .click();
      const picker = page.locator(".provider-cli-select").getByRole("button");
      if (await picker.isVisible()) {
        await picker.click();
        await page.getByRole("option", { name: /^OpenCode/ }).click();
      } else {
        await page
          .locator(".provider-cli-selector")
          .getByRole("button", { name: /^OpenCode(?:,|$)/ })
          .click();
      }
      const models = page.locator('[data-setting-id="enabled-models"]');
      const list = models.locator(".provider-models-list");
      await expect(list.getByText("Free", { exact: true })).toHaveCount(2);
      await expect(list.getByText("DeepSeek V4.1 Flash", { exact: true })).toBeVisible();
      await models.screenshot({ path: `${output}/${theme}-${width}.png` });
      const free = page.getByRole("button", { name: "Free", exact: true });
      const paidModel = list.getByRole("switch", { name: "Use DeepSeek V4.1 Flash", exact: true });
      const freeModel = list.getByRole("switch", { name: "Use Big Pickle", exact: true });
      await paidModel.click();
      await freeModel.click();
      await free.click();
      await expect(free).toHaveAttribute("aria-pressed", "true");
      await expect(list.getByText("Big Pickle", { exact: true })).toBeVisible();
      await expect(paidModel).toHaveCount(0);
      const enableFree = page.getByRole("button", { name: "Enable all free", exact: true });
      await expect(enableFree).toBeEnabled();
      await models.screenshot({ path: `${output}/${theme}-${width}-filtered.png` });
      await enableFree.click();
      await expect(freeModel).toBeChecked();
      await expect(enableFree).toBeDisabled();
      await free.click();
      await expect(free).toHaveAttribute("aria-pressed", "false");
      await expect(paidModel).toHaveAttribute("aria-checked", "false");
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`provider defaults scope ${theme} ${width}`, async ({ page }) => {
      mkdirSync("temp/verification/providers-1114/defaults", { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?providersFixture&section=providers&theme=${theme}&lang=en`,
      );
      await expect(page.locator(".settings-page-title")).toHaveText("Accounts and defaults");
      const tabs = page.getByRole("tablist", { name: "Models", exact: true });
      await expect(tabs.getByRole("tab")).toHaveText(["Providers", "Background work", "Defaults"]);
      await tabs.getByRole("tab", { name: "Defaults", exact: true }).click();
      await expect(tabs.getByRole("tab", { name: "Defaults", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(
        page
          .getByRole("tablist", { name: "Settings categories", exact: true })
          .getByRole("tab", { name: "Background work", exact: true }),
      ).toHaveCount(0);
      await expect(
        page
          .getByRole("tablist", { name: "Settings categories", exact: true })
          .getByRole("tab", { name: "Accounts and defaults", exact: true }),
      ).toHaveCount(1);
      // The scope row sits above the defaults it governs: all projects, or one project.
      const scope = page.getByRole("radiogroup", {
        name: "Where these settings apply",
        exact: true,
      });
      const allProjects = scope.getByRole("radio", { name: "All projects", exact: true });
      const oneProject = scope.getByRole("radio", { name: "One project", exact: true });
      await expect(allProjects).toBeChecked();
      await expect(scope).toBeInViewport();
      const capture = async (state: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `temp/verification/providers-1114/defaults/${state}-${theme}-${width}.png`,
        });
      };
      await capture("defaults");
      await oneProject.click();
      // Choosing One project opens the shared project picker.
      const projects = page.getByRole("option");
      await expect(projects.first()).toBeVisible();
      await capture("default-scope");
      await projects.first().click();
      await expect(oneProject).toBeChecked();
      await expect(page.getByRole("button", { name: /^Switch project/ })).toBeVisible();
      await capture("project-scope");
      await allProjects.click();
      await expect(allProjects).toBeChecked();
      await tabs.getByRole("tab", { name: "Providers", exact: true }).click();
      await expect(scope).toHaveCount(0);
      await tabs.getByRole("tab", { name: "Defaults", exact: true }).click();
      await expect(allProjects).toBeChecked();
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`provider settings repair ${theme} ${width}`, async ({ page }) => {
      mkdirSync("temp/verification/providers-1114", { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?providersFixture&section=providers&theme=${theme}&lang=en`,
      );
      const categories = page.getByRole("tablist", { name: "Settings categories", exact: true });
      const providerTabs = page.getByRole("tablist", { name: "Models", exact: true });
      await expect(providerTabs.getByRole("tab")).toHaveCount(3);
      await providerTabs.getByRole("tab", { name: "Providers", exact: true }).click();
      await expect(
        categories.getByRole("tab", { name: "Usage & limits", exact: true }),
      ).toHaveCount(1);
      const chooseCodex = async () => {
        const picker = page.locator(".provider-cli-select").getByRole("button");
        if (await picker.isVisible()) {
          await picker.click();
          await page.getByRole("option", { name: /^Codex/ }).click();
        } else {
          await page
            .locator(".provider-cli-selector")
            .getByRole("button", { name: /^Codex,/ })
            .click();
        }
      };
      await chooseCodex();
      const accounts = page.locator('[data-setting-id="provider-accounts"]');
      await expect(accounts.locator(".provider-account-name:visible").first()).toHaveText(
        "Personal",
      );
      const rail = page.locator(".provider-cli-selector");
      if (await rail.isVisible()) {
        expect(
          (await page.locator(".provider-cli-detail").boundingBox())!.height,
        ).toBeGreaterThanOrEqual((await rail.boundingBox())!.height);
        const row = rail
          .locator(".provider-cli-item")
          .filter({ has: page.getByRole("button", { name: /^Claude Code,/ }) });
        const toggle = row.getByRole("switch");
        const initial = await toggle.isChecked();
        await toggle.hover();
        await expect
          .poll(() => row.evaluate((node) => getComputedStyle(node).backgroundImage))
          .not.toBe("none");
        const outer = await row.boundingBox();
        const control = await toggle.boundingBox();
        expect(control!.x + control!.width).toBeLessThanOrEqual(outer!.x + outer!.width);
        await toggle.click();
        await expect(toggle).toBeChecked({ checked: !initial });
        await expect(rail.getByRole("button", { name: /^Codex,/ })).toHaveAttribute(
          "aria-current",
          "true",
        );
        await toggle.click();
        await expect(toggle).toBeChecked({ checked: initial });
      }
      const capture = async (surface: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `temp/verification/providers-1114/${surface}-${theme}-${width}.png`,
        });
      };
      await capture("accounts");
      await accounts.getByRole("button", { name: "Add account", exact: true }).click();
      const accountDialog = page.getByRole("dialog", { name: "Add account", exact: true });
      const draft = accountDialog.getByRole("textbox", { name: "Account name", exact: true });
      await draft.fill("Retained provider draft");
      // Exercise a programmatic settings navigation while the modal owns pointer and keyboard focus.
      await page
        .locator('[role="tab"]')
        .filter({ hasText: /^Usage & limits$/ })
        .evaluate((tab: HTMLElement) => tab.click());
      await expect(accountDialog).toHaveCount(0);
      await expect(page.locator(".settings-page-title")).toHaveText("Usage & limits");
      await expect(providerTabs).toBeHidden();
      await expect(page.getByRole("heading", { name: "Active time", exact: true })).toBeVisible();
      await capture("usage");
      await page
        .getByRole("tablist", { name: "Usage views", exact: true })
        .getByRole("tab", { name: "Limits", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Provider account limit", exact: true }),
      ).toBeVisible();
      await capture("usage-limits");
      await page.locator("[data-settings-scroller]").evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await capture("usage-bottom");
      await categories.getByRole("tab", { name: "Accounts and defaults", exact: true }).click();
      await expect(draft).toHaveValue("Retained provider draft");
      await accountDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      // Bulk CLI actions and the catalog share the Providers tab; decision models have their own page.
      for (const [tab, surface] of [
        ["CLI", "cli"],
        ["Catalog", "catalog"],
      ]) {
        await page
          .locator(tab === "CLI" ? "#setting-harness-updates" : ".provider-models-list")
          .scrollIntoViewIfNeeded();
        if (tab === "Catalog") {
          await expect(page.getByRole("textbox", { name: "Search models…" })).toBeVisible();
          await expect(page.getByText("GPT-6.1-Sol", { exact: true })).toBeVisible();
          const tailGap = await page.locator(".provider-models-list").evaluate((node) => {
            return (
              node.getBoundingClientRect().bottom -
              node.lastElementChild!.getBoundingClientRect().bottom
            );
          });
          expect(tailGap).toBeLessThanOrEqual(24);
        }
        await capture(surface);
        if (tab === "CLI" && width === 800) {
          await page.locator("[data-settings-scroller]").evaluate((node) => {
            node.scrollTop = node.scrollHeight;
          });
          await capture("cli-bottom");
          await page.locator("[data-settings-scroller]").evaluate((node) => {
            node.scrollTop = 0;
          });
        }
      }
    });

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`Models work limit usage feedback ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      mkdirSync("temp/verification/models-work-limits", { recursive: true });
      for (const state of ["normal", "reached", "unlimited"]) {
        const flags = state === "normal" ? "" : `&${state}`;
        await page.goto(
          `/tests/browser/settings/settings.html?modelLimits&theme=${theme}&lang=en${flags}`,
        );
        const workLimits = page.getByRole("region", { name: "Work limits", exact: true });
        await expect(workLimits.getByText("Used today", { exact: true })).toBeVisible();
        await expect(
          workLimits.getByText(
            state === "reached"
              ? "2h 5m of 2h 0m"
              : state === "unlimited"
                ? "1h 15m"
                : "1h 15m of 2h 0m",
            { exact: true },
          ),
        ).toBeVisible();
        // The reached state is an icon whose name is the label; the row adds no text of its own.
        const reached = workLimits.getByRole("img", { name: "Limit reached", exact: true });
        await expect(reached).toHaveCount(state === "reached" ? 1 : 0);
        if (state === "reached") expect((await reached.boundingBox())!.width).toBeLessThan(40);
        await expect(workLimits.getByRole("meter")).toHaveCount(state === "unlimited" ? 0 : 1);
        await page
          .getByRole("spinbutton", { name: "Daily agent minutes", exact: true })
          .fill("2880");
        await expect(
          workLimits.getByText(
            state === "reached"
              ? "2h 5m of 2h 0m"
              : state === "unlimited"
                ? "1h 15m"
                : "1h 15m of 2h 0m",
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
      await expect(page.getByRole("button", { name: "Restore defaults", exact: true })).toHaveCount(
        0,
      );
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
      await expect(
        chat.getByRole("switch", { name: "Resume at reset", exact: true }),
      ).toBeVisible();
      const helperModels = chat.locator("#setting-helper-models");
      await expect(helperModels).toContainText("Translation, reprompt and title models");
      await expect(helperModels).not.toContainText("Model set in Settings");
      await expect(
        helperModels.getByRole("button", { name: "Manage models", exact: true }),
      ).toBeVisible();
      await expect(chat.locator("#setting-git-generation-default")).toHaveCount(0);
      // Chat width belongs to Appearance, not the Chat page.
      await expect(chat.locator("#setting-chat-width")).toHaveCount(0);
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

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`MCP computer and project credentials: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=mcp&mcp=1&mcpRemote&theme=${theme}`,
      );
      const path = `temp/verification/mcp-machine-management/${theme}-${width}`;
      const settings = page.locator("#setting-mcp-servers");
      await expect(settings.getByRole("button", { name: "Open arc", exact: true })).toBeVisible();
      await settings.getByRole("button", { name: "Computer: This computer" }).click();
      await page.getByRole("option", { name: "Office PC", exact: true }).click();
      await expect(settings.getByRole("button", { name: "Open hostinger" })).toBeVisible();
      await expect(settings.getByRole("button", { name: "Open arc", exact: true })).toHaveCount(0);
      await page.screenshot({ path: `${path}-global.png` });

      await settings.getByRole("button", { name: "Add server", exact: true }).click();
      const add = page.getByRole("dialog", { name: "Add MCP server" });
      await expect(add.getByText("Save on Office PC", { exact: true })).toBeVisible();
      await expect(add.getByRole("textbox", { name: "Server URL" })).toBeVisible();
      await page.screenshot({ path: `${path}-add.png` });
      await add.getByRole("button", { name: "Cancel", exact: true }).click();

      await settings.getByRole("radio", { name: "Project", exact: true }).click();
      await expect(settings.getByText("Office PC", { exact: true })).toBeVisible();
      await page.screenshot({ path: `${path}-project.png` });
      await settings.getByRole("button", { name: "Open hostinger" }).click();
      const detail = page.getByRole("dialog", { name: "hostinger", exact: true });
      await expect(detail.getByText(/Office PC · storefront/)).toBeVisible();
      await expect(detail.getByText("Edit provider JSON")).toBeVisible();
      await expect(detail.getByRole("button", { name: "Show in folder" })).toHaveCount(0);
      await page.screenshot({ path: `${path}-detail.png` });

      await detail.getByRole("button", { name: "Set credentials", exact: true }).click();
      const credential = page.getByRole("dialog", { name: "Set project credentials" });
      await expect(credential.getByLabel("Header name")).toHaveValue("Authorization");
      await expect(credential.getByLabel("Secret value")).toHaveAttribute("type", "password");
      await page.screenshot({ path: `${path}-credentials.png` });
      await credential.getByLabel("Secret value").fill("Bearer synthetic-test-token");
      await credential.getByRole("button", { name: "Save credentials", exact: true }).click();
      await expect(credential).toHaveCount(0);
      await expect(detail.getByRole("button", { name: "Manage credentials" })).toBeVisible();
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
        // Dark-mode depth is a slider in the Tone group of the Theme tab, present only in dark.
        const brightness = page.locator('[data-setting-id="dark-lightness"]').getByRole("slider");
        if (theme === "light") await expect(brightness).toHaveCount(0);
        else await expect(brightness).toBeVisible();
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
        // Models is tabbed; accounts and CLI choices live under the Providers tab.
        await page.getByRole("tab", { name: labels.providersTab, exact: true }).click();
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
          const form = page.getByRole("dialog", { name: labels.account, exact: true });
          await expect(form).toBeVisible();
          const accountName = form.getByRole("textbox");
          await expect(accountName).toBeFocused();
          await accountName.fill("A very long review account name for layout checks");
          expect(await form.evaluate((node) => node.scrollWidth <= node.clientWidth + 2)).toBe(
            true,
          );
          await page.screenshot({ path: `${prefix}-account-${index}.png` });
          await form.getByRole("button", { name: labels.cancel, exact: true }).click();
          await expect(form).toHaveCount(0);
        }
        const skillLabels = await open("skills");
        // Creation actions live in the toolbar's New menu.
        const addSkill = page.getByRole("button", { name: skillLabels.newMenu, exact: true });
        await addSkill.click();
        await page.getByRole("menuitem", { name: skillLabels.skill, exact: true }).click();
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
      const list = connections.getByRole("region", { name: "MCP servers", exact: true });
      // One row per connection; each row opens its detail sheet through exactly one button.
      const details = list.locator("[data-collection-key]:has(button[aria-label^='Open '])");
      // The continuous list renders every loaded connection below its window threshold,
      // without a "Show more connections" continuation or a range status.
      await expect(details).toHaveCount(25);
      await expect(
        connections.getByRole("button", { name: "Show more connections", exact: true }),
      ).toHaveCount(0);
      for (const row of await details.all())
        await expect(row.locator("button[aria-label^='Open ']")).toHaveCount(1);
      await page.screenshot({
        path: `temp/verification/2026-10-16-ui-system/W5a-SETTINGS-mcp-${theme}-${width}.png`,
      });
      const scroller = page.locator("[data-settings-scroller]");
      await connections.getByRole("searchbox", { name: "Search MCP servers" }).fill("server-24");
      await expect(details).toHaveCount(1);
      // Rows do not expand inline: the config path stays searchable and the row opens a detail
      // sheet with its configuration (Show in folder / Copy config path).
      await connections
        .getByRole("searchbox", { name: "Search MCP servers" })
        .fill("config-24.json");
      await expect(details).toHaveCount(1);
      await expect(details).toContainText("server-24");
      await details.getByRole("button", { name: "Open server-24", exact: true }).click();
      const detail = page.getByRole("dialog", { name: "server-24", exact: true });
      await expect(
        detail.getByRole("button", { name: "Show in folder", exact: true }),
      ).toBeEnabled();
      await expect(
        detail.getByRole("button", { name: "Copy config path", exact: true }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(detail).toHaveCount(0);
      expect(await scroller.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
        true,
      );
      await connections.getByRole("searchbox").fill("missing-server");
      await expect(connections.getByText("No MCP servers match your search.")).toBeVisible();
      await connections.getByRole("searchbox").fill("");
      const filters = connections.getByRole("button", { name: "Filters", exact: true });
      await filters.click();
      const filterDialog = page.getByRole("dialog", { name: "Filter MCP servers", exact: true });
      await filterDialog.getByRole("button", { name: /^Codex/ }).click();
      await page.keyboard.press("Escape");
      await expect(filters).toBeFocused();
      await expect(details).toHaveCount(12);
      await expect(connections.getByRole("status")).toHaveCount(0);
      mkdirSync("temp/verification/2026-10-15-mcp", { recursive: true });
      await page.screenshot({ path: `temp/verification/2026-10-15-mcp/${theme}-${width}.png` });
    });
  }
