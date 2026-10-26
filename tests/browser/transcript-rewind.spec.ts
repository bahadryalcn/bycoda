import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const width of [390, 1000]) {
  test(`rewind actions identify their message at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tests/browser/transcript.html?rewind", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Stopped by you", { exact: true })).toBeVisible();
    const wrong = page.locator('[data-prompt-anchor="wrong-request"]');
    const prior = page.locator('[data-prompt-anchor="prior-request"]');
    const actions = wrong.getByRole("button", { name: "Message actions", exact: true });
    await actions.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Edit this message", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { lastRewind: unknown }).lastRewind))
      .toEqual({ blockId: "wrong-request", action: "edit" });
    await prior.getByRole("button", { name: "Message actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Return before this message", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { lastRewind: unknown }).lastRewind))
      .toEqual({ blockId: "prior-request", action: "return" });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`managed rewind previews files and supports undo at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/workspace-rewind.html");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const trigger = page.getByRole("button", {
        name: "Return before the later change",
        exact: true,
      });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", {
        name: "Rewind conversation and files",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Turns: 1 · Commits: 2 · Files: 3");
      await expect(dialog).toContainText("Main is not rewound");
      await dialog.locator("summary").click();
      await expect(dialog).toContainText("src/features/workspaces/model/rewindClient.ts");
      await mkdir("temp/verification/s5", { recursive: true });
      await page.screenshot({
        path: `temp/verification/s5/rewind-preview-${width}-${theme}.png`,
        animations: "disabled",
      });
      const apply = dialog.getByRole("button", {
        name: "Rewind conversation and files",
        exact: true,
      });
      await apply.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).not.toBeVisible();
      await expect(page.locator('[data-block="second"]')).toHaveCount(0);
      const undo = page.getByRole("button", { name: "Undo rewind", exact: true });
      await expect(undo).toBeVisible();
      await page.screenshot({
        path: `temp/verification/s5/rewind-result-${width}-${theme}.png`,
        animations: "disabled",
      });
      await undo.click();
      const undoDialog = page.getByRole("dialog", { name: "Undo rewind", exact: true });
      await expect(undoDialog).toBeVisible();
      await page.screenshot({
        path: `temp/verification/s5/rewind-undo-${width}-${theme}.png`,
        animations: "disabled",
      });
      await undoDialog.getByRole("button", { name: "Undo rewind", exact: true }).click();
      await expect(page.locator('[data-block="second"]')).toBeVisible();
      const methods = await page.evaluate(() =>
        (
          window as unknown as { rewindFixtureCalls: Array<{ method: string }> }
        ).rewindFixtureCalls.map((call) => call.method),
      );
      expect(methods.filter((method) => method === "sessions.rewind.apply")).toHaveLength(1);
      expect(methods.filter((method) => method === "sessions.rewind.undo")).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }

for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`expired rewind preview explains recovery at ${width}px ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.clock.install({ time: new Date("2026-10-26T12:00:00Z") });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/workspace-rewind.html");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const trigger = page.getByRole("button", {
        name: "Return before the later change",
        exact: true,
      });
      const dialog = page.getByRole("dialog", {
        name: "Rewind conversation and files",
        exact: true,
      });
      const apply = dialog.getByRole("button", {
        name: "Rewind conversation and files",
        exact: true,
      });
      await trigger.click();
      await expect(apply).toBeEnabled();
      await page.clock.fastForward(61_000);
      await expect(apply).toBeDisabled();
      await expect(dialog.getByRole("alert")).toHaveText(
        "This rewind preview is blocked or expired. Refresh the preview.",
      );
      if (testInfo.project.name === "chromium") {
        await mkdir("temp/verification/i3", { recursive: true });
        await page.screenshot({
          path: `temp/verification/i3/rewind-expired-${width}-${theme}.png`,
          animations: "disabled",
        });
      }
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.locator('[data-block="second"]')).toBeVisible();
      await trigger.click();
      await expect(apply).toBeEnabled();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      const methods = await page.evaluate(() =>
        (
          window as unknown as { rewindFixtureCalls: Array<{ method: string }> }
        ).rewindFixtureCalls.map((call) => call.method),
      );
      expect(methods.filter((method) => method === "sessions.rewind.plan")).toHaveLength(2);
      expect(methods).not.toContain("sessions.rewind.apply");
    });
  }

test("managed rewind on an older host explains the update without changing history", async ({
  page,
}) => {
  await page.goto("/tests/browser/workspace-rewind.html?olderHost");
  await page.getByRole("button", { name: "Return before the later change", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Update bycoda Host");
  await expect(page.locator('[data-block="second"]')).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("blocked capture keeps rewind unavailable and cancellation preserves history", async ({
  page,
}) => {
  await page.goto("/tests/browser/workspace-rewind.html?blocked");
  await page.getByRole("button", { name: "Return before the later change", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("uncaptured source file");
  await expect(
    dialog.getByRole("button", { name: "Rewind conversation and files", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[data-block="second"]')).toBeVisible();
});

for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`real SessionPane routes managed rewind through its file preview at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/workspace-rewind.html?pane");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const message = page.locator('[data-prompt-anchor="second"]');
      await expect(message).toBeVisible();
      await message.getByRole("button", { name: "Message actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Return before this message", exact: true }).click();
      const preview = page.getByRole("dialog", {
        name: "Rewind conversation and files",
        exact: true,
      });
      await expect(preview).toBeVisible();
      await expect(page.getByText("File changes stay unchanged.", { exact: false })).toHaveCount(0);
      await mkdir("temp/verification/i2a", { recursive: true });
      await page.screenshot({
        path: `temp/verification/i2a/session-pane-rewind-${width}-${theme}.png`,
        animations: "disabled",
      });
      await preview
        .getByRole("button", { name: "Rewind conversation and files", exact: true })
        .click();
      await expect(message).toHaveCount(0);
      await page.reload();
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: "Undo rewind", exact: true }).click();
      const undo = page.getByRole("dialog", { name: "Undo rewind", exact: true });
      await expect(undo).toBeVisible();
      await page.screenshot({
        path: `temp/verification/i2a/session-pane-undo-${width}-${theme}.png`,
        animations: "disabled",
      });
      await undo.getByRole("button", { name: "Undo rewind", exact: true }).click();
      await expect(message).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });

    test(`real remote composer creates a managed workspace at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/workspace-rewind.html?remoteCreate");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await expect(
        page.getByRole("button", { name: "Workspace New worktree", exact: true }),
      ).toBeVisible();
      await page.locator("textarea").fill("Keep this work isolated from main");
      const send = page.getByRole("button", { name: "Send", exact: true });
      await expect(send).toBeEnabled();
      await mkdir("temp/verification/i2a", { recursive: true });
      await page.screenshot({
        path: `temp/verification/i2a/remote-managed-create-${width}-${theme}.png`,
        animations: "disabled",
      });
      await send.click();
      await expect(page.locator("[data-prompt-anchor]")).toContainText(
        "Keep this work isolated from main",
      );
      const calls = await page.evaluate(() => (window as any).rewindFixtureCalls);
      const prepared = calls.find((call: any) => call.method === "workspaces.prepare");
      const created = calls.find(
        (call: any) => call.method === "commands.dispatch" && call.params.type === "create",
      );
      expect(prepared.params.owner.id).toBe(created.params.sessionId);
      expect(created.params.workspaceId).toBe("workspace");
      expect(created.params.worktreeCwd).toBe("C:/fixture/rewind-worktrees/session");
      await page.screenshot({
        path: `temp/verification/i2a/remote-managed-created-${width}-${theme}.png`,
        animations: "disabled",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }

for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`real RemoteSession uses managed rewind and reloadable Undo at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/workspace-rewind.html?remoteRewind");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const message = page.locator('[data-prompt-anchor="second"]');
      await message.getByRole("button", { name: "Message actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Return before this message", exact: true }).click();
      const preview = page.getByRole("dialog", {
        name: "Rewind conversation and files",
        exact: true,
      });
      await expect(preview).toBeVisible();
      expect(await page.evaluate(() => (window as any).tryRemoteSend())).toBe(false);
      await mkdir("temp/verification/i2a", { recursive: true });
      await page.screenshot({
        path: `temp/verification/i2a/remote-managed-rewind-${width}-${theme}.png`,
        animations: "disabled",
      });
      await preview
        .getByRole("button", { name: "Rewind conversation and files", exact: true })
        .click();
      await expect(message).toHaveCount(0);
      await page.reload();
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: "Undo rewind", exact: true }).click();
      const undo = page.getByRole("dialog", { name: "Undo rewind", exact: true });
      await expect(undo).toBeVisible();
      expect(await page.evaluate(() => (window as any).tryRemoteSend())).toBe(false);
      await page.screenshot({
        path: `temp/verification/i2a/remote-managed-undo-${width}-${theme}.png`,
        animations: "disabled",
      });
      await undo.getByRole("button", { name: "Undo rewind", exact: true }).click();
      await expect(message).toBeVisible();
      const commands = await page.evaluate(() =>
        (window as any).rewindFixtureCalls.filter(
          (call: any) => call.method === "commands.dispatch",
        ),
      );
      expect(commands).toEqual([]);
    });
  }

test("managed native rewind refuses an unconfirmed provider retirement", async ({ page }) => {
  await page.goto("/tests/browser/workspace-rewind.html?pane&retireUnknown");
  const message = page.locator('[data-prompt-anchor="second"]');
  await message.getByRole("button", { name: "Message actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Return before this message", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The conversation could not be rewound");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(message).toBeVisible();
  const methods = await page.evaluate(() =>
    (window as any).rewindFixtureCalls.map((call: any) => call.method),
  );
  expect(methods).toContain("provider.stop");
  expect(methods).not.toContain("sessions.rewind.plan");
  expect(methods).not.toContain("sessions.rewind.apply");
});
