import { expect, test, type Locator } from "@playwright/test";

test("session preview replaces browsing tabs and keeps drafts across themes and narrow layouts", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/project-workspace-navigation.html?session-preview=1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tabs = page.locator("[data-title-tab-id]");
  const discussions = page.locator("aside").getByRole("button", { name: /^Discussion / });
  for (let i = 0; i < 10; i++) await discussions.nth(i).click();
  await expect(tabs).toHaveCount(1);
  await expect(page.getByLabel("Active discussion")).toHaveText("Discussion 10");
  await expect(tabs.locator(".italic")).toHaveCount(1);
  await page.getByLabel("Draft", { exact: true }).fill("Keep this draft");
  await discussions.nth(0).click();
  await expect(tabs).toHaveCount(2);
  await discussions.nth(1).dblclick();
  await discussions.nth(2).click();
  await expect(tabs).toHaveCount(3);
  await discussions.nth(9).click();
  await expect(page.getByLabel("Draft", { exact: true })).toHaveValue("Keep this draft");
  // Intentional kept tabs should scroll rather than collapse their labels.
  for (let i = 0; i < 8; i++) await discussions.nth(i).dblclick();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      await discussions.nth(9).click();
      const activeTab = tabs.filter({ has: page.locator('button[data-button-selected="true"]') });
      await expect(activeTab).toBeInViewport();
      expect(
        await tabs.first().evaluate((node) => node.getBoundingClientRect().width),
      ).toBeGreaterThanOrEqual(159);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`session-preview-${theme}-${width}.png`) });
    }
  }
});

test("working sessions and usage meters stay contained in narrow and short workspaces", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/project-workspace-navigation.html?layout=1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const rail = page.locator('[data-side-pane="rail"]');
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 768 ? 560 : 800 });
      await rail.evaluate((element) => {
        element.style.width = "260px";
      });
      const firstCard = rail.locator("[data-live-agent-card]").first();
      await expect(firstCard).toBeVisible();
      expect(await firstCard.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const lines = await firstCard.locator(":scope > span").evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, bottom: rect.bottom };
        }),
      );
      expect(lines).toHaveLength(2);
      expect(lines[1].y).toBeGreaterThanOrEqual(lines[0].bottom);
      expect(Math.abs(lines[0].x - lines[1].x)).toBeLessThan(1);
      await expect(rail.getByRole("button", { name: "Notes", exact: true })).toBeInViewport();
      await expect(rail.getByRole("button", { name: /^Settings/ }).first()).toBeInViewport();
      const usage = page.locator("[data-provider-usage]");
      const chips = usage.getByRole("button", { name: /usage details/ });
      await expect(chips).toHaveCount(2);
      for (const chip of await chips.all()) {
        const meter = chip.locator("[data-compact]");
        expect((await meter.boundingBox())!.width).toBeCloseTo(32, 0);
        const contained = await chip.evaluate((node) => {
          const outer = node.getBoundingClientRect();
          return [...node.querySelectorAll("span")].every((child) => {
            const rect = child.getBoundingClientRect();
            return rect.left >= outer.left - 1 && rect.right <= outer.right + 1;
          });
        });
        expect(contained).toBe(true);
      }
      const boxes = await chips.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      );
      expect(boxes[1].left).toBeGreaterThanOrEqual(boxes[0].right);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 390 || width === 1440)
        await page.screenshot({ path: testInfo.outputPath(`shell-${width}-${theme}.png`) });
    }
  }
  const firstCard = rail.locator("[data-live-agent-card]").first();
  const more = rail.getByRole("button", { name: "6 more", exact: true });
  await more.click();
  await expect(rail.locator("[data-live-agent-card]")).toHaveCount(8);
  const less = rail.getByRole("button", { name: "Show less", exact: true });
  await expect(less).toBeInViewport();
  await less.click();
  await expect(rail.locator("[data-live-agent-card]")).toHaveCount(2);
  await firstCard.focus();
  await firstCard.press("Enter");
  await expect(page.getByLabel("Selected live session")).toHaveText("live-0");
  const workingToggle = rail.getByRole("button", { name: "Working 8", exact: true });
  await workingToggle.click();
  await expect(firstCard).toBeHidden();
  await workingToggle.click();
  await expect(firstCard).toBeVisible();
  const details = page.getByRole("button", { name: "Codex usage details", exact: true });
  await details.focus();
  await details.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeFocused();
});

test("Inbox keeps long issue titles readable and list actions available", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/project-workspace-navigation.html?inbox-layout=1");
  const card = page.getByRole("button", { name: /DESIGN-1:/ }).first();
  await expect(card).toBeVisible();
  const divider = page.getByRole("separator", { name: "Resize inbox list", exact: true });
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const title = card.getByText(/^Preserve readable shared interface/);
      expect(await title.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(
        25,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 1440)
        await page.screenshot({ path: testInfo.outputPath(`inbox-${theme}.png`) });
    }
  }
  await expect(divider).toHaveAttribute("aria-valuenow", "320");
  await divider.focus();
  await divider.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "330");
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(divider).toHaveAttribute("aria-valuenow", "195");
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(divider).toHaveAttribute("aria-valuenow", "330");
  const search = page.getByRole("textbox", { name: "Filter inbox", exact: true });
  await search.fill("layouts 12");
  await expect(page.getByRole("button", { name: /DESIGN-12:/ })).toBeVisible();
  await expect(card).toBeHidden();
  await search.fill("");
  await card.focus();
  await card.press("Enter");
  await expect(card).toHaveAttribute("aria-current", "true");
});

test("compact rail centers group and social icons without wrapping labels", async ({
  page,
}, testInfo) => {
  const rail = page.locator('[data-side-pane="rail"]');
  const social = rail.getByRole("button", { name: "Social Media", exact: true });
  const label = social.getByText("Social Media", { exact: true }).first();
  const groupHeader = page.locator('[data-project-group="team"] > .project-reorder-item');
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [56, 80, 139, 176, 260]) {
      await rail.evaluate((element, size) => {
        element.style.width = `${size}px`;
      }, width);
      if (width > 200) await social.focus();
      if (width < 140) await expect(label).toBeHidden();
      else await expect(label).toBeVisible();
      if (width < 140) {
        for (const [container, icon] of [
          [social, social.locator("svg")],
          [groupHeader, groupHeader.locator("button").first().locator("svg").first()],
        ]) {
          const outer = await container.boundingBox();
          const inner = await icon.boundingBox();
          expect(outer).not.toBeNull();
          expect(inner).not.toBeNull();
          expect(Math.abs(inner!.x + inner!.width / 2 - outer!.x - outer!.width / 2)).toBeLessThan(
            2,
          );
        }
      }
      expect((await social.boundingBox())!.height).toBeLessThanOrEqual(32);
    }
  }
  await rail.evaluate((element) => {
    element.style.width = "80px";
  });
  await rail.screenshot({ path: testInfo.outputPath("compact-rail.png") });
  await social.focus();
  await expect(social).toBeFocused();
  await page.evaluate(() => {
    window.addEventListener(
      "bycoda:open-social-panel",
      (event) => {
        document.body.dataset.socialCwd = (event as CustomEvent).detail.cwd;
      },
      { once: true },
    );
  });
  await social.press("Enter");
  await expect(page.locator("body")).toHaveAttribute("data-social-cwd", "G:/wallet/api");
});

test("rail appearance keeps two icon rows and applies independent translucent colors", async ({
  page,
}, testInfo) => {
  await page
    .locator('[data-project-group="wallet"] > .project-reorder-item')
    .click({ button: "right" });
  // Appearance controls live in the menu's Appearance popover, not inline.
  await page
    .getByRole("menu", { name: "Project group actions", exact: true })
    .getByRole("menuitem", { name: "Appearance", exact: true })
    .click();
  const menu = page.getByRole("dialog", { name: "Appearance", exact: true });
  const icons = menu.getByRole("group", { name: "Project icons", exact: true });
  await expect(icons).toHaveCSS("height", "140px");
  const iconHeading = await menu.getByText("Project icon", { exact: true }).boundingBox();
  const automatic = await menu
    .getByRole("button", { name: "Use automatic project icon", exact: true })
    .boundingBox();
  expect(iconHeading!.width).toBeGreaterThan(50);
  expect(automatic!.x).toBeGreaterThanOrEqual(iconHeading!.x + iconHeading!.width);
  expect(await icons.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await menu.getByLabel("Color 7", { exact: true }).click();
  const swatchColor = await menu
    .getByLabel("Color 7", { exact: true })
    .locator("span")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await expect(menu.locator("[data-project-icon-picker] > div").first().locator("svg")).toHaveCSS(
    "color",
    swatchColor,
  );
  await menu.getByText("Background colors", { exact: true }).click();
  await menu.getByRole("checkbox", { name: "Group header", exact: true }).check();
  const visibility = menu.getByRole("slider").first();
  await visibility.press("Home");
  for (let index = 0; index < 3; index++) await visibility.press("PageUp");
  for (let index = 0; index < 5; index++) await visibility.press("ArrowRight");
  await menu.getByRole("checkbox", { name: "Expanded contents", exact: true }).check();
  await menu
    .getByLabel("Expanded contents: Color", { exact: true })
    .evaluate((node: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        node,
        "#22c55e",
      );
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const group = page.locator('[data-project-group="wallet"]');
  await expect(group.locator(":scope > .project-reorder-item")).toHaveAttribute("style", /35%/);
  await expect(group.locator(":scope > .project-reorder-item")).toHaveCSS("opacity", "1");
  expect(
    await group
      .locator(":scope > .project-reorder-item")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).not.toBe(
    await group
      .locator("[data-project-group-items]")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  );
  await page.screenshot({ path: testInfo.outputPath("rail-colors.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Project group actions", exact: true })).toHaveCount(
    0,
  );
  await page.locator('[data-project-path="G:/wallet/api"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Appearance", exact: true }).click();
  await page.getByText("Background colors", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Project row", exact: true }).check();
  expect(
    await page
      .locator('[data-project-path="G:/wallet/api"]')
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
});

test("project menu offers a separate disk folder rename", async ({ page }) => {
  await page.locator('[data-project-path="G:/wallet/api"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Folders", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename folder…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rename folder", exact: true });
  await dialog.getByRole("textbox", { name: "Folder name", exact: true }).fill("payment-api");
  await dialog.getByRole("button", { name: "Rename folder", exact: true }).click();
  await expect(page.getByLabel("Renamed folder")).toHaveText("G:/wallet/api:payment-api");
  await expect(dialog).toHaveCount(0);
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWebview: { label: "fixture" }, currentWindow: { label: "fixture" } },
        transformCallback: () => 1,
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          const cwd = String(args.cwd ?? "G:/wallet/api");
          if (new URL(location.href).searchParams.has("inbox-layout")) {
            if (command.endsWith("_status"))
              return { connected: command === "jira_status", login: "fixture" };
            if (command === "jira_list_issues")
              return Array.from({ length: 12 }, (_, index) => ({
                provider: "jira",
                kind: "jira",
                id: `fixture-${index}`,
                identifier: `DESIGN-${index + 1}`,
                number: index + 1,
                title: `Preserve readable shared interface controls and long issue titles across narrow layouts ${index + 1}`,
                url: `https://example.test/browse/DESIGN-${index + 1}`,
                state: "Open",
                stateType: "new",
                updatedAt: new Date().toISOString(),
                labels: [],
                assignees: [],
                draft: false,
                repo: "Design workspace",
                teamId: "design",
                teamName: "Design workspace",
                projectPath: "G:/wallet/api",
              }));
            if (command === "jira_issue_details")
              return { body: "Fixture issue description", author: "Fixture" };
            if (command === "jira_issue_thread")
              return {
                comments: [],
                truncated: false,
                reviewDecision: "",
                baseRefName: "",
                headRefName: "",
              };
            if (command === "jira_list_projects") return [];
          }
          const mobile = cwd.endsWith("mobile");
          const worktreesDemo = new URL(window.location.href).searchParams.has("worktrees");
          const branch = worktreesDemo
            ? cwd.includes("wallet-worktrees")
              ? "mc/task"
              : "main"
            : mobile
              ? "feature/mobile"
              : "demo";
          if (command === "git_worktrees" && worktreesDemo)
            return {
              defaultRoot: "G:/wallet-worktrees",
              worktrees: [
                { path: "G:/wallet/api", branch: "main", isMain: true },
                { path: "G:/wallet-worktrees/task", branch: "mc/task", isMain: false },
              ].map((tree) => ({
                ...tree,
                head: "abc123",
                locked: false,
                prunable: false,
                missing: false,
                dirty: true,
                unpushed: 0,
                sessionIds: [],
              })),
            };
          const file = {
            path: `${cwd}/same.ts`,
            relative: "same.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            staged: false,
            unstaged: true,
          };
          if (command === "git_diff_index" || command === "git_diff_files")
            return {
              repository: true,
              branch,
              head: "abc123",
              files: mobile ? [] : [file],
              conflicts: [],
              operation: mobile ? "rebase" : null,
              additions: 1,
              deletions: 0,
              ahead: 0,
              behind: 0,
              aheadOfDefault: 0,
              headPushed: true,
              remote: null,
              upstream: null,
              defaultBranch: "main",
            };
          if (command === "git_branches")
            return {
              current: branch,
              detached: false,
              branches: [
                { name: branch, current: true, remote: null },
                { name: "main", current: false, remote: null },
              ],
            };
          if (command === "git_history") return { head: "abc123", commits: [] };
          if (command === "git_diff_stats") return { files: 1, additions: 1, deletions: 0 };
          if (command === "git_operation_status")
            return { operation: mobile ? "rebase" : null, conflicts: [] };
          if (command === "git_head_message") return "PFDEV-666 - fix console log move logger";
          if (command === "git_remotes" || command === "git_stash_list" || command === "git_tags")
            return [];
          return null;
        },
      },
    });
  });
  await page.goto("/tests/browser/project-workspace-navigation.html", {
    waitUntil: "domcontentloaded",
  });
});

async function choose(panel: Locator, label: string, option: string) {
  await panel.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await panel.page().getByRole("option", { name: option, exact: true }).click();
}

test("main and worktrees remain separate and usable in narrow and wide Changes panels", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/project-workspace-navigation.html?worktrees=1");
  const panel = page.locator('[data-workspace-source-control="G:/wallet/api"]');
  await expect(panel).toBeVisible();
  // The picker opens on the session's own checkout; the overview lists every checkout.
  await expect(
    panel.getByRole("button", { name: /^Working copy: main · api · This session/ }),
  ).toBeVisible();
  await expect(panel.locator("[data-checkout-list]")).toHaveCount(0);
  await choose(panel, "Working copy", "All checkouts");
  const checkouts = panel.locator("[data-checkout-list] li");
  await expect(checkouts).toHaveCount(2);
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    // Poll: the picker's value roll briefly overflows while the old label exits.
    await expect
      .poll(() => panel.evaluate((node) => node.scrollWidth <= node.clientWidth))
      .toBe(true);
  }
  await panel.locator('[data-checkout-list] button[title="G:/wallet-worktrees/task"]').click();
  await panel.getByText("same.ts", { exact: true }).click();
  await expect(page.getByRole("status", { name: "Selected review" })).toHaveText(
    "diff:G:/wallet-worktrees/task:G:/wallet-worktrees/task/same.ts",
  );
  await expect(panel.getByRole("button", { name: /^Working copy: mc\/task · task/ })).toBeVisible();
  await choose(panel, "Working copy", "All checkouts");
  await expect(checkouts).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("source-control-worktrees.png") });
});

test("workspace Git stays in the main panel with compact repo rows and an expanded rebase", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Open wallet", exact: true }).click();
  const panel = page.locator('[data-workspace-source-control="G:/wallet"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-git-repository]")).toHaveCount(2);
  const api = panel.locator('[data-git-repository="G:/wallet/api"]');
  const mobile = panel.locator('[data-git-repository="G:/wallet/mobile"]');
  await expect(api.locator("header button[aria-expanded]").first()).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(mobile.locator("header button[aria-expanded]").first()).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(mobile.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await expect(api.getByRole("textbox")).not.toBeVisible();
  await api.locator("header button[aria-expanded]").first().click();
  await expect(api.getByRole("textbox")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("workspace-git-main-panel.png") });
  await panel.evaluate((element) => {
    element.parentElement!.style.width = "320px";
  });
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await panel.evaluate((element) => {
    element.parentElement!.style.width = "520px";
  });
  await api.getByTitle("same.ts", { exact: true }).first().click();
  await expect(page.getByRole("status", { name: "Selected review" })).toHaveText(
    "diff:G:/wallet/api:G:/wallet/api/same.ts",
  );
  await choose(panel, "Repository", "mobile");
  await expect(panel.locator("[data-git-repository]")).toHaveCount(0);
  await expect(mobile).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Selected project" })).toHaveText("G:/wallet");
});

test("workspace name opens its root without a modal, keeps one root entry and preserves child navigation", async ({
  page,
}, testInfo) => {
  const workspace = page.getByRole("button", { name: "Open wallet", exact: true });
  await workspace.click();
  await expect(page.getByRole("status", { name: "Selected project" })).toHaveText("G:/wallet");
  await expect(workspace).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-project-path="G:/wallet"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("workspace-root-selected.png") });
  await page.locator('[data-project-path="G:/wallet/mobile"] button').first().click();
  await expect(page.getByRole("status", { name: "Selected project" })).toHaveText(
    "G:/wallet/mobile",
  );
});

test("ordinary group names are passive and the workspace arrow changes only expansion", async ({
  page,
}) => {
  const group = page.locator('[data-project-group="team"]');
  const name = group.getByText("Team", { exact: true });
  await expect(name).toBeVisible();
  expect(await name.evaluate((element) => element.closest("button") === null)).toBe(true);
  await name.click();
  await expect(page.getByRole("status", { name: "Selected project" })).toHaveText("G:/wallet/api");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const arrow = page.getByRole("button", { name: "wallet, 2 projects", exact: true });
  await arrow.click();
  await expect(arrow).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Open wallet", exact: true }).click();
  await expect(page.getByRole("status", { name: "Selected project" })).toHaveText("G:/wallet");
  await expect(arrow).toHaveAttribute("aria-expanded", "false");
});
