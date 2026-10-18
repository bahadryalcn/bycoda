import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`connections: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings.html?section=connections&connections=1&theme=${theme}&lang=en`,
      );
      const root = page.locator("#setting-remote-machines");
      await expect(root.getByText("Studio Mac", { exact: true })).toBeVisible();
      await expect(root.getByRole("button", { name: "Start tunnel", exact: true })).toHaveCount(0);
      await expect(root.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
      const details = root.locator("details.connection-details").last();
      await expect(details).not.toHaveAttribute("open", "");
      await details.locator("summary").click();
      await expect(details).toContainText("owner@studio-tailnet");
      await root.getByRole("button", { name: "Add machine", exact: true }).click();
      const address = root.getByPlaceholder("user@my-mac-mini or an SSH alias");
      await address.fill("owner@new-machine");
      const machines = root.getByRole("radio", { name: "Your machines", exact: true });
      await machines.focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        root.getByRole("region", { name: "Connect your phone", exact: true }),
      ).toBeVisible();
      await expect(address).not.toBeVisible();
      await page.keyboard.press("ArrowRight");
      const tunnels = root.getByRole("region", { name: "External tunnels", exact: true });
      await expect(
        tunnels.getByRole("button", { name: "Start tunnel", exact: true }),
      ).toBeEnabled();
      const computer = tunnels.locator("label").first();
      const controls = tunnels.locator(".external-tunnel-controls");
      const gap = await controls.evaluate(
        (node, bottom) => node.getBoundingClientRect().top - bottom,
        (await computer.boundingBox())!.y + (await computer.boundingBox())!.height,
      );
      expect(gap).toBeLessThan(40);
      await tunnels.locator("input").first().fill("4567");
      await root.getByRole("radio", { name: "Your machines", exact: true }).click();
      await expect(address).toHaveValue("owner@new-machine");
      await root.getByRole("radio", { name: "Sharing", exact: true }).click();
      await expect(tunnels.locator("input").first()).toHaveValue("4567");
      expect(await root.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      mkdirSync("temp/verification/2026-10-18-connections", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-10-18-connections/${theme}-${width}-tunnels.png`,
      });
      await root.getByRole("radio", { name: "Your machines", exact: true }).click();
      await root.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.screenshot({
        path: `temp/verification/2026-10-18-connections/${theme}-${width}-machines.png`,
      });
    });
  }
}
