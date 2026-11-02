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
      const list = surface.getByRole("list", {
        name: "Worktrees",
        exact: true,
      });
      await expect(list.getByRole("listitem")).toHaveCount(4);
      await expect(
        surface.getByRole("button", { name: "Create worktree", exact: true }),
      ).toBeEnabled();
      await expect(
        surface.getByRole("button", {
          name: "Reveal fix/missing",
          exact: true,
        }),
      ).toBeDisabled();
      const locked = list
        .getByRole("listitem")
        .filter({ hasText: "Unlock this worktree in Git first" });
      // Deletion lives in the row action menu; a locked worktree offers it disabled.
      await locked.getByRole("button", { name: /^Actions for / }).click();
      await expect(page.getByRole("menuitem", { name: /^Delete / })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      const details = surface.locator('[data-setting-id="worktree-location"]');
      // The location sits in the page header: always visible, never behind a disclosure.
      await expect(details).toBeVisible();
      await expect(details).toContainText("New worktrees are created in");
      const dialog = page.getByRole("dialog", {
        name: "Worktrees",
        exact: true,
      });
      const panel = await dialog.boundingBox();
      const content = await surface.boundingBox();
      expect(content!.x - panel!.x).toBeGreaterThanOrEqual(16);
      expect(panel!.x + panel!.width - content!.x - content!.width).toBeGreaterThanOrEqual(16);
      // Open topics bleed 12px into the dialog gutter by design, so overflow is measured as
      // content escaping the panel or a horizontally scrolling ancestor, not the surface box.
      const overflow = await surface.evaluate((node) => {
        const panelBox = node.closest('[role="dialog"]')!.getBoundingClientRect();
        let scrolling = 0;
        for (let up = node.parentElement; up; up = up.parentElement) {
          if (up.scrollWidth > up.clientWidth + 1) scrolling += 1;
        }
        const escaped = [...node.querySelectorAll("*")].filter((child) => {
          const box = child.getBoundingClientRect();
          return box.width > 0 && (box.left < panelBox.left - 1 || box.right > panelBox.right + 1);
        }).length;
        return {
          content: escaped + scrolling,
          page: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        };
      });
      expect(overflow.content).toBe(0);
      expect(overflow.page).toBeLessThanOrEqual(overflow.viewport + 1);
      mkdirSync("temp/verification/2026-10-18-worktrees", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-10-18-worktrees/${theme}-${width}.png`,
      });
      const search = surface.getByRole("textbox", {
        name: "Search worktrees",
        exact: true,
      });
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
      await expect(surface.getByText("Cleanup blocked", { exact: true })).toBeVisible();
      await expect(surface.getByText("Pinned", { exact: true })).toBeVisible();
      // The policy is a closed disclosure in the Worktrees dialog; Save appears once edited.
      await surface.getByRole("button", { name: "Workspace policy", exact: true }).click();
      await expect(
        surface.getByRole("button", {
          name: "Save workspace policy",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(surface.getByText("New workspaces are paused.", { exact: false })).toBeVisible();
      mkdirSync("temp/verification/s5", { recursive: true });
      await page.screenshot({
        path: `temp/verification/s5/workspace-policy-${theme}-${width}.png`,
      });
      const retention = surface.locator('[data-setting-id="workspace-retention"]');
      await retention.getByRole("button", { name: /^Directory retention/ }).focus();
      await page.keyboard.press("Enter");
      await expect(retention.getByText("Never", { exact: true }).first()).toBeVisible();
      await retention.getByRole("button", { name: /^Idle retention:/ }).click();
      await page.getByRole("option", { name: "Never", exact: true }).click();
      await surface.getByRole("switch", { name: "Pin new workspaces", exact: true }).click();
      const save = surface.getByRole("button", {
        name: "Save workspace policy",
        exact: true,
      });
      await expect(save).toBeEnabled();
      await save.click();
      await expect(surface.getByText("Saved", { exact: true })).toBeVisible();
      const calls = await page.evaluate(
        () =>
          (
            window as unknown as {
              workspaceFixtureCalls: {
                method: string;
                params: Record<string, unknown>;
              }[];
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
      await disk.getByRole("button", { name: /^Storage limits/ }).click();
      await disk
        .getByRole("spinbutton", {
          name: "Directory budget (GiB)",
          exact: true,
        })
        .fill("60");
      await save.click();
      await expect(surface.getByText("Saved", { exact: true })).toBeVisible();
      await surface.getByText("Cache and recovery storage", { exact: true }).click();
      await expect(surface.getByText("Unknown", { exact: true })).toBeVisible();
      await disk.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/s5/workspace-storage-${theme}-${width}.png`,
      });
      await surface
        .getByRole("listitem")
        .filter({ hasText: "Cleanup blocked" })
        .getByRole("button", { name: "More actions", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Review blocked cleanup", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "Delete worktree directory",
        exact: true,
      });
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
            workspaceFixtureCalls: {
              method: string;
              params: Record<string, unknown>;
            }[];
          }
        ).workspaceFixtureCalls.find((call) => call.method === "workspaces.cleanup.apply"),
      );
      expect(after?.params).toMatchObject({
        workspaceId: "managed-blocked",
        expectedRevision: 1,
        planToken: "fingerprint-bound-cleanup",
      });
      expect(after?.params.idempotencyKey).toBeTruthy();
      // Open topics bleed into the gutter by design: nothing may escape the panel and no
      // container at or above the dialog may scroll horizontally.
      expect(
        await surface.evaluate((node) => {
          const panel = node.closest<HTMLElement>('[role="dialog"]')!;
          const box = panel.getBoundingClientRect();
          for (let up: HTMLElement | null = panel; up; up = up.parentElement)
            if (up.scrollWidth > up.clientWidth + 1) return false;
          return [...node.querySelectorAll("*")].every((child) => {
            const rect = child.getBoundingClientRect();
            return rect.width === 0 || (rect.left >= box.left - 1 && rect.right <= box.right + 1);
          });
        }),
      ).toBe(true);
    });
  }
}

test("older Host explains update; failed policy save keeps the draft", async ({ page }) => {
  await page.goto("/tests/browser/worktrees.html?theme=light");
  await page.getByRole("button", { name: "Workspace policy", exact: true }).click();
  await expect(
    page.getByText("Update the execution Host to configure worktree defaults and retention.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/tests/browser/worktrees.html?managed&saveError&theme=light");
  const surface = page.getByTestId("workspace-policy-settings");
  await surface.getByRole("button", { name: "Workspace policy", exact: true }).click();
  await surface.getByRole("switch", { name: "Pin new workspaces", exact: true }).click();
  await surface.getByRole("button", { name: "Save workspace policy", exact: true }).click();
  await expect(surface.getByRole("alert")).toContainText("Fixture policy save failed");
  await expect(
    surface.getByRole("switch", { name: "Pin new workspaces", exact: true }),
  ).toBeChecked();
  await expect(
    surface.getByRole("button", { name: "Save workspace policy", exact: true }),
  ).toBeEnabled();
});

test("cleanup blockers prevent owner removal and preserve unsaved policy", async ({ page }) => {
  await page.goto("/tests/browser/worktrees.html?managed&hardBlock&theme=light");
  const surface = page.getByTestId("workspace-policy-settings");
  await surface.getByRole("button", { name: "Workspace policy", exact: true }).click();
  await surface.getByRole("switch", { name: "Pin new workspaces", exact: true }).click();
  await surface
    .getByRole("listitem")
    .filter({ hasText: "Cleanup blocked" })
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Review blocked cleanup", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete worktree directory",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toContainText("An editor still has unsaved changes");
  await expect(
    dialog.getByRole("button", { name: "Delete directory", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    surface.getByRole("switch", { name: "Pin new workspaces", exact: true }),
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
  const list = page.getByRole("list", { name: "Worktrees", exact: true });
  const workspace = list.getByRole("listitem").filter({ hasText: "bycoda/s/settings-draft" });
  const actions = workspace.getByRole("button", {
    name: "More actions",
    exact: true,
  });
  await actions.click();
  await page.getByRole("menuitem", { name: "Unpin workspace", exact: true }).click();
  await expect(workspace.getByText("Pinned", { exact: true })).toHaveCount(0);
  await actions.click();
  await expect(page.getByRole("menuitem", { name: "Pin workspace", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            workspaceFixtureCalls: {
              method: string;
              params: Record<string, unknown>;
            }[];
          }
        ).workspaceFixtureCalls.find((call) => call.method === "workspaces.pin")?.params,
    ),
  ).toMatchObject({
    workspaceId: "managed-blocked",
    expectedRevision: 1,
    pinned: false,
  });
  await page.goto("/tests/browser/worktrees.html?managed&noPinning&theme=light");
  await expect(
    page.getByText("Update the execution Host to pin or unpin individual workspaces.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("list", { name: "Worktrees", exact: true })
    .getByRole("listitem")
    .filter({ hasText: "bycoda/s/settings-draft" })
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  await expect(page.getByRole("menuitem", { name: "Unpin workspace", exact: true })).toBeDisabled();
});

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`managed directory review entry point: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/worktrees.html?managed&theme=${theme}`);
      const list = page.getByRole("list", { name: "Worktrees", exact: true });
      await list.getByRole("button", { name: "Review changes", exact: true }).first().focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", {
        name: "Review changes",
        exact: true,
      });
      await expect(dialog).toContainText("src/example.ts");
      await expect(dialog).toContainText("artifacts/acceptance.png");
      await expect(dialog).toContainText("fixture-artifact-sha256");
      await expect(
        dialog.getByRole("button", { name: "Merge into main", exact: true }),
      ).toBeEnabled();
      await expect(dialog.getByRole("button", { name: "Create PR", exact: true })).toBeEnabled();
      await dialog.focus();
      await page.mouse.move(4, 4);
      mkdirSync("temp/verification/i2a", { recursive: true });
      await page.screenshot({
        path: `temp/verification/i2a/managed-review-${theme}-${width}.png`,
        fullPage: true,
      });
      await dialog
        .getByRole("contentinfo")
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Worktrees", exact: true })
        .locator(".overflow-y-auto")
        .evaluate((element) => {
          element.scrollTop = 0;
        });
      await page.getByRole("dialog", { name: "Worktrees", exact: true }).focus();
      await page.mouse.move(4, 4);
      await page.screenshot({
        path: `temp/verification/i2a/managed-policy-${theme}-${width}.png`,
        fullPage: true,
      });
    });
  }

const l3Directory = "temp/verification/2026-10-28-ui-redesign/l3";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`populated source control composition: ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tests/browser/worktrees.html?populated&theme=${theme}`);
      const root = page.getByTestId("populated-settings");
      const prefs = root.locator(".source-control-settings");
      const repo = root.locator('[data-setting-id="project-worktrees"]');
      const policy = repo.getByTestId("workspace-policy-settings");
      // Below global preferences the policy is open; Save appears once it is edited.
      await expect(policy.locator('[data-setting-id="workspace-policy"]')).toBeVisible();
      const trees = repo.getByRole("list", { name: "Worktrees", exact: true });
      await expect(trees.getByRole("listitem").first()).toBeVisible();

      // The repository boundary is one distinct, named heading.
      const boundaryHeading = repo.getByRole("heading", {
        name: "Worktrees",
        exact: true,
        level: 2,
      });
      await expect(boundaryHeading).toHaveCount(1);

      // Global Git preferences are structurally and visually apart from repository management.
      expect(
        await prefs.evaluate((node) =>
          node.contains(document.querySelector('[data-setting-id="project-worktrees"]')),
        ),
      ).toBe(false);
      const prefsBox = (await prefs.boundingBox())!;
      const boundary = (await boundaryHeading.boundingBox())!;
      expect(boundary.y).toBeGreaterThanOrEqual(prefsBox.y + prefsBox.height + 16);

      // Managed directories and other worktrees share one bounded (scrolling), searchable list.
      await trees.scrollIntoViewIfNeeded();
      const metrics = await trees.evaluate((node) => ({
        client: node.clientHeight,
        scroll: node.scrollHeight,
        limit: 30 * parseFloat(getComputedStyle(document.documentElement).fontSize),
      }));
      expect(metrics.scroll).toBeGreaterThan(metrics.client);
      expect(metrics.client).toBeLessThanOrEqual(metrics.limit + 1);
      const treeSearch = repo.getByRole("textbox", {
        name: "Search worktrees",
        exact: true,
      });
      await treeSearch.fill("archive-search");
      await expect(trees.getByRole("listitem")).toHaveCount(1);
      await treeSearch.fill("spike/ui");
      await expect(trees.getByRole("listitem")).toHaveCount(2);
      await treeSearch.fill("");

      // Every worktree status the page can show is reachable.
      for (const text of [
        "Clean",
        "Uncommitted changes",
        "Missing folder",
        "Publication unknown",
        "Locked",
        "3 unpublished commits",
      ])
        await expect(trees.getByText(text, { exact: false }).first()).toBeAttached();

      // Storage numbers read as figures and are not clipped.
      const storage = policy.locator('[data-setting-id="workspace-storage-status"]');
      await storage.scrollIntoViewIfNeeded();
      await expect(storage).toContainText("42.0 GiB / 50.0 GiB");
      await expect(storage).toContainText("18.0 GiB");
      await expect(storage).toContainText("Storage warning");
      expect(
        await storage.evaluate((node) =>
          [...node.querySelectorAll<HTMLElement>(".tabular-nums")].every(
            (figure) => figure.scrollWidth <= figure.clientWidth + 1,
          ),
        ),
      ).toBe(true);

      // A Host-side policy change while editing shows a conflict notice beside Save/Discard.
      const group = policy.locator('[data-setting-id="workspace-policy"]');
      await group.scrollIntoViewIfNeeded();
      await group.getByRole("switch", { name: "Pin new workspaces", exact: true }).click();
      await page.evaluate(() =>
        (
          window as unknown as { workspaceFixtureHostChangesPolicy: () => void }
        ).workspaceFixtureHostChangesPolicy(),
      );
      await policy.getByRole("button", { name: "Refresh worktrees", exact: true }).click();
      const notice = group.getByText("The saved policy changed while you were editing.", {
        exact: false,
      });
      await expect(notice).toBeVisible();
      const save = group.getByRole("button", {
        name: "Save workspace policy",
        exact: true,
      });
      const discard = group.getByRole("button", {
        name: "Discard changes",
        exact: true,
      });
      await expect(save).toBeDisabled();
      await expect(discard).toBeVisible();
      const groupBox = (await group.boundingBox())!;
      const noticeBox = (await notice.boundingBox())!;
      const saveBox = (await save.boundingBox())!;
      const discardBox = (await discard.boundingBox())!;
      for (const box of [noticeBox, saveBox, discardBox]) {
        expect(box.y).toBeGreaterThanOrEqual(groupBox.y - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(groupBox.y + groupBox.height + 1);
      }
      // Save and Discard sit in the policy heading, above its notice and fields.
      expect(saveBox.y).toBeLessThan(noticeBox.y);
      expect(Math.abs(saveBox.y - discardBox.y)).toBeLessThan(24);
      await group.scrollIntoViewIfNeeded();
      mkdirSync(l3Directory, { recursive: true });
      await page.screenshot({
        path: `${l3Directory}/source-control-conflict-${theme}-${width}.png`,
      });
      await group.getByRole("button", { name: "Keep my edits", exact: true }).click();
      await expect(save).toBeEnabled();

      // Keyboard reaches the row actions of the worktree collection, past the managed rows.
      await treeSearch.focus();
      let reached = "";
      for (let step = 0; step < 60 && !reached.startsWith("Reveal"); step += 1) {
        await page.keyboard.press("Tab");
        reached = await page.evaluate(
          () => document.activeElement?.getAttribute("aria-label") ?? "",
        );
      }
      expect(reached).toMatch(/^Reveal /);
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toMatch(
        /^Actions for /,
      );

      // Nothing overflows horizontally.
      const overflow = await page.evaluate(() => {
        const viewport = window.innerWidth;
        const escaped = [...document.querySelectorAll<HTMLElement>("main *")].filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && (box.left < -1 || box.right > viewport + 1);
        }).length;
        return {
          escaped,
          page: document.documentElement.scrollWidth,
          viewport,
        };
      });
      expect(overflow.escaped).toBe(0);
      expect(overflow.page).toBeLessThanOrEqual(overflow.viewport + 1);

      // Capture the whole composition: grow the viewport to the content instead of stitching.
      const height = await page
        .getByTestId("populated-scroller")
        .evaluate((node) => node.scrollHeight);
      await page.setViewportSize({ width, height: Math.min(height + 8, 4000) });
      await page.getByTestId("populated-scroller").evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({
        path: `${l3Directory}/source-control-full-${theme}-${width}.png`,
      });
      expect(errors).toEqual([]);
    });
  }

test("populated source control for a remote project keeps restrictions visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/tests/browser/worktrees.html?populated&remote&theme=light");
  const repo = page.locator('[data-setting-id="project-worktrees"]');
  await expect(
    repo.getByText("Creating and deleting worktrees runs on this computer", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(repo.getByRole("button", { name: "Create worktree", exact: true })).toBeDisabled();
  const remoteTrees = repo.getByRole("list", { name: "Worktrees", exact: true });
  await expect(remoteTrees.getByRole("listitem").first()).toBeVisible();
  for (const remove of await remoteTrees.getByRole("button", { name: /^Delete / }).all())
    await expect(remove).toBeDisabled();
  mkdirSync(l3Directory, { recursive: true });
  await page.setViewportSize({
    width: 1280,
    height: Math.min(
      (await page.getByTestId("populated-scroller").evaluate((node) => node.scrollHeight)) + 8,
      4000,
    ),
  });
  await page.screenshot({
    path: `${l3Directory}/source-control-remote-light-1280.png`,
  });
});
