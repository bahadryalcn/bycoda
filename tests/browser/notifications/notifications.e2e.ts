import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  for (const width of [390, 800, 1280]) {
    test(`${theme} at ${width}px: compact requests and expandable history`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/notifications/notifications.html?theme=${theme}`);
      await page.getByRole("button", { name: "Notifications", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "Notifications", exact: true });
      await expect(panel.locator(".approval-toast")).toHaveCount(3);
      await expect(panel.locator(".approval-toast").first()).toHaveCSS("animation-name", "none");
      await page.screenshot({
        path: `temp/verification/2026-11-11-notification-center/pending-${theme}-${width}.png`,
      });
      const list = panel.locator(".notification-sheet-list");
      expect((await list.boundingBox())!.y - (await panel.boundingBox())!.y).toBeLessThan(110);
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      await expect(page.getByLabel("Fixture result")).toHaveText("fixture-1:1:allow");
      await expect(panel.locator(".approval-toast")).toHaveCount(2);
      const clearBox = (await page
        .getByRole("button", { name: "Clear all", exact: true })
        .boundingBox())!;
      const summaryBox = (await panel.locator(".notification-summary").boundingBox())!;
      expect(
        Math.abs(summaryBox.y + summaryBox.height / 2 - clearBox.y - clearBox.height / 2),
      ).toBeLessThan(4);
      expect(clearBox.x).toBeGreaterThan(summaryBox.x + summaryBox.width);
      await expect(panel.getByText(/What this app announced/)).toHaveCount(0);
      const failed = panel.locator('.notification-history-kind[data-tone="danger"]').first();
      const finished = panel.locator('.notification-history-kind[data-tone="success"]').first();
      // The tone lives on the kind icon; the label next to the project stays plain text.
      const failedIcon = panel.locator('.notification-history-icon[data-tone="danger"]').first();
      const finishedIcon = panel.locator('.notification-history-icon[data-tone="success"]').first();
      await expect(panel.locator(".notification-pending-card")).toBeVisible();
      await expect(failed).toHaveText("Failed");
      await expect(finished).toHaveText("Finished");
      expect(await failedIcon.evaluate((node) => getComputedStyle(node).color)).not.toBe(
        await finishedIcon.evaluate((node) => getComputedStyle(node).color),
      );
      // Requests still pending live in the pending card, not in the recent rows.
      await expect(
        panel.locator(".notification-history-item").getByText("Waiting for you"),
      ).toHaveCount(0);
      const row = panel.locator(".notification-history-item").first();
      const rowToggle = row.locator(".notification-row-toggle");
      await rowToggle.focus();
      await page.keyboard.press("Enter");
      await expect(row.locator(".notification-history-path")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(row.locator(".notification-history-path")).toHaveCount(0);
      expect(await list.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      // A conversation that is gone says so in its row and keeps the panel open.
      const gone = panel.locator(".notification-history-item").filter({ hasText: "old-gone" });
      await gone.locator(".notification-row-toggle").click();
      await gone.getByRole("button", { name: "Open conversation", exact: true }).click();
      await expect(gone.getByText("This conversation is no longer available.")).toBeVisible();
      // One entry leaves on its own; the row is still expanded from the failed open.
      const rows = await panel.locator(".notification-history-item").count();
      await gone.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(panel.locator(".notification-history-item")).toHaveCount(rows - 1);
      await page.screenshot({
        path: `temp/verification/2026-11-11-notification-center/${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Clear all", exact: true }).click();
      await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({
        path: `temp/verification/2026-11-11-notification-center/confirm-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
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
  await page.goto("/tests/browser/notifications/notifications.html?empty");
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  // Nothing waits and nothing is new, but the log still lists what was announced.
  await expect(page.getByText("You're all caught up", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Notification options", exact: true }).click();
  await page.getByRole("switch", { name: "Show request popups", exact: true }).click();
  await page.keyboard.press("Escape");
  // Clearing asks in place, beside the list, and only empties it once the write is confirmed.
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  // A press right after the question opens is its own tail, not an answer.
  await page.waitForTimeout(400);
  await page.screenshot({
    path: "temp/verification/2026-11-11-notification-center/clear-confirm.png",
  });
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("All clear", { exact: true })).toBeVisible();
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
for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`shared request motion ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(`/tests/browser/notifications/notifications.html?theme=${theme}&popup`);
      const floating = page.locator('.notification-request[data-variant="floating"]');
      await expect(floating.first()).toBeVisible();
      await expect(floating.first()).toHaveAttribute("data-enter", "down");
      await expect(floating.first()).toHaveCSS("animation-name", /(^|_)motion-enter(?:_|$)/);
      await expect(floating.first()).toHaveCSS("opacity", "1");
      await page.screenshot({
        path: `temp/verification/component-inventory-skills/requests-floating-${theme}-${width}.png`,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(floating.first()).toHaveCSS("animation-name", "none");
      await page.getByRole("button", { name: "Notifications", exact: true }).click();
      const inline = page
        .getByRole("dialog", { name: "Notifications", exact: true })
        .locator(".notification-request");
      await expect(inline.first()).toHaveAttribute("data-variant", "row");
      await expect(inline.first()).not.toHaveAttribute("data-enter", "down");
      await expect(inline.first()).toHaveCSS("animation-name", "none");
      await page.screenshot({
        path: `temp/verification/component-inventory-skills/requests-inline-${theme}-${width}.png`,
      });
    });
  }
