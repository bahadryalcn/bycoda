import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  for (const width of [390, 768, 1440]) {
    test(`${theme} at ${width}px: compact requests and expandable history`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/notifications.html?theme=${theme}`);
      await page.getByRole("button", { name: "Notifications", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "Notifications", exact: true });
      await expect(panel.locator(".approval-toast")).toHaveCount(3);
      await expect(panel.locator(".approval-toast").first()).toHaveCSS("animation-name", "none");
      await page.screenshot({
        path: `temp/verification/2026-10-18-notifications/pending-${theme}-${width}.png`,
      });
      const list = panel.getByRole("tabpanel");
      expect((await list.boundingBox())!.y - (await panel.boundingBox())!.y).toBeLessThan(110);
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      await expect(page.getByLabel("Fixture result")).toHaveText("fixture-1:1:allow");
      await expect(panel.locator(".approval-toast")).toHaveCount(2);
      await page.getByRole("tab", { name: /Notification history/ }).click();
      const details = panel.locator("details").first();
      await details.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(details).toHaveAttribute("open", "");
      await expect(details.locator(".notification-history-path")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(details).not.toHaveAttribute("open", "");
      expect(await list.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.getByRole("tab", { name: /Notification history/ }).click();
      await page.screenshot({
        path: `temp/verification/2026-10-18-notifications/${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Notification settings…", exact: true }).click();
      const settings = page.getByRole("region", { name: "Notification settings…", exact: true });
      const toggle = settings.getByRole("switch", { name: "Show request popups", exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(panel).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(settings).toHaveCount(0);
      await expect(panel).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Notification settings…", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeFocused();
    });
  }
}

test("empty state, persisted preferences and clearing history", async ({ page }) => {
  await page.goto("/tests/browser/notifications.html?empty");
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByText("No pending requests", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Notification settings…", exact: true }).click();
  await page.getByRole("switch", { name: "Show request popups", exact: true }).click();
  await page.getByRole("button", { name: "Clear notification history", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Notification history/ }).focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: /Pending/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByText("No notification history", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await page.getByRole("button", { name: "Notification settings…", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Show request popups", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Notification settings…", exact: true }),
  ).toHaveCount(0);
});
