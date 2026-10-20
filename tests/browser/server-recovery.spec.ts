import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1440]) {
    test(`remote recovery shows truthful feature health ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/servers.html?recoveryFixture&theme=${theme}`);
      const row = page.locator('[data-server-row="fixture-0"]');
      await row.click();
      const details = page.getByRole("region", { name: "Server details" });
      await expect(row).toContainText("Not connected");
      await page.evaluate(() => (window as any).serversFixtureRecovery("pending"));
      // Exercise the shared timer recovery, without a manual reconnect action.
      await expect(row).toContainText("Reconnecting");
      await expect(details.getByRole("button", { name: "Reconnect", exact: true })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(details.getByRole("button", { name: "Cancel reconnect" })).toBeVisible();
      await page.evaluate(() => {
        (window as any).serversFixtureFilesReady(false);
        (window as any).serversFixtureRecovery("ready");
        (window as any).serversFixtureFinishRecovery();
      });
      await expect(row).toContainText("Refresh pending");
      await expect(details).toContainText("Unavailable");
      await details.getByText("Connection history", { exact: false }).click();
      await expect(details).toContainText("Host verified");
      await page.evaluate(() => (window as any).serversFixtureFilesReady(true));
      await expect(row).toContainText("Connected");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const folder = "temp/verification/2026-10-21-remote-rea/browser";
      await mkdir(folder, { recursive: true });
      await page.screenshot({ path: `${folder}/recovery-${theme}-${width}.png` });
    });
  }
}
