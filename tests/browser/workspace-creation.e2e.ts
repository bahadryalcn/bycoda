import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`new workspace default and older Host: ${theme} ${width}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/workspace-creation.html?theme=${theme}`);
      await expect(page.locator("[data-workspace-creation-status]")).toHaveText("");
      await expect(
        page.getByRole("button", { name: "Workspace Current checkout", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      mkdirSync("temp/verification/d1", { recursive: true });
      await page.screenshot({
        path: `temp/verification/d1/creation-${theme}-${width}.png`,
        fullPage: true,
      });
      const mode = page.getByRole("button", { name: "Workspace Current checkout", exact: true });
      await mode.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Workspace", exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/d1/creation-picker-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await page.goto(`/tests/browser/workspace-creation.html?theme=${theme}&old-host&worktree`);
      await expect(page.locator("[data-workspace-creation-status]")).toContainText(
        "Update bycoda Host",
      );
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
      await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
        /Keep the owner's draft/,
      );
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.locator("[data-workspace-creation-status]")).toContainText(
        "Update bycoda Host",
      );
      await page.screenshot({
        path: `temp/verification/d1/creation-update-${theme}-${width}.png`,
        fullPage: true,
      });
    });
  }
}

test("project policy worktree remains an explicit visible selection", async ({ page }) => {
  await page.goto("/tests/browser/workspace-creation.html?worktree-policy");
  await expect(
    page.getByRole("button", { name: "Workspace New worktree", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
});

test("older Host defaults to current checkout without managed admission", async ({ page }) => {
  await page.goto("/tests/browser/workspace-creation.html?old-host");
  await expect(
    page.getByRole("button", { name: "Workspace Current checkout", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await expect(page.locator("[data-workspace-creation-status]")).toHaveText("");
});
