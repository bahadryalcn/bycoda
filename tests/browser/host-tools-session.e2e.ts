import { test, expect, type Page } from "@playwright/test";

async function selectTool(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.isVisible()) await tab.click();
  else {
    await page.getByRole("button", { name: "Conversation tool selection", exact: true }).click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
  }
}

for (const theme of ["dark", "light"])
  for (const width of [1280, 800]) {
    test(`session tools retained domains ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/host-tools.html?detached=1&theme=${theme}`);
      for (const [index, name] of [
        "Devices",
        "Host browser",
        "Development servers",
        "Logs",
        "Resource usage",
      ].entries()) {
        await selectTool(page, name);
        const panel = page.getByRole("tabpanel");
        await expect(panel).toBeVisible();
        if (index === 0) {
          // Opening the panel only observes the device host; connecting is explicit.
          await page.getByRole("button", { name: "Connect devices", exact: true }).click();
          await expect(page.locator(".device-panel-choice").getByRole("button")).toBeVisible();
        }
        if (index === 1) {
          await page.getByRole("button", { name: "Open website", exact: true }).click();
          await expect(page.locator("img.host-browser-frame")).toBeVisible();
        }
        if (index === 2)
          await expect(
            page.getByRole("listitem", { name: "Demo dev server", exact: true }),
          ).toBeVisible();
        if (index === 3)
          await expect(page.getByText("Workspace loaded", { exact: true })).toBeVisible();
        if (index === 4) {
          await page.getByRole("button", { name: "Sample now", exact: true }).click();
          await expect(page.getByText("2.4%", { exact: true })).toBeVisible();
        }
        expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await page.screenshot({
          path: `temp/verification/2026-11-04-session-tools/domain-${index}-${theme}-${width}.png`,
          animations: "disabled",
        });
      }
      const browserCalls = () =>
        page.evaluate(
          () =>
            (window as unknown as { hostToolCalls: { method: string }[] }).hostToolCalls.filter(
              (call) => call.method === "browser.frame",
            ).length,
        );
      const before = await browserCalls();
      await page.waitForTimeout(1200);
      expect(await browserCalls()).toBe(before);
      await selectTool(page, "Host browser");
      await expect(page.locator("img.host-browser-frame")).toBeVisible();
      await expect(page.getByRole("button", { name: "Control active", exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-04-session-tools/control-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Control active", exact: true }).click();
      await expect(page.getByRole("button", { name: "View only", exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-04-session-tools/view-only-${theme}-${width}.png`,
        animations: "disabled",
      });
      expect(errors).toEqual([]);
    });
  }
