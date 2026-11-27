import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  for (const width of [800, 1280]) {
    test(`batched owner approvals in ${theme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 560 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/notifications/notifications.html?owner&theme=${theme}`);
      await page.getByRole("button", { name: "Request several approvals" }).click();
      const card = page.locator("[data-chat-column]").first();
      await expect(card.getByText("4 requests need approval")).toBeVisible();
      await card.getByRole("button", { name: "Approve", exact: true }).click();
      await card.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(card.getByText("Command: rm -rf dist")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/owner-approval/batch-chat-${theme}-${width}.png`,
      });
      const composer = page
        .getByRole("region", { name: "Turn activity" })
        .getByText("Needs your input", { exact: true });
      const bounds = (await card.boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThanOrEqual((await composer.boundingBox())!.y);
      await card.getByRole("button", { name: "Deny", exact: true }).click();

      await page.getByRole("button", { name: "Open settings" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("4 requests need approval")).toBeVisible();
      await expect(dialog.getByText("Command: git push origin main")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Later", exact: true })).toBeFocused();
      await page.screenshot({
        path: `temp/verification/owner-approval/batch-dialog-${theme}-${width}.png`,
      });

      // Later hides the batch without answering it; the conversation still shows it.
      await dialog.getByRole("button", { name: "Later", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByLabel("Batch result")).toHaveText("Pending");
      await page.getByRole("button", { name: "Open chat" }).click();
      await expect(card.getByText("4 requests need approval")).toBeVisible();
      await page.getByRole("button", { name: "Open settings" }).click();
      await expect(dialog).toHaveCount(0);

      // A new request opens the dialog again; Go goes to the conversation that asked.
      await page.getByRole("button", { name: "Request approval" }).click();
      await expect(dialog.getByText("Needs approval", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
      await page.screenshot({
        path: `temp/verification/owner-approval/single-dialog-${theme}-${width}.png`,
      });
      await dialog.getByRole("button", { name: "Go", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(card.getByText("5 requests need approval")).toBeVisible();
      await card.getByRole("button", { name: "Deny", exact: true }).click();
      await card.getByRole("button", { name: "Deny", exact: true }).click();
      await page.screenshot({
        path: `temp/verification/owner-approval/review-chat-${theme}-${width}.png`,
      });
      await card.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByLabel("Batch result")).toHaveText("AADD");
    });
  }
}

for (const theme of ["dark", "light"]) {
  for (const width of [800, 1280]) {
    test(`owner approval stays above the composer in ${theme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 560 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/notifications/notifications.html?owner&theme=${theme}`);
      await page.getByRole("button", { name: "Request approval" }).click();
      const card = page.locator("[data-chat-column]").first();
      const composer = page
        .getByRole("region", { name: "Turn activity" })
        .getByText("Needs your input", { exact: true });
      await card.getByText("Details", { exact: true }).click();
      const bounds = (await card.boundingBox())!;
      const composerBounds = (await composer.boundingBox())!;
      expect(composerBounds.y + composerBounds.height).toBeLessThanOrEqual(560);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(composerBounds.y);
      await page.screenshot({
        path: `temp/verification/owner-approval/chat-${theme}-${width}.png`,
      });
      const details = card.getByRole("region", { name: "Details", exact: true });
      const end = card.getByText("End of comment", { exact: true });
      await expect(end).not.toBeInViewport();
      await details.focus();
      await page.keyboard.press("End");
      await expect(end).toBeInViewport();
      await card.getByText("Details", { exact: true }).click();
      await expect(end).toBeHidden();

      await page.getByRole("button", { name: "Review", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(card.getByRole("button", { name: "Approve", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Open settings" }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Later", exact: true })).toBeFocused();
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
      // The dialog names the project and conversation that asked.
      await expect(dialog.locator(".notification-request-source")).toContainText(
        "Release checklist review",
      );
      await page.screenshot({
        path: `temp/verification/2026-11-26-owner-request-row/dialog-${theme}-${width}.png`,
      });
      await dialog.getByText("Exact request text", { exact: true }).click();
      await expect(
        dialog.getByText("Exact request for PFDEV-1123", { exact: false }),
      ).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Approve", exact: true })).toBeInViewport();
      await dialog.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    });
  }
}

for (const theme of ["dark", "light"]) {
  for (const width of [800, 1280]) {
    test(`${theme} at ${width}px: toast placement and retained history`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/notifications/notifications.html?toasts&theme=${theme}`);
      const routine = page.locator('[data-toast-region="top-end"]');
      const alerts = page.locator('[data-toast-region="top-center"]');
      await expect(routine).toContainText("Harness updates available");
      await expect(routine).toContainText("Update complete");
      await expect(alerts).toContainText("Connection interrupted");
      await expect(alerts).toContainText("Update failed");
      await expect(alerts).not.toContainText("Harness updates available");
      const routineBox = (await routine.locator("[data-toast-item]").first().boundingBox())!;
      expect(routineBox.x + routineBox.width).toBeGreaterThan(width - 30);
      if (width === 800) {
        await expect
          .poll(async () => {
            const alertBox = (await alerts.locator("[data-toast-stack]").boundingBox())!;
            const box = (await routine.locator("[data-toast-stack]").boundingBox())!;
            return box.y >= alertBox.y + alertBox.height;
          })
          .toBe(true);
      }
      for (const [name, region] of [
        ["routine", routine],
        ["alerts", alerts],
      ] as const) {
        await region.locator("[data-toast-stack]").hover();
        await expect(region.locator("[data-toast-item]").first()).toHaveAttribute(
          "data-expanded",
          "true",
        );
        await page.screenshot({
          path: `temp/verification/notice-routing/${name}-${theme}-${width}.png`,
        });
      }
      for (const region of [alerts, routine]) {
        for (const remaining of [1, 0]) {
          await region
            .locator('[data-toast-item][data-front="true"]:not([data-toast-leaving])')
            .getByRole("button", { name: "Dismiss notice", exact: true })
            .click();
          await expect(region.locator("[data-toast-item]:not([data-toast-leaving])")).toHaveCount(
            remaining,
          );
        }
      }
      await page.getByRole("button", { name: "Notifications", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "Notifications", exact: true });
      await expect(panel.locator(".notification-history-item")).toHaveCount(4);
      await expect(panel).toContainText("Grok Build: access denied");
      await expect(panel).toContainText("Claude Code: 2.1.325");
      await page.screenshot({
        path: `temp/verification/notice-routing/history-${theme}-${width}.png`,
      });
      // Reopen without producing the same toasts again: only persisted entries can satisfy this check.
      await page.goto(`/tests/browser/notifications/notifications.html?empty&theme=${theme}`);
      await page.getByRole("button", { name: "Notifications", exact: true }).click();
      await expect(
        page
          .getByRole("dialog", { name: "Notifications", exact: true })
          .locator(".notification-history-item"),
      ).toHaveCount(4);
      await expect(page.getByRole("dialog", { name: "Notifications", exact: true })).toContainText(
        "Grok Build: access denied",
      );
    });
  }
}

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
      const owner = panel.locator(".notification-owner-request");
      await expect(owner).toHaveCount(1);
      await expect(owner.locator(".notification-request-title")).toHaveText(
        "Run the release script",
      );
      await expect(owner.locator(".notification-request-source")).toContainText(
        "Dev uygulamasının yavaş açılma nedeni",
      );
      await expect(owner).toContainText("left");
      await expect(owner.getByRole("button", { name: "Go", exact: true })).toBeVisible();
      await expect(owner.getByRole("button", { name: "Answer", exact: true })).toBeVisible();
      await expect(owner).not.toContainText("pnpm release");
      await page.screenshot({
        path: `temp/verification/2026-11-26-owner-request-row/pending-${theme}-${width}.png`,
      });
      const list = panel.locator(".notification-sheet-list");
      expect((await list.boundingBox())!.y - (await panel.boundingBox())!.y).toBeLessThan(110);
      // The sheet decides nothing in place: Answer opens the approval in a dialog.
      await expect(panel.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0);
      await panel
        .locator(".approval-toast")
        .filter({ has: page.getByRole("button", { name: "Go", exact: true }) })
        .first()
        .getByRole("button", { name: "Answer", exact: true })
        .click();
      await expect(panel).toHaveCount(0);
      const answer = page.getByRole("dialog");
      await expect(answer.getByRole("button", { name: "Go", exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-26-owner-request-row/approval-dialog-${theme}-${width}.png`,
      });
      await answer.getByRole("button", { name: "Allow", exact: true }).click();
      await expect(page.getByLabel("Fixture result")).toHaveText("fixture-1:1:allow");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: "Notifications", exact: true }).click();
      await expect(panel.locator(".approval-toast")).toHaveCount(2);
      // Clearing history lives in the options popover, not the sheet header.
      await expect(page.getByRole("button", { name: "Clear all", exact: true })).toHaveCount(0);
      await expect(panel.getByText(/What this app announced/)).toHaveCount(0);
      // Only a problem carries a glyph; finished rows have no "Finished" label. The tone lives on
      // the icon slot.
      const failedIcon = panel.locator('.notification-history-icon[data-tone="danger"]').first();
      await expect(panel.locator(".notification-pending-card")).toBeVisible();
      await expect(failedIcon.locator("> *")).toBeVisible();
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
      await gone.getByRole("button", { name: "Open", exact: true }).click();
      await expect(page.getByText("This conversation is no longer available.")).toBeVisible();
      // One entry leaves on its own; the row is still expanded from the failed open.
      const rows = await panel.locator(".notification-history-item").count();
      await gone.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(panel.locator(".notification-history-item")).toHaveCount(rows - 1);
      await page.screenshot({
        path: `temp/verification/2026-11-11-notification-center/${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Notification options", exact: true }).click();
      await page.getByRole("button", { name: "Clear all", exact: true }).click();
      await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({
        path: `temp/verification/2026-11-11-notification-center/confirm-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
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
  await expect(page.getByText("waiting for your answer")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Notifications", exact: true }).getByRole("article").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Notification options", exact: true }).click();
  await page.getByRole("switch", { name: "Show request popups", exact: true }).click();
  // Clearing asks in place, in the options popover, and only empties it once the write is confirmed.
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

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`options popover rows share one inset ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/notifications/notifications.html?theme=${theme}`);
      await page.getByRole("button", { name: "Notifications", exact: true }).click();
      await page.getByRole("button", { name: "Notification options", exact: true }).click();
      const settings = page.getByRole("region", { name: "Notification options", exact: true });
      const box = async (role: "switch" | "button", name: string, text = false) => {
        const control = settings.getByRole(role, { name, exact: true });
        return (await (text ? control.getByText(name, { exact: true }) : control).boundingBox())!;
      };
      // Text rows share one inset; the bordered Clear all starts at the rows' own edge.
      const switchText = (await box("switch", "Show request popups", true)).x;
      expect(Math.abs(switchText - (await box("button", "Hide all popups", true)).x)).toBeLessThan(
        2,
      );
      const rowEdge = (await box("button", "Hide all popups")).x;
      expect(Math.abs(rowEdge - (await box("button", "Clear all")).x)).toBeLessThan(2);
      await settings.screenshot({
        path: `temp/verification/2026-11-26-notification-options/options-${theme}-${width}.png`,
      });
    });
  }

for (const theme of ["light", "dark"])
  test(`a missing conversation reports once, as a toast ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/notifications/notifications.html?theme=${theme}`);
    await page.getByRole("button", { name: "Notifications", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Notifications", exact: true });
    const gone = panel.locator(".notification-history-item").filter({ hasText: "old-gone" });
    await gone.locator(".notification-row-toggle").click();
    await gone.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByText("This conversation is no longer available.")).toHaveCount(1);
    await expect(gone.getByText("This conversation is no longer available.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Details", exact: true })).toHaveCount(0);
    await expect(panel).toBeVisible();
    await page.screenshot({
      path: `temp/verification/2026-11-26-notification-options/missing-toast-${theme}.png`,
    });
  });
