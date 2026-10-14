import { test, expect } from "@playwright/test";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === "passed")
    await page.screenshot({ path: testInfo.outputPath("workspace.png") });
});

test("fetch, pull, push, stage, unstage ve stash doğru depoda çalışır", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog", {
    name: "Commit Graph",
    exact: true,
  });
  for (const name of ["Fetch", "Pull", "Push", "Stage", "Unstage", "Stash"]) {
    await dialog.getByRole("button", { name, exact: true }).click();
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
async function open(page: import("@playwright/test").Page, conflict = false) {
  await page.goto(`/tests/browser/git-workspace.html${conflict ? "?conflict" : ""}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Open full graph", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Commit Graph", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch to feature/graph", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

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
  expect(bounds?.width).toBe(1000);
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
  await expect(output).toHaveText("const theme = 'system';");
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
  await page.getByRole("button", { name: "Three column", exact: true }).click();
  [left, middle, right] = await boxes();
  expect(left.x).toBeLessThan(middle.x);
  expect(middle.x).toBeLessThan(right.x);
  expect(left.y).toBe(middle.y);
  await page.screenshot({ path: testInfo.outputPath("conflict-columns.png") });
  await expect(page.getByRole("button", { name: "Save and stage", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Use incoming", exact: true }).click();
  await expect(output).toHaveText("const theme = 'light';");
  await output.fill("const theme = 'merged';\n");
  await page.getByRole("button", { name: "Focus result", exact: true }).click();
  await expect(ours).toBeHidden();
  await expect(output).toHaveText("const theme = 'merged';");
  await page.getByRole("button", { name: "Twin source", exact: true }).click();
  await expect(output).toHaveText("const theme = 'merged';");
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
