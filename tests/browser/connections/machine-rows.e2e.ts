import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const evidence = "../../../temp/verification/wp5";

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`machine rows in every status: ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem("bycoda.disabledMachines", JSON.stringify(["fixture-nas-env"]));
      });
      await page.goto(
        `/tests/browser/settings/settings.html?section=connections&connections=1&statuses=1&theme=${theme}&lang=en`,
      );
      const root = page.locator("#setting-remote-machines");
      const summary = (name: string) =>
        root
          .getByText(name, { exact: true })
          .locator("xpath=ancestor::div[2]")
          .locator("[data-machine-summary]");
      // The garage machine answers once, then goes quiet: Reconnecting inside the shared grace.
      await expect(summary("Garage PC")).toContainText("Reconnecting", { timeout: 25_000 });
      await expect(summary("Studio Mac")).toContainText("Connected");
      await expect(summary("Studio Mac")).toContainText("3 routes");
      await expect(summary("Office Linux")).toContainText("Offline");
      await expect(summary("Lab Mac")).toContainText("Update required");
      await expect(summary("Lab Mac")).toContainText("0.7.8");
      await expect(summary("Studio Mac")).not.toContainText("0.7.9");
      await expect(summary("Pi Zero")).toContainText("Connecting");
      await expect(summary("Old NAS")).toContainText("Disabled");
      await expect(summary("Cloud box")).toContainText("Tunnel");
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/${theme}-${width}-rows.png` });
      await summary("Studio Mac")
        .getByRole("button", { name: /routes/ })
        .click();
      const panel = root.locator("[data-machine-routes]").first();
      await expect(panel).toContainText("Found by the host");
      await summary("Cloud box").getByRole("button", { name: /route/ }).click();
      await expect(root.locator("[data-route='calm-river.trycloudflare.com']")).toContainText(
        "Tunnel · Found automatically",
      );
      expect(await root.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: `${evidence}/${theme}-${width}-routes.png` });
    });
  }
}
