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
        path: `temp/verification/2026-11-10-notifications/pending-${theme}-${width}.png`,
      });
      const list = panel.getByRole("tabpanel");
      expect((await list.boundingBox())!.y - (await panel.boundingBox())!.y).toBeLessThan(110);
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      await expect(page.getByLabel("Fixture result")).toHaveText("fixture-1:1:allow");
      await expect(panel.locator(".approval-toast")).toHaveCount(2);
      await page.getByRole("tab", { name: /Recent requests/ }).click();
      // The two requests still pending are marked; the answered one is not.
      await expect(panel.getByText("Waiting for you", { exact: true })).toHaveCount(2);
      const row = panel.locator(".notification-history-item").first();
      const more = row.getByRole("button", { name: "Show more", exact: true });
      await more.focus();
      await page.keyboard.press("Enter");
      await expect(row.locator(".notification-history-path")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(row.locator(".notification-history-path")).toHaveCount(0);
      expect(await list.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      // A conversation that is gone says so in its row and keeps the panel open.
      const gone = panel.locator(".notification-history-item").filter({ hasText: "old-gone" });
      await gone.locator(".notification-request-body").click();
      await expect(gone.getByText("This conversation is no longer available.")).toBeVisible();
      // One entry leaves on its own.
      const rows = await panel.locator(".notification-history-item").count();
      await gone.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(panel.locator(".notification-history-item")).toHaveCount(rows - 1);
      await page.screenshot({
        path: `temp/verification/2026-11-10-notifications/${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Notification options", exact: true }).click();
      const settings = page.getByRole("region", { name: "Notification options", exact: true });
      const toggle = settings.getByRole("switch", { name: "Show request popups", exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(panel).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(settings).toHaveCount(0);
      await expect(panel).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Notification options", exact: true }),
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
  await page.getByRole("button", { name: "Notification options", exact: true }).click();
  await page.getByRole("switch", { name: "Show request popups", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Recent requests/ }).focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: /Pending/ })).toBeFocused();
  await page.keyboard.press("End");
  // Clearing asks in place, beside the list, and only empties it once the write is confirmed.
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  // A press right after the question opens is its own tail, not an answer.
  await page.waitForTimeout(400);
  await page.screenshot({ path: "temp/verification/2026-11-10-notifications/clear-confirm.png" });
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("No recent requests", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await page.getByRole("button", { name: "Notification options", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Show request popups", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("region", { name: "Notification options", exact: true })).toHaveCount(
    0,
  );
});
