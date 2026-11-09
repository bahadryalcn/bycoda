import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
const output = "temp/verification/2026-11-04-room-remote-access";
for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`Room remote access readiness ${theme} ${width}`, async ({ page }) => {
      await mkdir(output, { recursive: true });
      await writeFile(
        join(output, "README.md"),
        "Purpose: remote Room access readiness UI. Origin: synthetic Assistant Room and paired Host fixture. Not an installed app, native review, Host grant, or provider acceptance.\n",
      );
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/assistant-room.html?global-room&remote-access&theme=${theme}`,
      );
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Conversation actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Remote Room access…" }).click();
      const dialog = page.getByRole("dialog", { name: "Remote Room access" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("This Room is registered on its original Host.")).toBeVisible();
      await expect(
        dialog.getByText(
          "The target project must be visible and the native identity trusted by both Hosts. Each connection requires native review.",
        ),
      ).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Connect" })).toBeDisabled();
      await expect(dialog.getByText("No other paired Host is available.")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: join(output, `remote-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
