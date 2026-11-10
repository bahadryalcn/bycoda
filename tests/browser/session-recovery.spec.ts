import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`rail header keeps search and recovery readable in ${theme}`, async ({ page }) => {
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
    await page.goto(`/tests/browser/session-recovery.html?rail&theme=${theme}`);
    const rail = page.locator('[data-side-pane="rail"]');
    const search = rail.getByRole("button", { name: "Search", exact: true });
    const recovery = rail.getByRole("button", { name: "Recovered sessions (128)", exact: true });
    const footer = page.getByRole("navigation", { name: "Workspace controls", exact: true });
    await expect(footer).toBeVisible();
    const footerBox = (await footer.boundingBox())!;
    expect(footerBox.x + footerBox.width).toBe(page.viewportSize()!.width);
    for (const width of [112, 140, 220, 300, 440]) {
      await rail.evaluate((element, width) => {
        (element as HTMLElement).style.width = `${width}px`;
      }, width);
      await expect(search).toBeVisible();
      // Exactly one count: the corner badge on a label-less rail, else the plain section count.
      await expect(
        recovery.locator(".recovery-rail-count:visible, .recovery-rail-number:visible"),
      ).toHaveCount(1);
      const bounds = await rail.boundingBox();
      for (const control of [search, recovery]) {
        const box = (await control.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      }
      const label = search.locator("[data-rail-search-label]");
      if (await label.isVisible()) {
        expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
      }
      const tools = rail.locator('nav[aria-label="Workspace tools"]:visible');
      await expect(tools.getByRole("button", { name: "Assistant", exact: true })).toBeVisible();
      await expect(tools.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
      const settings = rail
        .getByRole("navigation", { name: "Account", exact: true })
        .getByRole("button", { name: "Settings", exact: true });
      await expect(settings).toBeVisible();
      await expect(settings).toBeInViewport();
      await settings.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("settings-destination")).toHaveText("general");
      await page.screenshot({
        path: `temp/verification/2026-10-20-rail-header/${theme}-${width}.png`,
      });
    }
    await page.getByRole("button", { name: "Manage hidden groups", exact: true }).click();
    await expect(page.getByTestId("settings-destination")).toHaveText("groupLock");
    await recovery.click();
    await expect(page.getByRole("dialog", { name: "Recovered sessions" })).toBeVisible();
  });
}

test("all recovered projects remain searchable, selectable and reopenable", async ({ page }) => {
  await page.goto("/tests/browser/session-recovery.html");
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
  await dialog.getByRole("button", { name: "Open selected" }).click();
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
  await page.goto("/tests/browser/session-recovery.html");
  const dialog = page.getByRole("dialog", { name: "Recovered sessions" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Restore chat layout" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "temp/verification/2026-10-13-session-recovery/narrow-500.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Restore chat layout" }).click();
  await expect(page.getByTestId("opened")).toContainText('"layout":true');
  const result = JSON.parse(await page.getByTestId("opened").innerText()) as { ids: string[] };
  expect(result.ids).toHaveLength(24);
  expect(result.ids).toContain("session-23");
});

test("cleanup updates the list and survives closing the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/tests/browser/session-recovery.html");
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

test("compact navigation keeps tabs reachable and recovery count above its icon", async ({
  page,
}) => {
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
  await page.goto("/tests/browser/session-recovery.html?sidebar");
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
  const recovery = page.locator("[data-compact-project-rail] .recovery-rail-control");
  await expect(recovery).toHaveAccessibleName("Recovered sessions (40)");
  const icon = await recovery.locator("svg").boundingBox();
  const badge = await recovery.locator(".recovery-rail-count").boundingBox();
  expect(badge!.y).toBeLessThan(icon!.y);
  await page.screenshot({
    path: "temp/verification/2026-10-13-session-recovery/compact-sidebar.png",
  });
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(pane.getByRole("tab", { name: "Explorer", exact: true })).toBeInViewport();
  await pane.getByRole("tab", { name: "Explorer", exact: true }).click();
  await expect(page.getByTestId("active-sidebar-tab")).toHaveText("files");
  await page.setViewportSize({ width: 900, height: 760 });
  await page.getByRole("button", { name: "Expand projects", exact: true }).click();
  const row = page.locator(".recovery-rail-row");
  const search = page.locator('[data-rail-brand="column"]');
  await expect(row.getByRole("button", { name: "Clear list", exact: true })).toBeVisible();
  const searchBounds = await search.boundingBox();
  const rowBounds = await row.boundingBox();
  expect(rowBounds!.y).toBeGreaterThanOrEqual(searchBounds!.y + searchBounds!.height);
  await page.screenshot({
    path: "temp/verification/2026-10-13-session-recovery/expanded-clear.png",
  });
  await row.getByRole("button", { name: "Clear list", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Recovered sessions (40)", exact: true }),
  ).toHaveCount(0);
});
for (const [theme, width] of [
  ["light", 390],
  ["dark", 1000],
] as const) {
  test(`shared recovery field ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/session-recovery.html?theme=${theme}`);
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
