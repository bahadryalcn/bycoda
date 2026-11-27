import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Settings opens as a dialog over a workspace that stays mounted (the App wiring), not as a page.
const evidence = "temp/verification/2026-10-28-ui-redesign/n1";
const modelOrderEvidence = "temp/verification/settings-dialog-model-order";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`settings dialog over workspace: ${theme} ${width}`, async ({ page }) => {
      mkdirSync(evidence, { recursive: true });
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings/settings.html?dialog=1&theme=${theme}&lang=en`);
      const workspace = page.locator("[data-workspace-chrome]");
      const draft = page.getByLabel("Workspace draft");
      await draft.fill("unsent draft");
      const opener = page.getByTestId("open-settings");
      await opener.focus();
      await page.keyboard.press("Enter");

      const dialog = page.getByRole("dialog", {
        name: "Settings",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Loading Settings…")).toHaveCount(0);
      await expect(dialog.locator("[data-settings-embedded]")).toBeVisible();
      // The work context stays mounted and visible behind the dialog, inert rather than hidden.
      await expect(workspace).toBeVisible();
      expect(
        await workspace.evaluate((el) => !!el.closest("[inert]") || el.hasAttribute("inert")),
      ).toBe(true);
      expect(await workspace.getAttribute("aria-hidden")).toBeNull();
      // One chrome: the embedded page draws no second titlebar or window controls.
      await expect(dialog.locator("[data-window-controls]")).toHaveCount(0);
      // The shared Modal close control stays visible and reachable above the embedded page.
      const close = dialog.getByRole("button", { name: "Close", exact: true });
      await expect(close).toBeVisible();
      const hit = await close.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return top === el || el.contains(top) ? true : `${top?.tagName}.${top?.className}`;
      });
      expect(hit).toBe(true);
      const box = (await dialog.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(width - 24);
      expect(box.height).toBeLessThanOrEqual(800 - 24);
      await page.screenshot({
        path: `${evidence}/settings-dialog-${theme}-${width}.png`,
      });

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(draft).toHaveValue("unsent draft");
    });

    test(`model order setup stays in one column: ${theme} ${width}`, async ({ page }) => {
      mkdirSync(modelOrderEvidence, { recursive: true });
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?dialog=1&section=providers&workFixture=empty&theme=${theme}&lang=en`,
      );
      await page.getByTestId("open-settings").click();
      const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
      await dialog.getByRole("tab", { name: "Background work", exact: true }).click();
      const heading = dialog.getByRole("heading", { name: "Model priority" });
      const prepare = dialog.getByRole("button", { name: "Set up with rules" });
      const plan = dialog.getByRole("button", { name: "Set up with AI", exact: true });
      await expect(heading).toBeVisible();
      await expect(dialog.getByText("No models configured", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
      // Setup sits above the tabs; it rewrites the whole draft, not one tab.
      const tablist = dialog.getByRole("tablist", { name: "Background work" });
      const prepareBox = await prepare.boundingBox();
      const tablistBox = await tablist.boundingBox();
      expect(prepareBox?.y).toBeLessThan(tablistBox?.y ?? 0);
      expect(prepareBox?.x).toBe(tablistBox?.x);
      await page.screenshot({ path: `${modelOrderEvidence}/empty-${theme}-${width}.png` });
      await prepare.focus();
      await page.keyboard.press("Tab");
      await expect(plan).toBeFocused();
    });

    test(`Models setup leaves removed accounts out of either draft: ${theme} ${width}`, async ({
      page,
    }) => {
      mkdirSync(modelOrderEvidence, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?dialog=1&section=providers&workFixture=routing&providersFixture&removedRoutingAccount&theme=${theme}&lang=en`,
      );
      await page.getByTestId("open-settings").click();
      const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
      await dialog.getByRole("tab", { name: "Background work", exact: true }).click();
      await dialog.getByRole("tab", { name: "Models & order", exact: true }).click();
      const removed = dialog.locator('[data-entry-id="r-opus"]');
      await expect(removed.getByText("Removed account", { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Set up with rules", exact: true }).click();
      await expect(dialog.getByText("Rules prepared the draft.", { exact: true })).toBeVisible();
      await expect(removed).toHaveCount(0);
      await dialog.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(removed).toBeVisible();
      await expect(dialog.getByText("Rules prepared the draft.", { exact: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: "Set up with AI", exact: true }).click();
      await expect(
        dialog.getByRole("status").filter({ hasText: "Rules prepared the draft." }),
      ).toBeVisible();
      await expect(removed).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
      await page.screenshot({ path: `${modelOrderEvidence}/draft-${theme}-${width}.png` });
      const planner = dialog
        .getByRole("group", { name: "Set up with AI", exact: true })
        .locator('button[aria-haspopup="dialog"]');
      await expect(planner).toHaveText("Automatic");
      await planner.click();
      const picker = page.getByRole("dialog", { name: "Model and settings", exact: true });
      await expect(picker.getByRole("button", { name: /^Automatic \(.+\)$/ })).toBeVisible();
      await picker.getByRole("tab", { name: /Claude Code/ }).click();
      const opus = picker.getByRole("option", { name: /Opus/ }).first();
      await opus.click();
      await expect(opus).toHaveAttribute("aria-selected", "true");
      await expect(planner).toHaveText(/Opus/);
      await expect(picker.locator('[data-setting-id="effort"]')).toBeVisible();
      await expect(picker.locator("[data-model-provider-settings]")).toHaveCount(0);
      await page.screenshot({ path: `${modelOrderEvidence}/planner-${theme}-${width}.png` });
    });

    test(`Models routing review: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?dialog=1&section=providers&workFixture=routing&providersFixture&theme=${theme}&lang=en`,
      );
      await page.getByTestId("open-settings").click();
      const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
      const evidence = "temp/verification/models-settings";
      mkdirSync(evidence, { recursive: true });
      const capture = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        await page.screenshot({ path: `${evidence}/${name}-${theme}-${width}.png` });
      };
      const tab = (name: string) => dialog.getByRole("tab", { name, exact: true });
      await tab("Background work").click();
      await expect(tab("Jobs")).toHaveAttribute("aria-selected", "true");
      await capture("jobs");
      await tab("Models & order").click();
      await expect(
        dialog
          .locator('[data-entry-id="r-sonnet"]')
          .getByRole("button", { name: /sonnet.*personal/i }),
      ).toBeVisible();
      const work = dialog.getByRole("region", { name: "Work accounts", exact: true });
      const rows = work.locator("[data-entry-id]");
      await expect(rows.first()).toHaveAttribute("data-entry-id", "r-opus");
      await capture("priority");
      const selectAll = work.getByRole("checkbox", { name: "Select all models of Work accounts" });
      await selectAll.check();
      await expect(
        work.getByRole("checkbox", { name: "Select model 1", exact: true }),
      ).toBeChecked();
      await selectAll.uncheck();
      const first = rows.first().getByRole("button", { name: "Reorder model 1" });
      await first.press("Alt+ArrowDown");
      await expect(rows.first()).toHaveAttribute("data-entry-id", "r-haiku");
      const modelRow = dialog.locator('[data-entry-id="r-opus"]');
      await modelRow.getByRole("button", { name: /opus/i }).first().click();
      const picker = page.getByRole("dialog", { name: "Model and settings" });
      await picker.getByRole("button", { name: /Engineering workspace/i }).click();
      const personal = picker.getByRole("radio", { name: /Personal/i });
      await expect(personal).toBeVisible();
      await expect(picker.getByRole("radio", { name: /Previous workspace/i })).toBeVisible();
      await capture("accounts");
      await personal.click();
      await expect(modelRow.getByRole("button", { name: /opus.*personal/i })).toBeVisible();
      await expect(picker).toHaveCount(0);
      await tab("Groups").click();
      const group = dialog.getByRole("region", { name: "Smartest", exact: true });
      await expect(group.getByRole("textbox", { name: "Group name" })).toHaveValue("Smartest");
      const grips = group.getByRole("button", { name: /^Reorder in/ });
      const from = (await grips.first().boundingBox())!;
      const to = (await grips.last().boundingBox())!;
      const initial = await grips.first().getAttribute("aria-label");
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.8, { steps: 8 });
      await page.mouse.up();
      await expect(grips.last()).toHaveAttribute("aria-label", initial!);
      await capture("groups");
      await expect(tab("Agents")).toHaveCount(0);
      await tab("Limits").click();
      await expect(dialog.getByRole("region", { name: "Plan share by job" })).toBeVisible();
      await expect(dialog.getByText("No usage in this window", { exact: true })).toBeVisible();
      await expect(
        dialog.getByRole("spinbutton", { name: "Daily cost (USD)", exact: true }),
      ).toHaveValue("10");
      await expect(dialog.getByText("This computer needs a Host update.")).toHaveCount(0);
      await capture("limits");
      await dialog.getByRole("region", { name: "Plan share by job" }).scrollIntoViewIfNeeded();
      await capture("plan-share");
      await tab("Jobs").click();
      await expect(dialog.getByRole("button", { name: "Save changes" })).toBeEnabled();
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect(dialog.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
      await tab("Models & order").click();
      await expect(modelRow.getByRole("button", { name: /opus.*personal/i })).toBeVisible();
    });
  }
}

test("settings dialog Archive reports unavailable history and retries", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(
    "/tests/browser/settings/settings.html?dialog=1&section=archive&history=failed&lang=en",
  );
  await page.getByTestId("open-settings").click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("radio", { name: "Conversations", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /retry/i })).toBeVisible();
  await dialog.getByRole("button", { name: /retry/i }).click();
  await expect(page.locator("main")).toHaveAttribute("data-fixture-retries", "1");
});
