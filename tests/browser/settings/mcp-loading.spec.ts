import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`MCP loading mode ${theme} ${width}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`/tests/browser/settings/external-mcp.html?theme=${theme}`);
      const section = page.locator('[data-setting-id="mcp-loading"]');
      await expect(section.getByRole("switch")).toHaveCount(3);
      await expect(section.getByRole("switch", { name: /github/ })).toBeChecked();
      await section.getByRole("switch", { name: /playwright/ }).click();
      await expect(section.getByRole("switch", { name: /playwright/ })).toBeChecked();
      await section.getByRole("button", { name: "Help" }).click();
      await expect(page.getByText("Applies to new sessions.")).toBeVisible();
      mkdirSync("temp/verification/mcp-on-demand", { recursive: true });
      await page.screenshot({
        path: `temp/verification/mcp-on-demand/loading-${theme}-${width}.png`,
      });
    });
