import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`failed status aligns with last activity in ${theme}`, async ({ page }) => {
    await page.goto(`/tests/browser/sessions/session-recovery.html?theme=${theme}`);
    const dialog = page.getByRole("dialog", { name: "Recovered sessions" });
    const failed = dialog.getByText("Failed", { exact: true });

    for (const width of [1000, 800]) {
      await page.setViewportSize({ width, height: 800 });
      await failed.scrollIntoViewIfNeeded();
      const lines = await failed.evaluate((status) => {
        const text = document.createTreeWalker(status.parentElement!, NodeFilter.SHOW_TEXT);
        const tops: number[] = [];
        for (let node = text.nextNode(); node; node = text.nextNode()) {
          if (!/Failed|Last activity:/.test(node.textContent ?? "")) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          tops.push(range.getBoundingClientRect().top);
        }
        return tops;
      });
      expect(lines).toHaveLength(2);
      expect(Math.abs(lines[0] - lines[1])).toBeLessThan(0.5);
      await page.screenshot({
        path: `temp/verification/recovery-status-alignment/${theme}-${width}.png`,
        animations: "disabled",
      });
    }
  });

  test(`recovery row actions clear the scrollbar in ${theme}`, async ({ page }) => {
    await page.goto(`/tests/browser/sessions/session-recovery.html?theme=${theme}`);
    const dialog = page.getByRole("dialog", { name: "Recovered sessions" });
    await dialog.getByRole("radio", { name: /^All sessions/ }).click();
    const remove = dialog.getByRole("button", { name: /^Remove .+ from recovery list$/ }).first();
    for (const button of [
      remove,
      dialog.getByRole("button", { name: "Close", exact: true }),
      dialog.getByRole("button", { name: "Recovery list maintenance" }),
      dialog.getByRole("button", { name: "More ways to open", exact: true }),
    ]) {
      await expect(button).not.toHaveAttribute("data-tooltip-owner");
    }

    for (const [width, scrollbarSize] of [
      [1000, 6],
      [800, 14],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate((size) => {
        document.documentElement.style.setProperty("--ui-scrollbar-size", `${size}px`);
      }, scrollbarSize);
      await expect(remove).toBeInViewport();
      const spacing = await remove.evaluate((button) => {
        const scrollport = button.closest<HTMLElement>(".recovery-body")!;
        return {
          scrolls: scrollport.scrollHeight > scrollport.clientHeight,
          clearance:
            scrollport.getBoundingClientRect().left +
            scrollport.clientWidth -
            button.getBoundingClientRect().right,
        };
      });
      expect(spacing.scrolls).toBe(true);
      expect(spacing.clearance).toBeGreaterThanOrEqual(scrollbarSize);
      await remove.click({ trial: true });
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await page.screenshot({
        path: `temp/verification/recovery-scrollbar/${theme}-${width}.png`,
        animations: "disabled",
      });
    }
  });

  test(`rail keeps footer recovery readable in ${theme}`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("bycoda.language", "en");
      Object.assign(window, {
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        __TAURI_INTERNALS__: {
          metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
          transformCallback: () => 1,
          unregisterCallback: () => {},
          invoke: async (command: string) =>
            command === "plugin:window|is_fullscreen" ? false : [],
        },
      });
    });
    await page.goto(`/tests/browser/sessions/session-recovery.html?rail&theme=${theme}`);
    const rail = page.locator('[data-side-pane="rail"]');
    await expect(rail.getByRole("button", { name: "Search", exact: true })).toHaveCount(0);
    const recovery = rail.getByRole("button", { name: "Recovered sessions (128)", exact: true });
    const footer = page.getByRole("navigation", { name: "Workspace controls", exact: true });
    await expect(footer).toBeVisible();
    const footerBox = (await footer.boundingBox())!;
    expect(footerBox.x + footerBox.width).toBe(page.viewportSize()!.width);
    for (const width of [112, 140, 220, 300, 440]) {
      await rail.evaluate((element, width) => {
        (element as HTMLElement).style.width = `${width}px`;
      }, width);
      await expect(recovery.locator('[data-variant="count"]')).toHaveText("99+");
      const bounds = await rail.boundingBox();
      const recoveryFit = (await recovery.boundingBox())!;
      expect(recoveryFit.width).toBeGreaterThanOrEqual(24);
      expect(recoveryFit.x + recoveryFit.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      const tools = rail.locator('nav[aria-label="Workspace tools"]:visible');
      await expect(tools.getByRole("button", { name: "Assistant", exact: true })).toBeVisible();
      await expect(tools.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
      const settings = rail
        .getByRole("navigation", { name: "Account", exact: true })
        .getByRole("button", { name: "Settings", exact: true });
      await expect(settings).toBeVisible();
      await expect(settings).toBeInViewport();
      const ledgerBox = (await rail.locator(".bycoda-project-ledger").boundingBox())!;
      const recoveryBox = (await recovery.boundingBox())!;
      expect(recoveryBox.y).toBeGreaterThanOrEqual(ledgerBox.y + ledgerBox.height);
      const settingsBox = (await settings.boundingBox())!;
      if (width > 140) {
        expect(recoveryBox.x + recoveryBox.width).toBeLessThanOrEqual(settingsBox.x);
        expect(recoveryBox.y).toBe(settingsBox.y);
      } else {
        expect(recoveryBox.y + recoveryBox.height).toBeLessThanOrEqual(settingsBox.y);
      }
      await settings.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("settings-destination")).toHaveText("general");
      await page.screenshot({
        path: `temp/verification/recovery-footer-icon/${theme}-${width}.png`,
      });
    }
    // A wide footer keeps its controls inline; only a footer under 640px folds them into "More".
    await expect(footer.getByRole("button", { name: "Refresh current view" })).toBeVisible();
    await expect(footer.getByRole("button", { name: "Sounds" })).toBeVisible();
    await expect(footer.getByRole("button", { name: "More", exact: true })).toBeHidden();
    await recovery.click();
    await expect(page.getByRole("dialog", { name: "Recovered sessions" })).toBeVisible();
  });
}

test("all recovered projects remain searchable, selectable and reopenable", async ({ page }) => {
  await page.goto("/tests/browser/sessions/session-recovery.html");
  const dialog = page.getByRole("dialog", { name: "Recovered sessions" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(6);
  const filters = dialog.getByRole("radiogroup", { name: "Session filters", exact: true });
  await expect(filters.getByRole("radio", { name: /^Needs attention/ })).toBeChecked();
  await expect(filters.getByRole("radio", { name: /^Needs attention/ })).toContainText("6");
  await expect(filters.getByRole("radio", { name: /^All sessions/ })).toContainText("24");
  await expect(dialog.getByText("Failed", { exact: true })).toHaveCount(1);
  await dialog.getByRole("radio", { name: /All sessions/ }).click();
  await expect(dialog.getByRole("checkbox")).toHaveCount(24);
  await dialog.getByRole("textbox", { name: "Search recovered sessions" }).fill("conversation 24");
  await expect(dialog.getByRole("checkbox")).toHaveCount(1);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: /^Open sessions/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("opened")).toHaveText('{"ids":["session-23"],"layout":false}');
  await page.getByRole("button", { name: "Recovered sessions 24" }).click();
  await expect(dialog.getByRole("checkbox")).toHaveCount(6);
  await page.screenshot({
    path: "temp/verification/2026-10-13-session-recovery/desktop.png",
    animations: "disabled",
  });
});

test("the summary and bulk controls fit a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 760 });
  await page.goto("/tests/browser/sessions/session-recovery.html");
  const dialog = page.getByRole("dialog", { name: "Recovered sessions" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "More ways to open", exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "temp/verification/2026-10-13-session-recovery/narrow-500.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "More ways to open", exact: true }).click();
  await page.getByRole("menuitem", { name: "Restore chat layout" }).click();
  await expect(page.getByTestId("opened")).toContainText('"layout":true');
  const result = JSON.parse(await page.getByTestId("opened").innerText()) as { ids: string[] };
  expect(result.ids).toHaveLength(24);
  expect(result.ids).toContain("session-23");
});

test("cleanup updates the list and survives closing the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/tests/browser/sessions/session-recovery.html");
  const dialog = page.getByRole("dialog", { name: "Recovered sessions" });
  const maintain = async (name: RegExp) => {
    await dialog.getByRole("button", { name: "Recovery list maintenance", exact: true }).click();
    await page.getByRole("menuitem", { name }).click();
  };
  await maintain(/^Remove \d+ completed from list$/);
  // After completed entries are removed every remaining row needs attention.
  // There is no redundant filter; all six rows must remain directly available.
  await expect(
    dialog.getByRole("radiogroup", { name: "Session filters", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByRole("checkbox")).toHaveCount(6);
  await dialog.getByRole("checkbox").first().check();
  await maintain(/^Remove 1 selected from list$/);
  await expect(dialog.getByRole("checkbox")).toHaveCount(5);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "temp/verification/2026-10-13-session-recovery/narrow.png" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Recovered sessions 24" }).click();
  await expect(dialog.getByRole("checkbox")).toHaveCount(5);
  await maintain(/^Clear recovery list \(\d+\)$/);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
});

test("compact navigation keeps tabs and the footer recovery icon reachable", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === "git_diff_index" || command === "git_diff_files") {
            return {
              repository: true,
              branch: "main",
              head: "fixture",
              files: [],
              conflicts: [],
              operation: null,
              additions: 0,
              deletions: 0,
              ahead: 0,
              behind: 0,
              aheadOfDefault: 0,
              headPushed: true,
              remote: null,
              upstream: null,
              defaultBranch: "main",
            };
          }
          if (command === "git_operation_status") return { operation: null, conflicts: [] };
          if (command === "git_branches") return { current: "main", detached: false, branches: [] };
          if (command === "git_history") return { head: "fixture", commits: [] };
          if (command.includes("worktree")) return { worktrees: [], supported: false };
          if (command === "git_diff_stats") return { files: 0, additions: 0, deletions: 0 };
          if (command === "git_file_statuses") return { files: {}, dirs: {} };
          return [];
        },
      },
    });
  });
  await page.setViewportSize({ width: 600, height: 760 });
  await page.goto("/tests/browser/sessions/session-recovery.html?sidebar");
  const pane = page.locator('[data-side-pane="workspace"]');
  await expect(pane).toBeVisible();
  await pane.evaluate((element) => {
    (element as HTMLElement).style.width = "220px";
  });
  for (const [label, tab] of [
    ["Explorer", "files"],
    ["Changes", "changes"],
    ["Sessions", "sessions"],
  ]) {
    const button = pane.getByRole("tab", { name: label, exact: true });
    await expect(button).toBeInViewport();
    await button.click();
    await expect(page.getByTestId("active-sidebar-tab")).toHaveText(tab);
  }
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/tests/browser/sessions/session-recovery.html?sidebar&theme=${theme}`);
      await pane.evaluate((element) => {
        (element as HTMLElement).style.width = "360px";
      });
      const changes = pane.getByRole("tab", { name: "Changes", exact: true });
      await expect(changes).toBeVisible();
      await changes.click();
      await expect(page.getByTestId("active-sidebar-tab")).toHaveText("changes");
      await page.screenshot({
        path: `temp/verification/remote-git-generation/changes-${theme}-${width}.png`,
      });
    }
  }
  await page.setViewportSize({ width: 600, height: 760 });
  await pane.evaluate((element) => {
    (element as HTMLElement).style.width = "220px";
  });
  const recovery = page.locator("[data-compact-project-rail] [data-recovery-control]");
  await expect(recovery).toHaveAccessibleName("Recovered sessions (40)");
  const compactSettings = page.locator("[data-compact-project-rail]").getByRole("button", {
    name: "Settings",
    exact: true,
  });
  expect((await recovery.boundingBox())!.y).toBeLessThan((await compactSettings.boundingBox())!.y);
  await expect(recovery).toBeInViewport();
  await expect(recovery.locator('[data-variant="count"]')).toHaveText("40");
  await page.screenshot({
    path: "temp/verification/2026-10-13-session-recovery/compact-sidebar.png",
  });
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(pane.getByRole("tab", { name: "Explorer", exact: true })).toBeInViewport();
  await pane.getByRole("tab", { name: "Explorer", exact: true }).click();
  await expect(page.getByTestId("active-sidebar-tab")).toHaveText("files");
  await page.setViewportSize({ width: 900, height: 760 });
  // The compact rail's project button opens the Projects and groups flyout (the project ledger
  // only); the inline "Clear list" row is gone, recovery keeps its own rail control.
  await page.getByRole("button", { name: "Projects and groups", exact: true }).click();
  const flyout = page.getByRole("dialog", { name: "Projects and groups", exact: true });
  await expect(flyout.getByRole("button", { name: "fixture", exact: true })).toBeVisible();
  await page.screenshot({
    path: "temp/verification/2026-10-13-session-recovery/projects-flyout.png",
  });
  await page.keyboard.press("Escape");
  await expect(flyout).toHaveCount(0);
  await expect(recovery).toHaveAccessibleName("Recovered sessions (40)");
  await expect(flyout.getByRole("button", { name: "Clear list", exact: true })).toHaveCount(0);
});
for (const [theme, width] of [
  ["light", 390],
  ["dark", 1000],
] as const) {
  test(`shared recovery field ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/sessions/session-recovery.html?theme=${theme}`);
    const dialog = page.getByRole("dialog", { name: "Recovered sessions" });
    const field = dialog.getByRole("textbox", { name: "Search recovered sessions", exact: true });
    await field.focus();
    await expect(field).toBeFocused();
    await field.fill("conversation 24");
    await dialog.getByRole("radio", { name: /All sessions/ }).click();
    await expect(dialog.getByRole("checkbox")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
    await expect(dialog.getByRole("checkbox")).toHaveCount(24);
    const box = (await field.boundingBox())!;
    expect(box.width).toBeGreaterThan(100);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `temp/verification/2026-10-16-ui-system/W7-SHELL-recovery-${theme}-${width}.png`,
      animations: "disabled",
    });
  });
}
