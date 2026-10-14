import { expect, test, type Locator } from "@playwright/test";

test("rail appearance keeps two icon rows and applies independent translucent colors", async ({
  page,
}, testInfo) => {
  await page
    .locator('[data-project-group="wallet"] > .project-reorder-item')
    .click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Project group actions", exact: true });
  const icons = menu.getByRole("group", { name: "Project icons", exact: true });
  await expect(icons).toHaveCSS("height", "140px");
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
  await menu
    .getByRole("slider")
    .first()
    .evaluate((node: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, "35");
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
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
  await page.locator('[data-project-path="G:/wallet/api"]').click({ button: "right" });
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
    expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
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
