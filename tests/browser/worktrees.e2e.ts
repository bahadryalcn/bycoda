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
      // Deletion is an inline row action; a locked worktree offers it disabled with a reason.
      await expect(locked.getByRole("button", { name: /^Delete / })).toBeDisabled();
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
      mkdirSync("temp/verification/2026-11-06-worktrees", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-11-06-worktrees/${theme}-${width}.png`,
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
        path: `temp/verification/2026-11-06-worktrees/${theme}-${width}-details.png`,
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
      // The policy is always visible; the save bar appears only once it is edited.
      await expect(surface.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
      await expect(surface.getByText("New workspaces are paused.", { exact: false })).toBeVisible();
      mkdirSync("temp/verification/2026-11-06-worktrees", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-11-06-worktrees/workspace-policy-${theme}-${width}.png`,
      });
      const retention = surface.locator('[data-setting-id="workspace-retention"]');
      await expect(retention).toContainText("Active and pinned workspaces are excluded");
      await retention.getByRole("button", { name: /^Idle retention:/ }).click();
      await page.getByRole("option", { name: "Never", exact: true }).click();
      await surface.getByRole("switch", { name: "Pin workspaces", exact: true }).click();
      const save = surface.getByRole("button", {
        name: "Save",
        exact: true,
      });
      await expect(save).toBeEnabled();
      await save.click();
      // A saved policy clears the draft, so the save bar leaves the page.
      await expect(save).toHaveCount(0);
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
        path: `temp/verification/2026-11-06-worktrees/workspace-retention-${theme}-${width}.png`,
      });
      const disk = surface.locator('[data-setting-id="workspace-disk-policy"]');
      await disk
        .getByRole("spinbutton", {
          name: "Directory budget (GiB)",
          exact: true,
        })
        .fill("60");
      await save.click();
      await expect(save).toHaveCount(0);
      // Recovery bytes are not measured on this Host; the legend says so instead of showing zero.
      const storage = surface.locator('[data-setting-id="workspace-storage-status"]');
      await expect(storage.getByText("Not measured", { exact: true })).toBeVisible();
      await expect(storage.getByText("Shared caches", { exact: false })).toHaveCount(0);
      await disk.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/2026-11-06-worktrees/workspace-storage-${theme}-${width}.png`,
      });
      await surface
        .getByRole("listitem")
        .filter({ hasText: "Cleanup blocked" })
        .getByRole("button", { name: "Review blocked cleanup", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Delete worktree directory",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-06-worktrees/workspace-cleanup-${theme}-${width}.png`,
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
          const issues: Record<string, unknown>[] = [];
          const describe = (element: Element) => ({
            tag: element.tagName,
            className: element.getAttribute("class"),
            text: element.textContent?.trim().slice(0, 100),
          });
          for (let up: HTMLElement | null = panel; up; up = up.parentElement) {
            if (up.scrollWidth > up.clientWidth + 1)
              issues.push({
                kind: "ancestor-horizontal-scroll",
                ...describe(up),
                scrollWidth: up.scrollWidth,
                clientWidth: up.clientWidth,
              });
          }
          for (const child of node.querySelectorAll("*")) {
            const rect = child.getBoundingClientRect();
            if (rect.width === 0) continue;
            let left = rect.left;
            let right = rect.right;
            // Translated content can extend beyond its layout box while a control clips
            // its paint. Check painted bounds, retaining the ancestor scroll guard above.
            for (let ancestor = child.parentElement; ancestor; ancestor = ancestor.parentElement) {
              if (
                ["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(ancestor).overflowX)
              ) {
                const bounds = ancestor.getBoundingClientRect();
                const clipLeft = bounds.left + ancestor.clientLeft;
                left = Math.max(left, clipLeft);
                right = Math.min(right, clipLeft + ancestor.clientWidth);
              }
            }
            if (right > left && (left < box.left - 1 || right > box.right + 1))
              issues.push({
                kind: "descendant-outside-panel",
                ...describe(child),
                left,
                right,
                layoutLeft: rect.left,
                layoutRight: rect.right,
                panelLeft: box.left,
                panelRight: box.right,
              });
          }
          return issues;
        }),
      ).toEqual([]);
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
  await surface.getByRole("switch", { name: "Pin workspaces", exact: true }).click();
  await surface.getByRole("button", { name: "Save", exact: true }).click();
  await expect(surface.getByRole("alert")).toContainText("Fixture policy save failed");
  await expect(surface.getByRole("switch", { name: "Pin workspaces", exact: true })).toBeChecked();
  await expect(surface.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`a missing active folder retires its record in the background: ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/worktrees.html?populated&missingActive&theme=${theme}`);
      const list = page.getByRole("list", { name: "Worktrees", exact: true });
      const row = list.getByRole("listitem").filter({ hasText: "wt-populated-1-deep-folder-end" });
      await expect(row.getByText("Missing folder", { exact: true })).toBeVisible();
      await expect(row.getByRole("button", { name: "More actions" })).toHaveCount(0);
      for (const name of ["Review changes", "Reveal folder", "Pin workspace", "Remove record"])
        await expect(row.getByRole("button", { name, exact: true })).toBeVisible();
      await expect(row.getByRole("button", { name: "Reveal folder", exact: true })).toBeDisabled();
      mkdirSync(removalDirectory, { recursive: true });
      await page.screenshot({ path: `${removalDirectory}/rows-${theme}-${width}.png` });
      await row.getByRole("button", { name: "Remove record", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Remove workspace record", exact: true });
      await expect(dialog).toContainText("still marked active");
      await page.screenshot({ path: `${removalDirectory}/dialog-${theme}-${width}.png` });
      await dialog.getByRole("button", { name: "Remove record", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(row.getByText("Directory removed", { exact: true })).toBeVisible();
      await expect(
        page.getByText("Deleted wt-populated-1-deep-folder-end", { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: `${removalDirectory}/done-${theme}-${width}.png` });
      const methods = await page.evaluate(() =>
        (window as unknown as { workspaceFixtureCalls: { method: string }[] }).workspaceFixtureCalls
          .map((call) => call.method)
          .filter((method) => method.startsWith("workspaces.close") || method.includes("cleanup")),
      );
      expect(methods.slice(-4)).toEqual([
        "workspaces.close",
        "workspaces.cleanup.plan",
        "workspaces.cleanup.apply",
        "workspaces.cleanup.status",
      ]);
    });

test("cleanup blockers prevent owner removal and preserve unsaved policy", async ({ page }) => {
  await page.goto("/tests/browser/worktrees.html?managed&hardBlock&theme=light");
  const surface = page.getByTestId("workspace-policy-settings");
  await surface.getByRole("switch", { name: "Pin workspaces", exact: true }).click();
  await surface
    .getByRole("listitem")
    .filter({ hasText: "Cleanup blocked" })
    .getByRole("button", { name: "Review blocked cleanup", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Delete worktree directory",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toContainText("An editor still has unsaved changes");
  await expect(
    dialog.getByRole("button", { name: "Delete directory", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(surface.getByRole("switch", { name: "Pin workspaces", exact: true })).toBeChecked();
  await expect(surface.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
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
  await workspace.getByRole("button", { name: "Unpin workspace", exact: true }).click();
  await expect(workspace.getByText("Pinned", { exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "Pin workspace", exact: true })).toBeVisible();
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
  await expect(
    page
      .getByRole("list", { name: "Worktrees", exact: true })
      .getByRole("listitem")
      .filter({ hasText: "bycoda/s/settings-draft" })
      .getByRole("button", { name: "Unpin workspace", exact: true }),
  ).toBeDisabled();
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
      mkdirSync("temp/verification/2026-11-06-worktrees", { recursive: true });
      await page.screenshot({
        path: `temp/verification/2026-11-06-worktrees/managed-review-${theme}-${width}.png`,
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
        path: `temp/verification/2026-11-06-worktrees/managed-policy-${theme}-${width}.png`,
        fullPage: true,
      });
    });
  }

const l3Directory = "temp/verification/2026-11-06-worktrees";
const removalDirectory = "temp/verification/worktree-removal";

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
      // The policy is always open below global preferences; Save appears once it is edited.
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
      await expect(storage).toContainText("153.5 GiB");
      await expect(storage).toContainText("Storage warning");
      expect(
        await storage.evaluate((node) => {
          const figures = [...node.querySelectorAll<HTMLElement>("strong, dd")];
          return (
            figures.length > 0 &&
            figures.every((figure) => figure.scrollWidth <= figure.clientWidth + 1)
          );
        }),
      ).toBe(true);

      // A Host-side policy change while editing shows a conflict notice inside the policy group.
      const group = policy.locator('[data-setting-id="workspace-policy"]');
      await group.scrollIntoViewIfNeeded();
      await group.getByRole("switch", { name: "Pin workspaces", exact: true }).click();
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
        name: "Save",
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
      // Save and Discard share one save bar row, after the notice in the group.
      expect(Math.abs(saveBox.y - discardBox.y)).toBeLessThan(24);
      expect(saveBox.y).toBeGreaterThan(noticeBox.y);
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
      // Managed rows use "Reveal folder"; unmanaged rows name their branch.
      for (let step = 0; step < 80 && !/^Reveal (?!folder$)/.test(reached); step += 1) {
        await page.keyboard.press("Tab");
        reached = await page.evaluate(
          () => document.activeElement?.getAttribute("aria-label") ?? "",
        );
      }
      expect(reached).toMatch(/^Reveal /);
      // Each unmanaged row offers Delete inline, then its collapsed Details toggle last.
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toMatch(
        /^Delete /,
      );
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe(
        "Details",
      );
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-expanded"))).toBe(
        "false",
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
  const remoteTrees = repo.getByRole("list", {
    name: "Worktrees",
    exact: true,
  });
  await expect(remoteTrees.getByRole("listitem").first()).toBeVisible();
  // Every unmanaged row offers Delete inline, disabled for a remote project.
  const remoteDeletes = remoteTrees.getByRole("button", { name: /^Delete (?!directory$)/ });
  const deleteCount = await remoteDeletes.count();
  expect(deleteCount).toBeGreaterThan(0);
  for (let index = 0; index < deleteCount; index += 1)
    await expect(remoteDeletes.nth(index)).toBeDisabled();
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

const worktreeEvidence = "temp/verification/2026-11-06-worktrees";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`worktree storage recovery and readable details: ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tests/browser/worktrees.html?managed&unknownStorage&theme=${theme}`);
      const surface = page.getByTestId("workspace-policy-settings");
      const list = surface.getByRole("list", {
        name: "Worktrees",
        exact: true,
      });
      const workspace = list.getByRole("listitem").filter({
        hasText: "Provider settings parity across AI providers",
      });
      await expect(workspace).toBeVisible();
      await expect(workspace).toContainText("bycoda/s/settings-draft");
      await expect(workspace.locator("dl")).not.toBeVisible();
      mkdirSync(worktreeEvidence, { recursive: true });
      await page.screenshot({
        path: `${worktreeEvidence}/list-${theme}-${width}.png`,
      });
      const detailsToggle = workspace.getByRole("button", {
        name: "Details",
        exact: true,
      });
      await detailsToggle.focus();
      await expect(detailsToggle).toHaveAttribute("aria-expanded", "false");
      await page.keyboard.press("Enter");
      await expect(detailsToggle).toHaveAttribute("aria-expanded", "true");
      const details = workspace.locator("dl");
      await expect(details).toBeVisible();
      for (const label of ["Folder", "Branch", "Workspace ID", "Owner"])
        await expect(details.locator("dt").getByText(label, { exact: true })).toBeVisible();
      await expect(details).toContainText("/fixture/worktrees/wt-mc-851db1b6");
      await expect(details).toContainText("session-readable");
      await page.screenshot({
        path: `${worktreeEvidence}/details-${theme}-${width}.png`,
      });
      const pin = surface.getByRole("switch", {
        name: "Pin workspaces",
        exact: true,
      });
      await pin.click();
      const storage = surface.locator('[data-setting-id="workspace-storage-status"]');
      await storage.scrollIntoViewIfNeeded();
      await expect(storage).toContainText("153.5 GiB");
      await expect(storage).toContainText("Not measured / 50.0 GiB");
      await expect(storage).toContainText(
        "Storage could not be measured, so new worktrees are paused. Refresh to try again.",
      );
      await page.screenshot({
        path: `${worktreeEvidence}/storage-unknown-${theme}-${width}.png`,
      });
      await page.evaluate(() =>
        (
          window as unknown as {
            workspaceFixtureSetStorage: (mode: string) => void;
          }
        ).workspaceFixtureSetStorage("allowed"),
      );
      // The header icon and the feedback action are both "Refresh storage"; the feedback one is last.
      await storage.getByRole("button", { name: "Refresh storage", exact: true }).last().click();
      await expect(storage).toContainText("42.0 GiB");
      await expect(storage).not.toContainText("could not be measured");
      await expect(pin).toBeChecked();
      await expect(surface.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      await surface.getByRole("button", { name: "Discard changes", exact: true }).click();
      await expect(pin).not.toBeChecked();
      expect(errors).toEqual([]);
    });
  }

test("missing managed folder is warned in storage, flagged in its row, and filterable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/tests/browser/worktrees.html?managed&missingFolder&theme=dark");
  const surface = page.getByTestId("workspace-policy-settings");
  const storage = surface.locator('[data-setting-id="workspace-storage-status"]');
  await expect(storage).toContainText("Missing worktree folders: 1");
  const list = surface.getByRole("list", { name: "Worktrees", exact: true });
  const row = list.getByRole("listitem").filter({ hasText: "wt-merged" });
  await expect(row).toContainText("Missing folder");
  mkdirSync("temp/verification/sc-redesign", { recursive: true });
  await page.screenshot({
    path: "temp/verification/sc-redesign/managed-missing-folder-dark-1280.png",
  });
  await surface.getByRole("radio", { name: "Needs attention", exact: true }).click();
  await expect(row).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await surface.getByRole("radio", { name: "Active", exact: true }).click();
  await expect(row).toHaveCount(0);
});

// Evidence for the Source Control redesign: the populated composition at both widths.
const redesignEvidence = "temp/verification/sc-redesign";

for (const theme of ["dark", "light"])
  for (const width of [1280, 800]) {
    test(`populated source control redesign shot: ${theme} ${width}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/worktrees.html?populated&theme=${theme}`);
      await expect(
        page
          .getByTestId("populated-settings")
          .getByRole("list", { name: "Worktrees", exact: true })
          .getByRole("listitem")
          .first(),
      ).toBeVisible();
      // The composition scrolls inside the settings track, so grow the viewport to its full height.
      const height = await page
        .getByTestId("populated-scroller")
        .evaluate((node) => node.scrollHeight);
      await page.setViewportSize({ width, height: Math.min(height + 8, 4000) });
      await page.getByTestId("populated-scroller").evaluate((node) => {
        node.scrollTop = 0;
      });
      mkdirSync(redesignEvidence, { recursive: true });
      await page.screenshot({
        path: `${redesignEvidence}/populated-${theme}-${width}.png`,
      });
    });
  }
