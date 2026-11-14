import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`MCP sign-in rows ${theme} ${width}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`/tests/browser/settings/external-mcp.html?theme=${theme}`);
      const section = page.locator("section", { has: page.locator("#mcp-oauth-heading") });
      await expect(section.getByText("Signed in", { exact: true })).toBeVisible();
      await expect(section.getByText("Not signed in", { exact: true })).toBeVisible();
      await expect(section.getByText("Expired", { exact: true })).toBeVisible();
      await section.getByRole("button", { name: "Help" }).click();
      await expect(page.getByText(/load the server on demand/)).toBeVisible();
      await page.keyboard.press("Escape");
      await section.getByRole("button", { name: "Sign out" }).first().click();
      await expect(section.getByText("Not signed in", { exact: true })).toHaveCount(2);
      mkdirSync("temp/verification/mcp-on-demand", { recursive: true });
      await page.screenshot({
        path: `temp/verification/mcp-on-demand/oauth-${theme}-${width}.png`,
      });
    });
