import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["dark", "light"]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`worktree management: ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/worktrees.html?theme=${theme}`);
      const surface = page.locator('[data-setting-id="project-worktrees"]');
      const list = surface.getByRole("list", { name: "Worktrees", exact: true });
      await expect(list.getByRole("listitem")).toHaveCount(4);
      await expect(
        surface.getByRole("button", { name: "Create worktree", exact: true }),
      ).toBeEnabled();
      await expect(
        surface.getByRole("button", { name: "Reveal fix/missing", exact: true }),
      ).toBeDisabled();
      const locked = list
        .getByRole("listitem")
        .filter({ hasText: "Unlock this worktree in Git first" });
      await expect(locked.getByRole("button", { name: /^Delete / })).toBeDisabled();
      const details = surface.locator('[data-setting-id="worktree-location"]');
      await expect(details.getByRole("button", { name: "Details", exact: true })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      const dialog = page.getByRole("dialog", { name: "Worktrees", exact: true });
      const panel = await dialog.boundingBox();
      const content = await surface.boundingBox();
      expect(content!.x - panel!.x).toBeGreaterThanOrEqual(16);
      expect(panel!.x + panel!.width - content!.x - content!.width).toBeGreaterThanOrEqual(16);
      const overflow = await surface.evaluate((node) => ({
        content: node.scrollWidth,
        available: node.clientWidth,
        page: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(overflow.content).toBeLessThanOrEqual(overflow.available + 1);
      expect(overflow.page).toBeLessThanOrEqual(overflow.viewport + 1);
      mkdirSync("temp/verification/2026-10-18-worktrees", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-10-18-worktrees/${theme}-${width}.png`,
      });
      const search = surface.getByRole("textbox", { name: "Search worktrees", exact: true });
      await search.fill("MC/851");
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await search.fill("no-such-worktree");
      await expect(surface.getByRole("status").filter({ hasText: "No results" })).toBeVisible();
      await surface
        .getByRole("status")
        .filter({ hasText: "No results" })
        .getByRole("button", { name: "Clear search", exact: true })
        .click();
      await expect(list.getByRole("listitem")).toHaveCount(4);
      await details.getByRole("button", { name: "Details", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(details.getByRole("button", { name: "Details", exact: true })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await page.keyboard.press("Enter");
      await expect(details.getByRole("button", { name: "Details", exact: true })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(details).toContainText("New worktrees are created in");
      await page.screenshot({
        path: `temp/verification/2026-10-18-worktrees/${theme}-${width}-details.png`,
      });
      expect(errors).toEqual([]);
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`managed policy and cleanup: ${theme} ${width}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tests/browser/worktrees.html?managed&theme=${theme}`);
      const surface = page.getByTestId("workspace-policy-settings");
      await expect(
        surface.getByRole("button", { name: "Save workspace policy", exact: true }),
      ).toBeDisabled();
      await expect(surface.getByText("Cleanup blocked", { exact: true })).toBeVisible();
      await expect(surface.getByText("Pinned", { exact: true })).toBeVisible();
      await expect(surface.getByText("New workspaces are paused.", { exact: false })).toBeVisible();
      mkdirSync("temp/verification/s5", { recursive: true });
      await page.screenshot({
        path: `temp/verification/s5/workspace-policy-${theme}-${width}.png`,
      });
      const retention = surface.locator('[data-setting-id="workspace-retention"]');
      await retention.getByRole("button", { name: "Directory retention", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(retention.getByText("Never", { exact: true }).first()).toBeVisible();
      await retention.getByRole("button", { name: /^Idle retention:/ }).click();
      await page.getByRole("option", { name: "Never", exact: true }).click();
      await surface.getByRole("checkbox", { name: "Pin new workspaces", exact: true }).check();
      const save = surface.getByRole("button", { name: "Save workspace policy", exact: true });
      await expect(save).toBeEnabled();
      await save.click();
      await expect(surface.getByText("Saved", { exact: true })).toBeVisible();
      const calls = await page.evaluate(
        () =>
          (
            window as unknown as {
              workspaceFixtureCalls: { method: string; params: Record<string, unknown> }[];
            }
          ).workspaceFixtureCalls,
      );
      const update = calls.find((call) => call.method === "projects.workspacePolicy.update")!;
      expect(update.params).toMatchObject({
        projectId: "workspace-fixture-project",
        environmentId: "workspace-fixture-env",
        expectedRevision: 1,
        policy: { pinned: true, retention: { active: "never", idle: "never" } },
      });
      expect(update.params.idempotencyKey).toBeTruthy();
      await page.screenshot({
        path: `temp/verification/s5/workspace-retention-${theme}-${width}.png`,
      });
      const disk = surface.locator('[data-setting-id="workspace-disk-policy"]');
      await disk.getByRole("button", { name: "Storage limits", exact: true }).click();
      await disk
        .getByRole("spinbutton", { name: "Directory budget (GiB)", exact: true })
        .fill("60");
      await save.click();
      await expect(surface.getByText("Saved", { exact: true })).toBeVisible();
      await surface.getByText("Cache and recovery storage", { exact: true }).click();
      await expect(surface.getByText("Unknown", { exact: true })).toBeVisible();
      await disk.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/s5/workspace-storage-${theme}-${width}.png`,
      });
      await surface.getByRole("button", { name: "Review blocked cleanup", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete worktree directory", exact: true });
      await expect(dialog).toBeVisible();
      await page.screenshot({
        path: `temp/verification/s5/workspace-cleanup-${theme}-${width}.png`,
      });
      const before = await page.evaluate(
        () =>
          (
            window as unknown as { workspaceFixtureCalls: { method: string }[] }
          ).workspaceFixtureCalls.filter((call) => call.method === "workspaces.cleanup.apply")
            .length,
      );
      expect(before).toBe(0);
      await dialog.getByRole("button", { name: "Delete directory", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(surface.getByText("Directory removed", { exact: true })).toBeVisible();
      const after = await page.evaluate(() =>
        (
          window as unknown as {
            workspaceFixtureCalls: { method: string; params: Record<string, unknown> }[];
          }
        ).workspaceFixtureCalls.find((call) => call.method === "workspaces.cleanup.apply"),
      );
      expect(after?.params).toMatchObject({
        workspaceId: "managed-blocked",
        expectedRevision: 1,
        planToken: "fingerprint-bound-cleanup",
      });
      expect(after?.params.idempotencyKey).toBeTruthy();
      expect(await surface.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    });
  }
}

test("older Host explains update; failed policy save keeps the draft", async ({ page }) => {
  await page.goto("/tests/browser/worktrees.html?theme=light");
  await expect(
    page.getByText("Update the execution Host to configure worktree defaults and retention.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/tests/browser/worktrees.html?managed&saveError&theme=light");
  const surface = page.getByTestId("workspace-policy-settings");
  await surface.getByRole("checkbox", { name: "Pin new workspaces", exact: true }).check();
  await surface.getByRole("button", { name: "Save workspace policy", exact: true }).click();
  await expect(surface.getByRole("alert")).toContainText("Fixture policy save failed");
  await expect(
    surface.getByRole("checkbox", { name: "Pin new workspaces", exact: true }),
  ).toBeChecked();
  await expect(
    surface.getByRole("button", { name: "Save workspace policy", exact: true }),
  ).toBeEnabled();
});

test("cleanup blockers prevent owner removal and preserve unsaved policy", async ({ page }) => {
  await page.goto("/tests/browser/worktrees.html?managed&hardBlock&theme=light");
  const surface = page.getByTestId("workspace-policy-settings");
  await surface.getByRole("checkbox", { name: "Pin new workspaces", exact: true }).check();
  await surface.getByRole("button", { name: "Review blocked cleanup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete worktree directory", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("An editor still has unsaved changes");
  await expect(
    dialog.getByRole("button", { name: "Delete directory", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    surface.getByRole("checkbox", { name: "Pin new workspaces", exact: true }),
  ).toBeChecked();
  await expect(
    surface.getByRole("button", { name: "Save workspace policy", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { workspaceFixtureCalls: { method: string }[] }
      ).workspaceFixtureCalls.some((call) => call.method === "workspaces.cleanup.apply"),
    ),
  ).toBe(false);
});

test("individual pinning persists and older pinning capability is explicit", async ({ page }) => {
  await page.goto("/tests/browser/worktrees.html?managed&theme=light");
  const list = page.getByRole("region", { name: "Managed workspace directories", exact: true });
  const workspace = list.getByRole("listitem").filter({ hasText: "bycoda/s/settings-draft" });
  await workspace.getByRole("button", { name: "Unpin workspace", exact: true }).click();
  await expect(workspace.getByRole("button", { name: "Pin workspace", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            workspaceFixtureCalls: { method: string; params: Record<string, unknown> }[];
          }
        ).workspaceFixtureCalls.find((call) => call.method === "workspaces.pin")?.params,
    ),
  ).toMatchObject({ workspaceId: "managed-blocked", expectedRevision: 1, pinned: false });
  await page.goto("/tests/browser/worktrees.html?managed&noPinning&theme=light");
  await expect(
    page.getByText("Update the execution Host to pin or unpin individual workspaces.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Unpin workspace", exact: true })).toBeDisabled();
});
