import { expect, test, type Page } from "@playwright/test";

async function installNavigationFixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWebview: { label: "fixture" },
          currentWindow: { label: "fixture" },
        },
        transformCallback: () => 1,
        invoke: async (command: string, args?: { method?: string }) => {
          if (command === "git_diff_index")
            return {
              repository: true,
              branch: "main",
              files: [],
              additions: 0,
              deletions: 0,
            };
          if (command === "git_branches") return { current: "main", detached: false, branches: [] };
          if (command === "git_worktrees") return { defaultRoot: "/fixture", worktrees: [] };
          if (command === "git_status") return { files: [], branch: "main" };
          if (command === "remote_machines")
            return [
              {
                id: "fixture-host",
                name: "This computer (local sync)",
                localHost: true,
                endpoint: "http://127.0.0.1:9999",
                environmentId: "fixture-environment",
              },
            ];
          if (command === "remote_request") {
            if (args?.method === "environment.describe") return { capabilities: ["crews.v1"] };
            if (args?.method === "projects.list")
              return ["bycoda", "mobile", "service"].map((name) => ({
                id: name,
                name,
                cwd: `/fixture/${name}`,
              }));
            if (args?.method === "crews.list") return { definitions: [], agents: [], runs: [] };
            if (args?.method === "models.list") return { models: {}, errors: {} };
            return [];
          }
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:window|is_visible" || command === "plugin:window|is_focused")
            return true;
          return [];
        },
      },
    });
  });
}

test("session scrollbar preserves geometry and follows pointer or keyboard interaction", async ({
  page,
}) => {
  await installNavigationFixture(page);
  await page.setViewportSize({ width: 1280, height: 500 });
  for (const interaction of ["idle", "hover", "focus"] as const) {
    await page.mouse.move(1200, 450);
    await page.goto("/tests/browser/compact-navigation.html");
    const rail = page.locator("[data-session-list-panel]").first();
    await expect(rail).toBeVisible();
    const geometry = await rail.evaluate((element) => ({
      width: element.clientWidth,
      overflow: element.scrollHeight > element.clientHeight,
    }));
    expect(geometry.overflow).toBe(true);
    if (interaction === "hover") await rail.hover({ position: { x: 50, y: 50 } });
    if (interaction === "focus") await rail.locator("[data-session-select]").first().focus();
    // Chromium caches native pseudo computed styles across hover changes. Read
    // each state on a fresh navigation; normal scroll/focus assertions stay live.
    const color = await rail.evaluate(
      (element) => getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundColor,
    );
    if (interaction === "idle") expect(color).toBe("rgba(0, 0, 0, 0)");
    else expect(color).not.toBe("rgba(0, 0, 0, 0)");
    expect(await rail.evaluate((element) => element.clientWidth)).toBe(geometry.width);
    if (interaction === "focus") {
      const before = await rail.evaluate((element) => element.scrollTop);
      await page.keyboard.press("ArrowDown");
      await expect
        .poll(() => rail.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(before);
    }
  }
});

test("session detail closes on ancestor scroll and cancels a pending hover", async ({
  page,
}, testInfo) => {
  await installNavigationFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/tests/browser/compact-navigation.html?activityDate", {
    waitUntil: "domcontentloaded",
  });
  const row = page.locator("[data-session-card]").first();
  await expect(row).toBeVisible({ timeout: 90_000 });
  const select = row.locator("[data-session-select]");
  const detail = page
    .locator('[role="tooltip"]')
    .filter({ hasText: "Review compact navigation and unified search" });
  // Force a real scroll rail without changing row data or hiding the hovered row.
  const rail = page.locator("[data-session-list-panel]").first();
  await rail.evaluate((element) => {
    element.style.height = "220px";
    element.style.flex = "none";
    element.style.overflowY = "auto";
  });
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    await rail.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.mouse.move(1200, 700);
    await row.hover();
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Last activity: Oct 17, 2026, 03:37 PM");
    await page.screenshot({ path: testInfo.outputPath(`session-detail-open-${theme}.png`) });
    // An unrelated pane scrolling must not dismiss the session's detail.
    await page.locator("main").dispatchEvent("scroll");
    await expect(detail).toBeVisible();
    await rail.evaluate((element) => {
      element.scrollTop = 10;
    });
    await expect(detail).toHaveCount(0);
    await expect(select).not.toHaveAttribute("aria-describedby");
    await page.screenshot({ path: testInfo.outputPath(`session-detail-scrolled-${theme}.png`) });

    await page.mouse.move(1200, 700);
    await row.hover();
    await rail.evaluate((element) => {
      element.scrollTop += 10;
    });
    await page.waitForTimeout(750);
    await expect(detail).toHaveCount(0);

    await select.focus();
    await expect(detail).toBeVisible();
    await select.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(select).toBeFocused();
    // The next theme focuses the row again, so leave it unfocused.
    await select.blur();
  }
});

test("compact navigation keeps workspace tabs in place and stacks app tool shortcuts", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installNavigationFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/compact-navigation.html?badgeCount=8", {
    waitUntil: "domcontentloaded",
  });
  const rail = page.locator("[data-compact-project-rail]");
  await expect(rail).toBeVisible({ timeout: 90_000 });
  const projects = rail.getByRole("button", {
    name: "Projects and groups",
    exact: true,
  });
  const toolNames = [
    "Crews",
    "Servers",
    "Notes",
    "Automations",
    "Social Media",
    "Tasks",
    "Assistant",
  ];
  const tabs = page.locator('aside [role="tablist"][aria-label="Workspace"]');
  // A tab keeps its caption first; Sessions appends its working count.
  const tabNamed = (label: string) =>
    tabs.getByRole("tab", { name: new RegExp("^" + label + "(,|$)") });
  await expect(rail.getByRole("tab")).toHaveCount(0);
  await expect(projects).toHaveCount(1);
  await expect(rail.locator('button[aria-label^="Switch project"]')).toHaveCount(0);
  await expect(tabNamed("Sessions")).toBeVisible();
  await expect(tabs.locator("[data-workspace-working-count]")).toHaveText("8");
  await expect(rail.getByRole("button", { name: "Tools", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-compact-tools-flyout]")).toHaveCount(0);

  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [1280, 800, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(projects).toBeInViewport();
      let previousBottom = 0;
      for (const name of toolNames) {
        const tool = rail.getByRole("button", { name, exact: true });
        await expect(tool).toBeInViewport();
        expect((await tool.innerText()).trim()).toBe("");
        const bounds = (await tool.boundingBox())!;
        expect(bounds.y).toBeGreaterThanOrEqual(previousBottom);
        previousBottom = bounds.y + bounds.height;
      }
      const recovery = rail.getByRole("button", { name: "Recovered sessions (8)", exact: true });
      const recent = rail.getByRole("button", { name: "Last sessions", exact: true });
      await expect(recovery).toBeInViewport();
      await expect(recent).toBeInViewport();
      expect(await recovery.locator("svg").innerHTML()).not.toBe(
        await recent.locator("svg").innerHTML(),
      );
      // The collapsed rail is icon-only: the name lives in the accessible name and tooltip.
      expect((await projects.textContent())?.trim()).toBe("");
      await expect(projects).toHaveAttribute("aria-label", "Projects and groups");
      for (const label of ["Sessions", "Explorer", "Changes"]) {
        const tab = tabNamed(label);
        await expect(tab).toBeVisible();
        // The same icon stays at every width; the label steps away before it could be clipped.
        await expect(tab.locator(".workspace-tab-icon")).toBeVisible();
        if (await tab.locator(".workspace-tab-content").isVisible()) {
          const labelBounds = await tab
            .locator(".workspace-tab-content > span")
            .first()
            .evaluate((element) => ({
              available: element.clientWidth,
              content: element.scrollWidth,
            }));
          expect(
            labelBounds.content,
            `${label} caption must remain readable beside its badge`,
          ).toBeLessThanOrEqual(labelBounds.available);
        }
      }
      const initialTabs = await tabs.boundingBox();
      await tabNamed("Explorer").click();
      await expect(tabNamed("Explorer")).toHaveAttribute("aria-selected", "true");
      expect(await tabs.boundingBox()).toEqual(initialTabs);
      await tabNamed("Sessions").click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`navigation-${theme}-${width}.png`),
      });
      await projects.click();
      const popup = page.locator("[data-project-navigation-flyout]");
      await expect(popup.getByText("Product team", { exact: true }).first()).toBeVisible();
      await expect(
        popup.getByRole("navigation", { name: "Workspace tools", exact: true }),
      ).toHaveCount(0);
      await expect(popup.getByText("View on GitHub", { exact: true })).toHaveCount(0);
      const bounds = await popup.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`projects-${theme}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(projects).toBeFocused();
      for (const name of ["Notes", "Servers", "Automations", "Tasks"]) {
        await rail.getByRole("button", { name, exact: true }).click();
        await expect(page.getByLabel("Selected action")).toHaveText(name);
      }
    }
  }
  await page.setViewportSize({ width: 800, height: 360 });
  const actions = rail.locator("[data-compact-rail-actions]");
  expect(await actions.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  const settings = rail.getByRole("button", { name: "Settings", exact: true });
  await expect(settings).toBeInViewport();
  await rail.getByRole("button", { name: "Last sessions", exact: true }).scrollIntoViewIfNeeded();
  await expect(rail.getByRole("button", { name: "Last sessions", exact: true })).toBeInViewport();
  await expect(settings).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("navigation-light-800-short.png") });
  await page.setViewportSize({ width: 1000, height: 800 });
  await rail.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByLabel("Selected action")).toHaveText("Inbox");
  await rail.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(tabs).toBeVisible();

  await page.getByRole("button", { name: "Hide session list", exact: true }).click();
  await expect(tabs).toHaveCount(0);
  const workspace = rail.getByRole("button", {
    name: "Workspace",
    exact: true,
  });
  await expect(workspace).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-closed-light-1000.png"),
  });
  await workspace.click();
  await expect(tabs).toBeVisible();
  await expect(rail.getByRole("tab")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("workspace-temporary-light-1000.png"),
  });
  await workspace.click();
  await expect(tabs).toHaveCount(0);
  await workspace.click();
  await expect(tabs).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tabs).toHaveCount(0);
  await page.getByRole("button", { name: "Pin session list", exact: true }).click();
  await expect(tabs).toBeVisible();

  await rail.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("radio", { name: "All", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  // "Search conversations" is an inline filter of the session list now, not the shared dialog.
  await page.getByRole("button", { name: "Search conversations", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Search conversations" })).toBeFocused();
  await page.keyboard.type("zzz-no-such-conversation");
  await expect(page.getByText("No matching sessions")).toBeVisible();
  await page.getByRole("button", { name: /^Search all conversations/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Conversations", exact: true })).toBeChecked();
  await page.screenshot({
    path: testInfo.outputPath("shared-conversation-search.png"),
  });
  expect(errors).toEqual([]);
});

test("workspace header keeps location before history and project controls", async ({
  page,
}, testInfo) => {
  await installNavigationFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const project of [false, true]) {
    await page.goto(
      `/tests/browser/compact-navigation.html?headerNavigation${project ? "&projectHeader" : ""}`,
      { waitUntil: "domcontentloaded" },
    );
    const header = page.locator("[data-workspace-header]");
    await expect(header).toBeVisible({ timeout: 90_000 });
    const title = header.getByText(project ? "Workspace" : "Last sessions", { exact: true });
    const toggle = page.getByRole("button", { name: "Expand projects", exact: true });
    await expect(toggle).toHaveCount(1);
    await expect(header.getByRole("button", { name: "Expand projects", exact: true })).toHaveCount(
      1,
    );
    await expect(
      page
        .locator("[data-compact-project-rail]")
        .getByRole("button", { name: "Expand projects", exact: true }),
    ).toHaveCount(0);
    const titleFrame = header.locator("[data-pane-header-heading]");
    const workspacePane = page.locator('[data-side-pane="workspace"]');
    const resize = page.getByRole("separator", { name: "Resize sidebar", exact: true });
    for (const pane of ["default", "wide"]) {
      await resize.press("Enter");
      if (pane === "wide") {
        for (let step = 0; step < 3; step++) await resize.press("Shift+ArrowRight");
      }
      await resize.blur();
      for (const theme of ["dark", "light"]) {
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        for (const width of [1280, 800]) {
          await page.setViewportSize({ width, height: 800 });
          await expect(title).toBeVisible();
          const titleStyle = await title.evaluate((element) => ({
            weight: Number(getComputedStyle(element).fontWeight),
            size: parseFloat(getComputedStyle(element).fontSize),
          }));
          if (!project) {
            expect(titleStyle.weight).toBeGreaterThanOrEqual(500);
            expect(titleStyle.size).toBe(16);
          }
          await page.screenshot({
            path: testInfo.outputPath(
              `header-${project ? "project" : "last-sessions"}-${theme}-${width}-${pane}.png`,
            ),
          });
          await header.screenshot({
            path: testInfo.outputPath(
              `header-detail-${project ? "project" : "last-sessions"}-${theme}-${width}-${pane}.png`,
            ),
          });
          const frame = (await titleFrame.boundingBox())!;
          const constrained = await workspacePane.evaluate((element) => {
            const style = getComputedStyle(element);
            return (
              element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) <
              340
            );
          });
          const back = (await header
            .getByRole("button", { name: "Back", exact: true })
            .boundingBox())!;
          if (constrained) expect(frame.y + frame.height).toBeLessThanOrEqual(back.y + 0.5);
          let previousRight = constrained ? (await header.boundingBox())!.x : frame.x + frame.width;
          expect((await title.boundingBox())!.width).toBeLessThanOrEqual(frame.width);
          if (project) {
            const titleWidth = await title.evaluate((element) => ({
              available: element.clientWidth,
              content: element.scrollWidth,
            }));
            expect(titleWidth.content).toBeLessThanOrEqual(titleWidth.available);
          }
          for (const name of ["Back", "Forward", "Expand projects", "Search conversations"]) {
            const control = header.getByRole("button", { name, exact: true });
            await expect(control).toBeInViewport();
            const bounds = (await control.boundingBox())!;
            expect(
              bounds.x,
              `${name} must follow the title and prior controls`,
            ).toBeGreaterThanOrEqual(previousRight);
            previousRight = bounds.x + bounds.width;
          }
          const paneBounds = (await workspacePane.boundingBox())!;
          for (const control of await header.getByRole("button").all()) {
            const bounds = (await control.boundingBox())!;
            expect(
              bounds.x + bounds.width,
              `${await control.getAttribute("aria-label")} must remain inside the workspace pane`,
            ).toBeLessThanOrEqual(paneBounds.x + paneBounds.width + 0.5);
          }
        }
      }
    }
    await header.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByLabel("Selected action")).toHaveText("Back");
    await header.getByRole("button", { name: "Forward", exact: true }).click();
    await expect(page.getByLabel("Selected action")).toHaveText("Forward");
    await toggle.click();
    await expect(page.getByLabel("Project panel toggle count")).toHaveText("1");
  }
});

test("navigation chrome and session rows grow with comfortable and touch density", async ({
  page,
}) => {
  await installNavigationFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/tests/browser/compact-navigation.html", {
    waitUntil: "domcontentloaded",
  });
  const sidebar = page.locator("aside").first();
  const panel = page.locator("[data-session-list-panel]").first();
  await expect(panel).toBeVisible({ timeout: 90_000 });
  const rows = sidebar.locator("[data-session-card]");
  await expect(rows.first()).toBeVisible();
  const minimum = { compact: 28, comfortable: 32, touch: 44 } as const;
  let previous = 0;
  for (const density of ["compact", "comfortable", "touch"] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.controlDensity = value;
    }, density);
    const report = await sidebar.evaluate((root, floor) => {
      const containers = [
        ...root.querySelectorAll<HTMLElement>(
          "[data-session-list-panel], [data-tauri-drag-region]",
        ),
      ];
      const escaped: string[] = [];
      for (const container of containers) {
        const box = container.getBoundingClientRect();
        if (box.height === 0) continue;
        for (const control of container.querySelectorAll<HTMLElement>("button, input")) {
          const rect = control.getBoundingClientRect();
          if (rect.height === 0 || rect.width === 0) continue;
          if (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)
            escaped.push(
              `${control.getAttribute("aria-label") ?? control.textContent?.trim().slice(0, 24)}: ${Math.round(rect.height)}px in ${Math.round(box.height)}px`,
            );
        }
      }
      return {
        escaped,
        floor,
        // The list panel fills what the chrome leaves, so the chrome above it carries the growth.
        chrome:
          root.querySelector("[data-session-list-panel]")!.getBoundingClientRect().top -
          root.getBoundingClientRect().top,
        panel: root.querySelector("[data-session-list-panel]")!.getBoundingClientRect().height,
      };
    }, minimum[density]);
    expect(report.escaped, `${density} controls must stay inside their chrome rows`).toEqual([]);
    expect(report.panel).toBeGreaterThanOrEqual(minimum[density] - 0.5);
    expect(report.chrome).toBeGreaterThanOrEqual(previous);
    previous = report.chrome;
    for (const height of await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    ))
      expect(height, `${density} session row`).toBeGreaterThanOrEqual(minimum[density] - 0.5);
  }
});

test("session rows mark discussions that hold unsent composer text", async ({ page }, testInfo) => {
  await installNavigationFixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/tests/browser/compact-navigation.html?draft=1", {
    waitUntil: "domcontentloaded",
  });
  const sidebar = page.locator("aside").first();
  await expect(page.locator("[data-session-list-panel]").first()).toBeVisible({
    timeout: 90_000,
  });
  const rows = sidebar.locator("[data-session-card]");
  await expect(rows.filter({ hasText: "Product discussion 8" })).toContainText("Draft");
  await expect(rows.filter({ hasText: "Product discussion 9" })).not.toContainText("Draft");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    await sidebar.screenshot({ path: testInfo.outputPath(`session-draft-row-${theme}.png`) });
  }
});
