import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`compact workspace settings: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/settings.html?section=workspace&theme=${theme}&lang=en`);
      const workspace = page.locator(".workspace-settings");
      const help = workspace.getByRole("button", {
        name: "About workspace tools",
        exact: true,
      });
      await help.click();
      const helpDialog = page.getByRole("dialog", {
        name: "About workspace tools",
        exact: true,
      });
      await expect(helpDialog).toBeVisible();
      await expect(
        helpDialog.getByText(
          "Controls navigation visibility. Hiding this tool does not stop work or change permissions.",
        ),
      ).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(helpDialog).toHaveCount(0);
      await expect(help).toBeFocused();
      await expect(
        workspace.getByText("Applies across projects. Changes save automatically."),
      ).toHaveCount(1);

      // These switches must remain immediately reachable and independently persisted.
      for (const name of [
        "Tasks",
        "Automations",
        "Inbox",
        "Notes",
        "Social Media",
        "Working agents",
        "Show excluded files",
      ]) {
        const toggle = workspace.getByRole("switch", { name, exact: true });
        await expect(toggle).toBeVisible();
        const initial = await toggle.isChecked();
        await toggle.focus();
        await page.keyboard.press("Space");
        await expect(toggle).toBeChecked({ checked: !initial });
        await page.reload();
        await expect(toggle).toBeChecked({ checked: !initial });
      }
      await workspace.getByRole("radio", { name: "Top bar", exact: true }).click();
      await page.reload();
      await expect(workspace.getByRole("radio", { name: "Top bar", exact: true })).toBeChecked();
      await expect(workspace.locator("#setting-diff-view")).toHaveCount(0);

      await expect(workspace.locator("details, summary")).toHaveCount(0);
      await expect(
        workspace.getByRole("switch", { name: "Format on save", exact: true }),
      ).toBeVisible();
      expect(
        await workspace.evaluate(
          (root) =>
            [...root.querySelectorAll(".settings-row, .settings-row-control")].filter(
              (node) => node.scrollWidth > node.clientWidth + 1,
            ).length,
        ),
      ).toBe(0);
      await page.locator("[data-settings-scroller]").evaluate((node) => {
        node.scrollTop = 0;
      });
      mkdirSync("temp/verification/2026-10-18-workspace-settings", {
        recursive: true,
      });
      await page.screenshot({
        path: `temp/verification/2026-10-18-workspace-settings/${theme}-${width}.png`,
      });
    });
  }
}
