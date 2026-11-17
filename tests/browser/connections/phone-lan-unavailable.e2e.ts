import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const evidence = "temp/verification/2026-11-17-phone-lan";

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`phone LAN unavailable: ${theme} ${width}`, async ({ page }) => {
      mkdirSync(evidence, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=connections&connections=1&phone=unavailable&theme=${theme}&lang=en`,
      );
      const root = page.locator("#setting-remote-machines");
      await expect(root.getByText("Studio Mac", { exact: true })).toBeVisible();
      await expect(root.getByRole("heading", { name: /^Your computers/ })).toBeVisible();
      await page.screenshot({ path: `${evidence}/${theme}-${width}-computers.png` });
      await root.getByRole("tab", { name: "Devices", exact: true }).click();
      await root.getByRole("button", { name: "Connect a phone", exact: true }).click();
      const phone = page.getByRole("dialog", { name: "Connect your phone", exact: true });
      // One failure message: the Host reason, not the generic firewall copy as well.
      await expect(phone.getByText(/mobile port is blocked/)).toBeVisible();
      await expect(phone.getByText(/Local network access is unavailable/)).toHaveCount(0);
      await expect(phone.getByText(/treats this network as Public/)).toBeVisible();
      await expect(phone.getByText("192.168.2.108 · Ethernet")).toBeVisible();
      expect(await root.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: `${evidence}/${theme}-${width}-phone.png` });
    });
  }
}
