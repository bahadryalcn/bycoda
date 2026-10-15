import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const sections = ["general", "appearance", "notifications", "keybindings", "workspace", "terminal", "chat", "providers", "usage", "mcp", "skills", "inbox", "worktrees", "groupLock", "archive", "connections", "policies"];

for (const theme of ["light", "dark"]) for (const width of [390, 768, 1024, 1440]) {
  test(`keybindings recording and filters: ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/tests/browser/settings.html?section=keybindings&theme=${theme}&lang=en`);
    const search = page.getByRole("searchbox", { name: "Filter keybindings", exact: true });
    await search.fill("Open Inbox");
    const recorder = page.getByRole("button", { name: "Change App: Open Inbox shortcut", exact: true });
    await expect(recorder).toBeVisible();
    await recorder.click();
    await page.keyboard.press("Control+Alt+q");
    await expect(recorder).toContainText("Q");
    await expect(page.getByText("Modified", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Default:/)).toBeVisible();
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
    await page.getByRole("button", { name: "Reset App: Open Inbox shortcut", exact: true }).click();
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
    const layoutRecorder = page.getByRole("button", { name: "Change Pane: Arrange Grid shortcut", exact: true });
    await expect(layoutRecorder).toContainText("Unassigned");
    const firstRow = page.locator(".settings-row").first();
    expect((await firstRow.boundingBox())!.height).toBeLessThan(120);
    await expect(firstRow).not.toContainText("When: Always");
    await page.getByRole("heading", { name: "Keybindings", exact: true }).scrollIntoViewIfNeeded();
    await layoutRecorder.click();
    await page.keyboard.press("Control+Alt+g");
    await expect(layoutRecorder).toHaveCount(0);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await filters.getByRole("button", { name: "Reset filters", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(layoutRecorder).toContainText("G");
    await page.getByRole("button", { name: "Reset Pane: Arrange Grid shortcut", exact: true }).click();
    await expect(layoutRecorder).toContainText("Unassigned");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `temp/verification/2026-10-15-keybindings/${theme}-${width}.png` });
    await page.getByRole("button", { name: "Shortcut help", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Shortcut help" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Shortcut help", exact: true })).toBeFocused();
  });
}
const languages = ["en", "tr", "de", "fr", "es", "pt", "zh-CN", "ja"];
const captures = "temp/verification/settings-integrated/screens";

test("category keyboard navigation retains focus and search opens an advanced control", async ({ page }) => {
  await page.goto("/tests/browser/settings.html");
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(17);
  await tabs.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
  await page.getByRole("combobox", { name: "Search settings", exact: true }).fill("Saturation");
  await expect(page.getByRole("option").first()).toContainText("Saturation");
  await page.getByRole("combobox", { name: "Search settings", exact: true }).press("Enter");
  const target = page.locator('[data-setting-id="saturation"]');
  await expect(target).toBeVisible();
  await expect(target.getByRole("slider")).toBeFocused();
  await expect(target.locator("xpath=ancestor::details")).toHaveAttribute("open", "");
  const search = page.getByRole("combobox", { name: "Search settings", exact: true });
  await search.fill("Codex · Terminal account profiles");
  await expect(page.getByRole("option").first()).toContainText("Codex");
  await search.press("Enter");
  const terminalProfiles = page.getByRole("dialog", { name: "Terminal account profiles", exact: true });
  await expect(terminalProfiles).toBeVisible();
  await expect(page.locator('[data-setting-id="terminal-account-profiles-codex"] button').first()).toBeFocused();
  await expect(page.locator(".provider-cli-option[aria-current=true]")).toContainText("Codex");
  await page.keyboard.press("Escape");
  await expect(terminalProfiles).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Terminal account profiles", exact: true })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Search settings", exact: true })).toBeVisible();
});

test("automatic settings preserve values and dependent controls after reopening and reload", async ({ page }) => {
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
  await page.getByRole("switch", { name: "Notifications", exact: true }).click();
  await expect(summary).toBeEnabled();
});

test("explicit template validation, save status and persistence preserve the last saved value", async ({ page }) => {
  await page.goto("/tests/browser/settings.html?section=chat");
  await page.getByRole("button", { name: "Add template", exact: true }).click();
  await page.getByRole("button", { name: "Save templates", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("textbox", { name: "Template name", exact: true }).fill("Review code");
  await page.getByRole("textbox", { name: "Template text", exact: true }).fill("Find bugs and explain their impact.");
  await page.getByRole("button", { name: "Save templates", exact: true }).click();
  await expect(page.locator('[data-setting-id="prompt-templates"] [role="status"]')).toContainText("Saved");
  await page.getByRole("textbox", { name: "Template text", exact: true }).fill("Unsaved revision");
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: "Reopen settings" }).click();
  await expect(page.getByRole("textbox", { name: "Template text", exact: true })).toHaveValue("Find bugs and explain their impact.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Template name", exact: true })).toHaveValue("Review code");
});

// Every locale/theme/size uses the same real 17-category screen. Screenshots
// support manual review; geometry assertions catch disappearing/overflowing fields.
for (const lang of languages) for (const theme of ["light", "dark"]) for (const width of [390, 1440]) {
  test(`all categories and advanced fields: ${lang} ${theme} ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(captures, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const section of sections) {
      await page.goto(`/tests/browser/settings.html?lang=${lang}&theme=${theme}&section=${section}`);
      await expect(page.getByRole("tab", { selected: true })).toBeVisible();
      await expect(page.getByRole("tabpanel")).toBeVisible();
      await page.locator("details.settings-advanced").evaluateAll((nodes) => {
        for (const node of nodes) (node as HTMLDetailsElement).open = true;
      });
      await page.waitForTimeout(100);
      const overflow = await page.getByRole("tabpanel").evaluate((panel) => {
        const bounds = panel.getBoundingClientRect();
        return [...panel.querySelectorAll<HTMLElement>("input,textarea,[role=switch],[role=slider],[aria-haspopup=listbox]")]
          .filter((node) => node.getClientRects().length > 0)
          .filter((node) => { const rect = node.getBoundingClientRect(); return rect.width < 1 || rect.left < bounds.left - 2 || rect.right > bounds.right + 2; })
          .map((node) => node.getAttribute("aria-label") ?? node.tagName);
      });
      expect(overflow, `${section} controls remain inside the panel`).toEqual([]);
      const squeezedDescriptions = await page.getByRole("tabpanel").evaluate((panel) =>
        [...panel.querySelectorAll<HTMLElement>(".settings-group-title .settings-description")]
          .filter((node) => node.getClientRects().length > 0 && node.getBoundingClientRect().width < 150)
          .map((node) => node.textContent),
      );
      expect(squeezedDescriptions, `${section} group descriptions retain readable width`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const scroller = page.locator("[data-settings-scroller]");
      if (await scroller.count()) {
        const dimensions = await scroller.evaluate((node) => ({ height: node.clientHeight, total: node.scrollHeight }));
        for (let top = 0, frame = 0; top < dimensions.total; top += Math.max(1, dimensions.height - 80), frame++) {
          await scroller.evaluate((node, top) => { node.scrollTop = top; }, top);
          await page.screenshot({ path: `${captures}/${lang}-${theme}-${width}-${section}-${frame}.png` });
        }
      } else await page.screenshot({ path: `${captures}/${lang}-${theme}-${width}-${section}-0.png` });
    }
    // Direct sub-screens are opened and cancelled, never saved to native state.
    for (const section of ["mcp", "worktrees", "groupLock"] as const) {
      await page.goto(`/tests/browser/settings.html?lang=${lang}&theme=${theme}&section=${section}`);
      const main = page.locator("main");
      await expect(main).toHaveAttribute("data-fixture-labels", /mcp/);
      const labels = JSON.parse((await main.getAttribute("data-fixture-labels"))!) as Record<string, string>;
      const trigger = page.getByRole("button", { name: labels[section === "groupLock" ? "password" : section], exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 2)).toBe(true);
      await page.screenshot({ path: `${captures}/${lang}-${theme}-${width}-${section}-dialog.png` });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    expect(errors).toEqual([]);
  });
}
