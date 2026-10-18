import { test, expect } from "@playwright/test";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === "passed")
    await page.screenshot({ path: testInfo.outputPath("workspace.png") });
});

test("column filters combine and remain resettable with no matches", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page);
  const graph = page.getByRole("region", { name: "Commit Graph", exact: true });
  await graph.getByRole("button", { name: "Filter Author", exact: true }).click();
  const author = page.getByRole("dialog", { name: "Filter Author", exact: true });
  await author.getByRole("textbox", { name: "Author", exact: true }).fill("Deniz");
  await author.getByRole("textbox").press("Escape");
  await expect(graph.locator(".git-history-item")).toHaveCount(20);
  await graph.getByRole("button", { name: "Filter Commit Message", exact: true }).click();
  const message = page.getByRole("dialog", { name: "Filter Commit Message", exact: true });
  await message.getByRole("textbox").fill("no such commit");
  await expect(graph).toContainText("No matching commits");
  await message.getByRole("button", { name: "Reset all filters", exact: true }).click();
  await message.getByRole("textbox").press("Escape");
  await expect(graph.locator(".git-history-item")).toHaveCount(40);
});

test("stash actions fit a narrow rail and commit files remain navigable", async ({
  page,
}, testInfo) => {
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Commit Graph", exact: true });
  const sash = dialog.getByRole("separator", { name: "Resize branches", exact: true });
  await sash.focus();
  await sash.press("Home");
  await dialog.getByRole("button", { name: /^Stashes/ }).click();
  const stash = dialog.getByRole("button", { name: "WIP: keyboard navigation", exact: true });
  await expect(stash).toBeVisible();
  expect(
    await stash.evaluate((element) => {
      const rail = element.closest("aside")!;
      return rail.scrollWidth <= rail.clientWidth;
    }),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("stash-narrow.png") });
  await dialog
    .getByRole("button", { name: "Actions for WIP: keyboard navigation", exact: true })
    .click();
  await expect(page.getByRole("menuitem", { name: /^Apply\b/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /^Apply\b/ }).press("Escape");
  await dialog.getByRole("button").filter({ hasText: "Workspace change 39" }).click();
  const search = dialog.getByRole("searchbox", { name: "Filter commit files", exact: true });
  await search.fill("theme");
  await expect(
    dialog.getByRole("region", { name: "Changed files", exact: true }).getByRole("button"),
  ).toHaveCount(1);
  await search.fill("");
  await dialog.getByRole("button", { name: "Next file", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Previous file", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("commit-inspector.png") });
  await dialog.getByRole("button", { name: "Changed files", exact: true }).click();
  await expect(search).toBeHidden();
  await expect(dialog.getByRole("button", { name: "Next file", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close commit details", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Working tree actions", exact: true }),
  ).toBeVisible();
});

test("graph scope, file filtering and keyboard resizing preserve Git context", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog", { name: "Commit Graph", exact: true });
  await dialog.getByRole("radio", { name: "Current branch", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Current branch", exact: true })).toBeChecked();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
            }
          ).gitFixtureCalls
            .filter((call) => call.command === "git_history")
            .slice(-1)[0]?.args.all,
      ),
    )
    .toBe(false);

  await dialog.getByRole("button", { name: "Filter changed files", exact: true }).click();
  const filter = page.getByRole("dialog", { name: "Filter changed files", exact: true });
  await filter.getByRole("searchbox", { name: "File or folder name" }).fill("theme");
  await expect(
    dialog.getByRole("listbox", { name: "Changes", exact: true }).locator("[data-git-file]"),
  ).toHaveCount(1);
  await expect(dialog.getByRole("listbox", { name: "Changes", exact: true })).toContainText(
    "theme.css",
  );
  await filter.getByRole("searchbox").press("Escape");
  await expect(filter).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Filter changed files", exact: true }),
  ).toBeFocused();
  const branchSash = dialog.getByRole("separator", { name: "Resize branches", exact: true });
  await branchSash.focus();
  const before = Number(await branchSash.getAttribute("aria-valuenow"));
  await branchSash.press("ArrowRight");
  expect(Number(await branchSash.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
});

for (const appearance of ["dark", "light"] as const) {
  test(`graph layout in ${appearance} theme and reduced motion`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: appearance });
    await open(page);
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle("theme-light", theme === "light");
    }, appearance);
    const dialog = page.getByRole("dialog", { name: "Commit Graph", exact: true });
    await expect(dialog).toBeInViewport({ ratio: 1 });
    const graph = dialog.getByRole("region", { name: "Commit Graph", exact: true });
    await expect(graph.getByText("Author", { exact: true })).toBeVisible();
    await expect(graph.getByText("Date", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`graph-${appearance}-wide.png`) });
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByRole("button", { name: "Working tree actions", exact: true }),
    ).toBeVisible();
    await expect(graph.getByText("Date", { exact: true })).toBeVisible();
    await expect(graph.getByText("Author", { exact: true })).toBeHidden();
  });
}

test("fetch, pull, push, stage, unstage ve stash doğru depoda çalışır", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog", {
    name: "Commit Graph",
    exact: true,
  });
  for (const name of ["Fetch", "Pull", "Push"]) {
    await dialog.getByRole("button", { name: new RegExp(`^${name}(?:\\s*\\d+)?$`) }).click();
    await expect(dialog.getByRole("button", { name: "Fetch", exact: true })).toBeEnabled();
  }
  for (const name of ["Stage All Changes", "Unstage All Changes", "Stash"]) {
    await dialog.getByRole("button", { name: "Working tree actions", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Fetch", exact: true })).toBeEnabled();
  }
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitFixtureCalls,
  );
  for (const command of [
    "git_fetch",
    "git_pull",
    "git_push",
    "git_stage_all",
    "git_unstage_all",
    "git_stash",
  ])
    expect(calls.find((call) => call.command === command)?.args.cwd).toBe("/fixture");
});

test("yerel ve origin branch silme ayrı aksiyonlar kullanır", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Actions for develop", exact: true }).click();
  await page.getByText("Delete Branch…", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Actions for develop", exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", {
      name: "Actions for origin/feature/team",
      exact: true,
    })
    .click();
  await page.getByText("Delete from remote…", { exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Actions for origin/feature/team",
      exact: true,
    }),
  ).toHaveCount(0);
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitFixtureCalls,
  );
  expect(calls.find((call) => call.command === "git_delete_branch")?.args).toMatchObject({
    cwd: "/fixture",
    name: "develop",
    force: false,
  });
  expect(calls.find((call) => call.command === "git_delete_remote_branch")?.args).toMatchObject({
    cwd: "/fixture",
    remote: "origin",
    name: "feature/team",
  });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
});

test("commit sağ tık menüsü değişiklik, blame, GitHub ve kopyalama aksiyonlarını çalıştırır", async ({
  page,
  context,
  browserName,
}, testInfo) => {
  if (browserName === "webkit") {
    // WebKit cannot grant clipboard permissions through Playwright. Capture
    // the actual clipboard API payload; Chromium still checks its real clipboard.
    testInfo.annotations.push({
      type: "clipboard",
      description:
        "WebKit verifies clipboard API payloads with a fixture shim; Chromium verifies the real clipboard.",
    });
    await page.addInitScript(() => {
      let clipboardText = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            clipboardText = text;
          },
          readText: async () => clipboardText,
        },
      });
    });
  } else {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  await open(page);
  const dialog = page.getByRole("dialog", {
    name: "Commit Graph",
    exact: true,
  });
  const row = dialog.getByRole("button").filter({ hasText: "Workspace change 39" });
  const pick = async (name: string) => {
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  await row.click({ button: "right" });
  for (const name of [
    "Open Changes",
    "Open in Blame",
    "Open on GitHub",
    "Checkout (Detached)",
    "Create Branch…",
    "Create Tag…",
    "Cherry-Pick",
    "Revert Commit",
    "Reset Current Branch to Here",
    "Copy Commit ID",
    "Copy Commit Message",
  ])
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("commit-menu.png") });
  await page.getByRole("menuitem", { name: "Open Changes", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Workspace change 39", exact: true }),
  ).toBeVisible();
  await pick("Open in Blame");
  await expect(dialog.getByRole("region", { name: "Blame at commit", exact: true })).toContainText(
    "Deniz Yılmaz",
  );
  await pick("Copy Commit ID");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "0000000000000000000000000000000000000027",
  );
  await pick("Copy Commit Message");
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(
    "Workspace change 39\n\nFull commit body.",
  );
  await pick("Open on GitHub");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            gitFixtureCalls: {
              command: string;
              args: Record<string, unknown>;
            }[];
          }
        ).gitFixtureCalls.some((call) => call.command === "plugin:opener|open_url"),
      ),
    )
    .toBe(true);
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitFixtureCalls,
  );
  expect(calls.find((call) => call.command === "git_blame")?.args).toMatchObject({
    cwd: "/fixture",
    sha: "0000000000000000000000000000000000000027",
    relative: "src/workspace.tsx",
  });
  expect(calls.find((call) => call.command === "plugin:opener|open_url")?.args.url).toBe(
    "https://github.com/fixture/workspace/commit/0000000000000000000000000000000000000027",
  );
});

test("commit sağ tık menüsünün Git aksiyonları seçilen SHA ile çalışır", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog", {
    name: "Commit Graph",
    exact: true,
  });
  const row = dialog.getByRole("button").filter({ hasText: "Workspace change 39" });
  const pick = async (name: string) => {
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  for (const name of ["Checkout (Detached)", "Cherry-Pick", "Revert Commit"]) {
    await pick(name);
    await expect(dialog.getByRole("button", { name: "Fetch", exact: true })).toBeEnabled();
  }
  await pick("Create Branch…");
  await page.getByRole("textbox", { name: "Branch name", exact: true }).fill("feature/from-commit");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Branch name", exact: true })).toHaveCount(0);
  await pick("Create Tag…");
  await page.getByRole("textbox", { name: "Tag name", exact: true }).fill("v2.0.0");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Tag name", exact: true })).toHaveCount(0);
  for (const name of ["Soft", "Mixed", "Hard"]) {
    await pick("Reset Current Branch to Here");
    await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
    await expect(dialog.getByRole("button", { name: "Fetch", exact: true })).toBeEnabled();
  }
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitFixtureCalls,
  );
  for (const command of [
    "git_checkout_commit",
    "git_cherry_pick",
    "git_revert",
    "git_create_branch_at",
    "git_create_tag",
    "git_reset",
  ])
    expect(calls.find((call) => call.command === command)?.args).toMatchObject({
      cwd: "/fixture",
      sha: "0000000000000000000000000000000000000027",
    });
  expect(
    calls.filter((call) => call.command === "git_reset").map((call) => call.args.mode),
  ).toEqual(["soft", "mixed", "hard"]);
});
async function open(page: import("@playwright/test").Page, conflict = false, large = false) {
  await page.goto(
    `/tests/browser/git-workspace.html${conflict ? "?conflict" : large ? "?large" : ""}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await page.getByRole("button", { name: "Open full graph", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Commit Graph", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch to feature/graph", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

test("large histories and file lists stay windowed; searching does not query Git", async ({
  page,
}, testInfo) => {
  await open(page, false, true);
  const dialog = page.getByRole("dialog", { name: "Commit Graph", exact: true });
  const graph = dialog.getByRole("region", { name: "Commit Graph", exact: true });
  await expect(graph.locator("li button.git-history-item").first()).toBeVisible();
  expect(await graph.locator("li button.git-history-item").count()).toBeLessThan(70);
  const changes = dialog.getByRole("listbox", { name: "Changes", exact: true });
  await expect(changes.locator("[data-git-file]").first()).toBeVisible();
  expect(await changes.locator("[data-git-file]").count()).toBeLessThan(40);
  const historyCalls = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
          }
        ).gitFixtureCalls.filter((call) => call.command === "git_history").length,
    );
  const before = await historyCalls();
  await dialog
    .getByRole("textbox", { name: "Search commits", exact: true })
    .fill("Workspace change 4999");
  await expect(graph.locator("li button.git-history-item")).toHaveCount(1);
  expect(await historyCalls()).toBe(before);
  await dialog.getByRole("textbox", { name: "Search commits", exact: true }).fill("");
  await dialog.getByRole("button", { name: "Filter changed files", exact: true }).click();
  const filter = page.getByRole("dialog", { name: "Filter changed files", exact: true });
  await filter.getByRole("searchbox").fill("feature-596");
  await expect(changes.locator("[data-git-file]")).toHaveCount(1);
  await expect(changes).toContainText("feature-596");
  await page.screenshot({ path: testInfo.outputPath("large-filtered.png") });
});

test("branch, commit ve dosya karşılaştırması panel içinde kalır", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog", {
    name: "Commit Graph",
    exact: true,
  });
  await dialog.getByRole("button").filter({ hasText: "Improve workspace navigation" }).click();
  await expect(dialog.getByRole("heading", { name: "Improve workspace navigation" })).toBeVisible();
  await dialog.getByRole("button").filter({ hasText: "src/theme.css" }).click();
  await expect(dialog.getByText("const after = true;", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Side-by-side view", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Side-by-side view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Full screen", exact: true }).click();
  const bounds = await dialog.boundingBox();
  expect(bounds?.x).toBe(0);
  expect(bounds?.width).toBe(page.viewportSize()?.width);
  await expect(dialog.getByRole("button", { name: "Restore window", exact: true })).toBeVisible();
});

test("branch değiştirme ve başka referanstan branch oluşturma", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Switch to feature/graph", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Switch to feature/graph", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Actions for origin/feature/team",
      exact: true,
    })
    .click();
  await page.getByText("Create branch from here…", { exact: true }).click();
  await page.getByRole("textbox", { name: "Branch name", exact: true }).fill("feature/review");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Switch to feature/review", exact: true }),
  ).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitFixtureCalls,
  );
  expect(calls.find((call) => call.command === "git_create_branch_from")?.args).toMatchObject({
    reference: "origin/feature/team",
    name: "feature/review",
    cwd: "/fixture",
  });
});

test("conflict sonucu panel içinde düzenlenip stage edilir ve merge sürdürülür", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await open(page, true);
  await page.locator('button[title="Open src/conflict.ts in the editor"]').click();
  await page.getByRole("separator", { name: "Resize inspector" }).press("End");
  const output = page.getByRole("textbox", {
    name: "Resolved output",
    exact: true,
  });
  await expect(output.locator(".cm-line").first()).toHaveText("const theme = 'system';");
  const workspace = page.locator(".conflict-workspace");
  // Inspector resizing settles asynchronously, especially in WebKit.
  await expect.poll(async () => (await workspace.boundingBox())?.width ?? 0).toBeGreaterThan(600);
  const ours = workspace.locator(".conflict-pane-ours");
  const theirs = workspace.locator(".conflict-pane-theirs");
  const result = workspace.locator(".conflict-pane-result");
  await expect(ours).toContainText("HEAD");
  await expect(theirs).toContainText("feature/theme");
  await expect(ours.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await expect(theirs.locator(".cm-content")).toContainText("const theme = 'light';");
  const boxes = async () => {
    const rects = await Promise.all([
      ours.boundingBox(),
      result.boundingBox(),
      theirs.boundingBox(),
    ]);
    expect(rects.every(Boolean)).toBe(true);
    return rects as { x: number; y: number; width: number; height: number }[];
  };
  let [left, middle, right] = await boxes();
  expect(left.x).toBeLessThan(right.x);
  expect(left.y).toBe(right.y);
  expect(middle.y).toBeGreaterThan(left.y);
  await page.screenshot({ path: testInfo.outputPath("conflict-stacked.png") });
  await page.getByRole("button", { name: "Side by side", exact: true }).click();
  [left, middle, right] = await boxes();
  expect(left.x).toBeLessThan(middle.x);
  expect(middle.x).toBeLessThan(right.x);
  expect(left.y).toBe(middle.y);
  await page.screenshot({ path: testInfo.outputPath("conflict-columns.png") });
  await expect(page.getByRole("button", { name: "Save and stage", exact: true })).toBeDisabled();
  await page
    .getByRole("group", { name: "Conflict 1 of 1", exact: true })
    .getByRole("button", { name: "Accept Incoming", exact: true })
    .click();
  await expect(output.locator(".cm-line").first()).toHaveText("const theme = 'light';");
  // CodeMirror owns select-all; DOM fill trips over the non-editable action widget in WebKit.
  await output.locator(".cm-line").first().click();
  await output.press("ControlOrMeta+a");
  await page.keyboard.insertText("const theme = 'merged';\n");
  await page.getByRole("button", { name: "Result only", exact: true }).click();
  await expect(ours).toBeHidden();
  await expect(output.locator(".cm-line").first()).toHaveText("const theme = 'merged';");
  await page.getByRole("button", { name: "Sources above", exact: true }).click();
  await expect(output.locator(".cm-line").first()).toHaveText("const theme = 'merged';");
  await page.setViewportSize({ width: 700, height: 900 });
  [left, middle, right] = await boxes();
  expect(left.y).toBeLessThan(right.y);
  expect(right.y).toBeLessThan(middle.y);
  await page.screenshot({ path: testInfo.outputPath("conflict-narrow.png") });
  await page.getByRole("button", { name: "Save and stage", exact: true }).click();
  await expect(output).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitFixtureCalls,
  );
  expect(calls.find((call) => call.command === "write_text_file")?.args).toMatchObject({
    path: "/fixture/src/conflict.ts",
    content: "const theme = 'merged';\n",
  });
  expect(calls.some((call) => call.command === "git_operation_continue")).toBe(true);
});
