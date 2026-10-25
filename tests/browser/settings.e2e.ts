import { test, expect } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1440]) {
    test(`terminal typography settings: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings.html?section=appearance&theme=${theme}&lang=tr`);
      const font = page.getByRole("textbox", { name: "Terminal yazı tipi", exact: true });
      await font.fill("JetBrains Mono");
      const size = page.getByRole("slider", { name: "Terminal yazı boyutu", exact: true });
      await size.focus();
      await size.press("ArrowRight");
      await expect(size).toHaveAttribute("aria-valuenow", "14");
      await page.locator('[data-setting-id="terminal-font-weight"] button').click();
      await page.getByRole("option", { name: "Yarı kalın", exact: true }).click();
      await page.locator('[data-setting-id="terminal-line-height"] button').click();
      await page.getByRole("option", { name: "1.35×", exact: true }).click();
      const saved = () =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("bycoda.appearancePreferences.v1") ?? "{}"),
        );
      await expect.poll(saved).toMatchObject({
        terminalFont: "JetBrains Mono",
        terminalSize: 14,
        terminalWeight: 600,
        terminalLineHeight: 1.35,
        codeSize: 13,
      });
      await page.reload();
      await expect(font).toHaveValue("JetBrains Mono");
      await expect(size).toHaveAttribute("aria-valuenow", "14");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });
  }
}
import { mkdirSync } from "node:fs";

for (const theme of ["dark", "light"]) {
  test(`code theme follows appearance and persists: ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/settings.html?section=appearance&theme=${theme}&lang=tr`);
    const row = page.locator('[data-setting-id="code-theme"]');
    const trigger = row.locator('button[aria-haspopup="listbox"]');
    await trigger.scrollIntoViewIfNeeded();
    await trigger.focus();
    await trigger.press("Enter");
    await page.getByRole("option", { name: "Dracula", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-code-theme", "dracula");
    const keyword = page.locator(".appearance-code-keyword").first();
    await expect(keyword).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(255, 121, 198)" : "rgb(207, 34, 46)",
    );
    await page.reload();
    await expect(trigger).toContainText("Dracula");
    await expect(page.locator("html")).toHaveAttribute("data-code-theme", "dracula");
    await trigger.scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    mkdirSync("temp/verification/2026-10-19-code-themes", { recursive: true });
    await row.screenshot({
      path: `temp/verification/2026-10-19-code-themes/${theme}-theme-control.png`,
    });
  });
}

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 1024, 1440]) {
    test(`general settings dependencies and language choices: ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings.html?section=general&theme=${theme}&lang=en`);
      const general = page.locator(".general-settings");
      const awake = general.getByRole("switch", {
        name: "Prevent sleep while agents work",
        exact: true,
      });
      const screen = general.getByRole("switch", { name: "Keep the screen on", exact: true });
      const duration = general
        .locator('[data-setting-id="keep-awake-duration"]')
        .getByRole("combobox");
      await expect(screen).toBeDisabled();
      await expect(duration).toBeDisabled();
      await awake.focus();
      await page.keyboard.press("Space");
      await expect(screen).toBeEnabled();
      await screen.click();
      await duration.click();
      await page.getByRole("option", { name: "15 minutes", exact: true }).click();
      await awake.click();
      await expect(screen).toBeDisabled();
      await page.reload();
      await expect(screen).toBeChecked();
      await expect(screen).toBeDisabled();
      await awake.click();
      await expect(duration).toContainText("15 minutes");
      await expect(screen).toBeChecked();
      const language = general.locator(
        '[data-setting-id="git-language"] button[aria-haspopup="listbox"]',
      );
      await language.focus();
      await language.press("Enter");
      await page.getByRole("option", { name: "English", exact: true }).click();
      await expect(language).toContainText("English");
      await expect(general.locator('[data-setting-id="technical-language"]')).toContainText(
        "Follow application language",
      );
      await expect(general.getByText("Changes save automatically", { exact: true })).toHaveCount(1);
      await expect(general.locator(".general-detail")).toBeVisible();
      const overflows = await general.evaluate((root) =>
        [
          ...root.querySelectorAll(
            ".settings-row, .settings-group-heading, .general-update-actions",
          ),
        ]
          .filter((node) => node.scrollWidth > node.clientWidth + 1)
          .map((node) => node.className),
      );
      expect(overflows).toEqual([]);
      mkdirSync("temp/verification/2026-10-18-general-settings", { recursive: true });
      await page.locator("[data-settings-scroller]").evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({
        path: `temp/verification/2026-10-18-general-settings/${theme}-${width}-top.png`,
      });
      await general.locator('[data-setting-id="update"]').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/2026-10-18-general-settings/${theme}-${width}-bottom.png`,
      });
    });
  }

test("appearance topics stay visible and support search into nested controls", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/settings.html?section=appearance&theme=dark&lang=en");
  const topics = page.locator(".appearance-settings > .appearance-section");
  await expect(topics).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath("appearance-overview-dark.png") });
  await expect(page.locator(".appearance-save-note")).toHaveText("Changes save automatically");
  await expect(page.locator('[data-setting-id="code-font-size"]')).toBeVisible();
  await expect(
    page.locator(".appearance-settings details, .appearance-settings summary"),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Search settings", exact: true })
    .fill("Dark-mode lightness");
  await page.getByRole("option").filter({ hasText: "Dark-mode lightness" }).click();
  await expect(page.locator('[data-setting-id="dark-lightness"]')).toBeVisible();

  // Expanded content must stay contained at intermediate and narrow widths too.
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page
        .locator(".appearance-settings")
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("appearance-expanded.png") });
  await page.goto("/tests/browser/settings.html?section=appearance&theme=light&lang=tr");
  await expect(page.locator(".appearance-settings > .appearance-section")).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath("appearance-overview-light-tr.png") });
});

test("control density persists shared control targets and resets without changing fonts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("bycoda.appearancePreferences.v1"))
      localStorage.setItem(
        "bycoda.appearancePreferences.v1",
        JSON.stringify({ interfaceFont: "Verdana", codeSize: 15 }),
      );
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/tests/browser/settings.html?section=appearance&theme=light&lang=en");
  const row = page.locator('[data-setting-id="control-density"]');
  const trigger = row.getByRole("button", { name: /^Control density:/ });
  await expect(trigger).toHaveAccessibleName("Control density: Compact");
  await trigger.click();
  await page.getByRole("option", { name: "Touch", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-control-density", "touch");
  expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.reload();
  await expect(trigger).toHaveAccessibleName("Control density: Touch");
  await expect(page.locator("html")).toHaveAttribute("data-control-density", "touch");
  await page.getByRole("button", { name: "Reset reading settings", exact: true }).click();
  await expect(trigger).toHaveAccessibleName("Control density: Compact");
  await expect(page.locator("html")).toHaveAttribute("data-control-density", "compact");
  expect((await trigger.boundingBox())!.height).toBeLessThan(44);
  expect(
    await page
      .locator("html")
      .evaluate((node) => (node as HTMLElement).style.getPropertyValue("--font-sans")),
  ).toBe('"Verdana", sans-serif');
});

test("elastic appearance adjustments retain bounds, persistence and light-mode gates", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/settings.html?section=appearance&theme=dark&lang=en");
  await page.getByRole("button", { name: /^Olive/ }).click();
  await expect(page.locator("details.settings-advanced")).toHaveCount(0);
  const opacity = page
    .locator('[data-setting-id="sidebar-opacity"]')
    .getByRole("slider", { name: "Sidebar opacity", exact: true });
  await opacity.press("Home");
  await opacity.press("End");
  await expect(opacity).toHaveAttribute("aria-valuenow", "100");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("bycoda.sidebarOpacity")))
    .toBe("1");
  await opacity.press("ArrowLeft");
  await expect(opacity).toHaveAttribute("aria-valuetext", "99%");
  await page.screenshot({
    path: "temp/verification/2026-10-16-ui-system/W5a-SETTINGS-elastic-custom-dark.png",
  });
  await page.reload();
  await expect(page.locator("details.settings-advanced")).toHaveCount(0);
  await expect(opacity).toHaveAttribute("aria-valuenow", "99");
  const blur = page
    .locator('[data-setting-id="blur"]')
    .getByRole("slider", { name: "Blur radius", exact: true });
  await blur.press("Home");
  await expect(blur).toHaveAttribute(
    "aria-valuenow",
    (await blur.getAttribute("aria-valuemin")) ?? "",
  );
  await page.goto("/tests/browser/settings.html?section=appearance&theme=light&lang=en");
  await expect(page.locator("details.settings-advanced")).toHaveCount(0);
  await expect(opacity).toHaveAttribute("aria-disabled", "true");
  await expect(blur).toHaveAttribute("aria-disabled", "true");
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const sections = [
  "general",
  "appearance",
  "notifications",
  "keybindings",
  "workspace",
  "terminal",
  "chat",
  "providers",
  "usage",
  "mcp",
  "skills",
  "inbox",
  "worktrees",
  "groupLock",
  "archive",
  "connections",
  "policies",
];

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 1024, 1440]) {
    test(`keybindings recording and filters: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/settings.html?section=keybindings&theme=${theme}&lang=en`);
      const search = page.getByRole("searchbox", { name: "Filter keybindings", exact: true });
      const geometry = await page
        .locator('[data-settings-section="keybindings"]')
        .evaluate((form) => {
          const style = getComputedStyle(form);
          return {
            available:
              form.clientWidth -
              parseFloat(style.paddingInlineStart) -
              parseFloat(style.paddingInlineEnd),
            content: form.querySelector(".settings-group")!.getBoundingClientRect().width,
          };
        });
      expect(geometry.content).toBeGreaterThan(geometry.available * 0.98);
      await search.fill("Open Inbox");
      const recorder = page.getByRole("button", {
        name: "Change App: Open Inbox shortcut",
        exact: true,
      });
      await expect(recorder).toBeVisible();
      await recorder.click();
      await page.keyboard.press("Control+Alt+q");
      await expect(recorder).toContainText("Q");
      await expect(page.getByText("Modified", { exact: true })).toBeVisible();
      await expect(page.getByText(/^Default:/)).toBeVisible();
      const feedback = page
        .locator(".settings-row")
        .filter({ has: recorder })
        .locator(".settings-row-feedback");
      await expect(feedback.getByRole("status")).toContainText("Saved");
      expect(
        await feedback.evaluate((node) => node.clientWidth / node.parentElement!.clientWidth),
      ).toBeGreaterThan(0.85);
      await page.reload();
      await search.fill("Open Inbox");
      await expect(recorder).toContainText("Q");
      await recorder.click();
      await page.keyboard.press("Escape");
      await expect(recorder).toContainText("Q");
      await recorder.click();
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("alert")).toContainText("Already used");
      await expect(recorder).toContainText("Q");
      await recorder.click();
      await page.keyboard.press("Delete");
      await expect(recorder).toContainText("Disabled");
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      const filters = page.getByRole("dialog", { name: "Filters", exact: true });
      await filters.getByRole("button", { name: "Status: All bindings", exact: true }).click();
      await page.getByRole("option", { name: "Disabled", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(recorder).toBeVisible();
      await page
        .getByRole("button", { name: "Reset App: Open Inbox shortcut", exact: true })
        .click();
      await expect(page.getByText("No matching bindings", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Reset filters", exact: true }).click();
      await expect(recorder).toBeVisible();
      await expect(recorder).toContainText("I");
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await filters.getByRole("button", { name: "Category: All categories", exact: true }).click();
      await page.getByRole("option", { name: "Pane", exact: true }).click();
      await filters.getByRole("button", { name: "Status: All bindings", exact: true }).click();
      await page.getByRole("option", { name: "Unassigned", exact: true }).click();
      await page.keyboard.press("Escape");
      const layoutRecorder = page.getByRole("button", {
        name: "Change Pane: Arrange Grid shortcut",
        exact: true,
      });
      await expect(layoutRecorder).toContainText("Unassigned");
      const firstRow = page.locator(".settings-row").first();
      expect((await firstRow.boundingBox())!.height).toBeLessThan(120);
      await expect(firstRow).not.toContainText("When: Always");
      await page
        .getByRole("heading", { name: "Keybindings", exact: true })
        .scrollIntoViewIfNeeded();
      await layoutRecorder.click();
      await page.keyboard.press("Control+Alt+g");
      await expect(layoutRecorder).toHaveCount(0);
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await filters.getByRole("button", { name: "Reset filters", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(layoutRecorder).toContainText("G");
      await page
        .getByRole("button", { name: "Reset Pane: Arrange Grid shortcut", exact: true })
        .click();
      await expect(layoutRecorder).toContainText("Unassigned");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `temp/verification/2026-10-15-keybindings/${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Shortcut help", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Shortcut help" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Shortcut help", exact: true })).toBeFocused();
    });
  }
const languages = ["en", "tr", "de", "fr", "es", "pt", "zh-CN", "ja"];
const captures = "temp/verification/settings-integrated/screens";

test("shared appearance controls preserve palette persistence and provide color recovery", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [390, 1440])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/settings.html?section=appearance&theme=${theme}&lang=en`);
      const studio = page.getByRole("region", { name: "Theme and colors", exact: true });
      await expect(studio.locator(".appearance-workspace-preview")).toHaveCount(9);
      await expect(studio.locator("details, summary")).toHaveCount(0);
      const olive = studio.getByRole("button", { name: /^Olive/ });
      const palettes = studio.getByRole("group", { name: "Theme palettes", exact: true });
      await expect(palettes.getByRole("button")).toHaveCount(6);
      for (const name of ["bycoda", "Olive", "Tide", "Kiln", "Dusk", "Ink"]) {
        const palette = palettes.getByRole("button", { name: new RegExp(`^${name}`) });
        await palette.scrollIntoViewIfNeeded();
        await expect(palette).toBeInViewport();
      }
      await olive.click();
      await expect(olive).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(olive).toHaveAttribute("aria-pressed", "true");
      await studio.getByRole("button", { name: "Reset colors", exact: true }).click();
      await expect(studio.getByRole("button", { name: /^bycoda/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await studio
        .getByRole("button", { name: theme === "light" ? "Light" : "Dark", exact: true })
        .click();
      await expect(page.locator("html")).toHaveClass(
        theme === "light" ? /theme-light/ : /^(?!.*theme-light)/,
      );
      await studio.getByRole("heading", { name: "Color scheme", exact: true }).evaluate((node) => {
        const scroller = node.closest<HTMLElement>("[data-settings-scroller]")!;
        scroller.scrollTop +=
          node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: testInfo.outputPath(`appearance-${width}-${theme}.png`),
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
});

test("category keyboard navigation retains focus and search opens an advanced control", async ({
  page,
}) => {
  await page.goto("/tests/browser/settings.html");
  const tabs = page
    .getByRole("tablist", { name: "Settings categories", exact: true })
    .getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  await tabs.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Search settings", exact: true }).fill("Saturation");
  await expect(page.getByRole("option").first()).toContainText("Saturation");
  await page.getByRole("combobox", { name: "Search settings", exact: true }).press("Enter");
  const target = page.locator('[data-setting-id="saturation"]');
  await expect(target).toBeVisible();
  await expect(target.getByRole("slider")).toBeFocused();
  await expect(target.locator("xpath=ancestor::details")).toHaveCount(0);
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search settings", exact: true });
  await search.fill("Codex · Terminal account profiles");
  await expect(page.getByRole("option").first()).toContainText("Codex");
  await search.press("Enter");
  const terminalProfiles = page.getByRole("dialog", {
    name: "Terminal account profiles",
    exact: true,
  });
  await expect(terminalProfiles).toBeVisible();
  await expect(
    page.locator('[data-setting-id="terminal-account-profiles-codex"] button').first(),
  ).toBeFocused();
  await expect(page.locator(".provider-cli-option[aria-current=true]")).toContainText("Codex");
  await page.keyboard.press("Escape");
  await expect(terminalProfiles).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Terminal account profiles", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("button", { name: "Search settings", exact: true })).toBeVisible();
});

test("automatic settings preserve values and dependent controls after reopening and reload", async ({
  page,
}) => {
  await page.goto("/tests/browser/settings.html");
  const toggle = page.locator('[data-setting-id="keep-awake"] [role="switch"]');
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: "Reopen settings" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.getByRole("tab", { name: "Notifications", exact: true }).click();
  const summary = page.getByRole("switch", { name: "Daily summary", exact: true });
  await expect(summary).toBeDisabled();
  await page.getByRole("switch", { name: "Desktop notifications", exact: true }).click();
  await expect(summary).toBeEnabled();
});

test("explicit template validation, save status and persistence preserve the last saved value", async ({
  page,
}) => {
  await page.goto("/tests/browser/settings.html?section=chat");
  await page.getByRole("button", { name: "Add template", exact: true }).click();
  await page.getByRole("button", { name: "Save templates", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("textbox", { name: "Template name", exact: true }).fill("Review code");
  await page
    .getByRole("textbox", { name: "Template text", exact: true })
    .fill("Find bugs and explain their impact.");
  await page.getByRole("button", { name: "Save templates", exact: true }).click();
  await expect(page.locator('[data-setting-id="prompt-templates"] [role="status"]')).toContainText(
    "Saved",
  );
  await page.getByRole("textbox", { name: "Template text", exact: true }).fill("Unsaved revision");
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: "Reopen settings" }).click();
  await expect(page.getByRole("textbox", { name: "Template text", exact: true })).toHaveValue(
    "Find bugs and explain their impact.",
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Template name", exact: true })).toHaveValue(
    "Review code",
  );
});

// Every locale/theme/size uses the same real 17-category screen. Screenshots
// support manual review; geometry assertions catch disappearing/overflowing fields.
for (const lang of languages)
  for (const theme of ["light", "dark"])
    for (const width of [390, 1440]) {
      test(`all categories and advanced fields: ${lang} ${theme} ${width}`, async ({ page }) => {
        test.setTimeout(180_000);
        mkdirSync(captures, { recursive: true });
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        for (const section of sections) {
          await page.goto(
            `/tests/browser/settings.html?lang=${lang}&theme=${theme}&section=${section}`,
          );
          await expect(page.locator(".bycoda-settings-panel")).toBeVisible();
          const categoryPicker = page.locator(".bycoda-settings-category-picker");
          await expect(
            (await categoryPicker.isVisible())
              ? categoryPicker.getByRole("button")
              : page.locator(".bycoda-settings-categories").getByRole("tab", { selected: true }),
          ).toBeVisible();
          await expect(page.locator(".bycoda-settings-panel")).toBeVisible();
          await expect(page.locator("details.settings-advanced")).toHaveCount(0);
          await page.waitForTimeout(100);
          const overflow = await page.locator(".bycoda-settings-panel").evaluate((panel) => {
            const bounds = panel.getBoundingClientRect();
            return [
              ...panel.querySelectorAll<HTMLElement>(
                "input,textarea,[role=switch],[role=slider],[aria-haspopup=listbox]",
              ),
            ]
              .filter((node) => node.getClientRects().length > 0)
              .filter((node) => {
                const rect = node.getBoundingClientRect();
                return (
                  rect.width < 1 || rect.left < bounds.left - 2 || rect.right > bounds.right + 2
                );
              })
              .map((node) => node.getAttribute("aria-label") ?? node.tagName);
          });
          expect(overflow, `${section} controls remain inside the panel`).toEqual([]);
          const squeezedDescriptions = await page
            .locator(".bycoda-settings-panel")
            .evaluate((panel) =>
              [
                ...panel.querySelectorAll<HTMLElement>(
                  ".settings-group-title .settings-description",
                ),
              ]
                .filter(
                  (node) =>
                    !node.closest(".sr-only") &&
                    node.getClientRects().length > 0 &&
                    node.getBoundingClientRect().width < 150,
                )
                .map((node) => node.textContent),
            );
          expect(
            squeezedDescriptions,
            `${section} group descriptions retain readable width`,
          ).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          const scroller = page.locator("[data-settings-scroller]");
          if (await scroller.count()) {
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
                path: `${captures}/${lang}-${theme}-${width}-${section}-${frame}.png`,
              });
            }
          } else
            await page.screenshot({
              path: `${captures}/${lang}-${theme}-${width}-${section}-0.png`,
            });
        }
        // Direct sub-screens are opened and cancelled, never saved to native state.
        for (const section of ["mcp", "worktrees", "groupLock"] as const) {
          await page.goto(
            `/tests/browser/settings.html?lang=${lang}&theme=${theme}&section=${section}`,
          );
          const main = page.locator("main");
          await expect(main).toHaveAttribute("data-fixture-labels", /mcp/);
          const labels = JSON.parse((await main.getAttribute("data-fixture-labels"))!) as Record<
            string,
            string
          >;
          const trigger = page.getByRole("button", {
            name: labels[section === "groupLock" ? "password" : section],
            exact: true,
          });
          await trigger.click();
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 2)).toBe(
            true,
          );
          await page.screenshot({
            path: `${captures}/${lang}-${theme}-${width}-${section}-dialog.png`,
          });
          await page.keyboard.press("Escape");
          await expect(dialog).toHaveCount(0);
          await expect(trigger).toBeFocused();
        }
        expect(errors).toEqual([]);
      });
    }
