import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

for (const theme of ["light", "dark"] as const)
  for (const width of [800, 1280])
    test(`change row indentation follows root font ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/source-control/git-workspace.html?action-feedback");
      await page.evaluate((light) => {
        document.documentElement.classList.toggle("theme-light", light);
        document.documentElement.style.fontSize = "20px";
      }, theme === "light");
      const list = page.getByRole("listbox", { name: "Changes", exact: true });
      await expect(list.locator("[data-git-file]")).toHaveCount(2);
      const toList = page.getByRole("button", { name: "View as List", exact: true }).first();
      if (await toList.isVisible()) await toList.click();
      const filePadding = () =>
        list
          .locator("[data-git-file]")
          .first()
          .evaluate(
            (button) =>
              getComputedStyle(button.closest("li")!.querySelector("[data-action-host]")!)
                .paddingInlineStart,
          );
      await expect.poll(filePadding).toBe("10px");
      const folder = "temp/verification/git-indent";
      mkdirSync(folder, { recursive: true });
      await list.screenshot({ path: `${folder}/list-${theme}-${width}.png` });
      await page.getByRole("button", { name: "View as Tree", exact: true }).first().click();
      await expect.poll(filePadding).toBe("20px");
      const directory = list.locator("li:not([role='option']) > [data-action-host]").first();
      await expect
        .poll(() => directory.evaluate((node) => getComputedStyle(node).paddingInlineStart))
        .toBe("10px");
      await list.screenshot({ path: `${folder}/tree-${theme}-${width}.png` });
    });

for (const theme of ["light", "dark"] as const)
  for (const width of [800, 1280])
    test(`visual callers graph ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const folder = "temp/verification/visual-callers-workbench";
      const applyTheme = () =>
        page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
      for (const [query, state] of [
        ["action-feedback", "changes"],
        ["checkouts", "workspace-source-control"],
      ]) {
        await page.goto(`/tests/browser/source-control/git-workspace.html?${query}`);
        await applyTheme();
        await expect(page.getByText(/workspace\.tsx/).first()).toBeVisible();
        await page.screenshot({ path: `${folder}/${state}-${theme}-${width}.png` });
      }
      await page.goto("/tests/browser/source-control/git-workspace.html");
      await page.getByRole("button", { name: "Open full graph", exact: true }).click();
      await applyTheme();
      const dialog = page.getByRole("dialog", { name: "Commit Graph", exact: true });
      await expect(
        dialog.getByRole("button", { name: "Working tree actions", exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: `${folder}/graph-working-${theme}-${width}.png` });
      await dialog.getByRole("button").filter({ hasText: "Workspace change 39" }).click();
      await expect(
        dialog.getByRole("searchbox", { name: "Filter commit files", exact: true }),
      ).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Next file", exact: true })).toBeVisible();
      await page.screenshot({ path: `${folder}/graph-inspector-${theme}-${width}.png` });
      await page.goto("/tests/browser/source-control/git-workspace.html?conflict&visual-conflict");
      await applyTheme();
      await expect(
        page.getByRole("radiogroup", { name: "Versions to compare", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("const theme = 'light';", { exact: false }).first(),
      ).toBeVisible();
      await page.screenshot({ path: `${folder}/conflict-ready-${theme}-${width}.png` });
      await page.goto("/tests/browser/source-control/git-workspace.html?image-conflict");
      await applyTheme();
      const figures = page.locator("figure");
      await expect(figures).toHaveCount(2);
      await expect(page.getByRole("img", { name: "Current", exact: true })).toBeVisible();
      await expect(page.getByText("No version on this side", { exact: true })).toBeVisible();
      await expect(figures.first()).toHaveCSS("border-inline-end-width", "1px");
      await expect(figures.last()).toHaveCSS("border-inline-end-width", "0px");
      await page.screenshot({ path: `${folder}/conflict-image-${theme}-${width}.png` });
    });

test("Git actions show progress in place without losing focus or repeating mutations", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/tests/browser/source-control/git-workspace.html?action-feedback");
  await page.locator("#root > div.border-r").evaluate((node) => {
    node.style.width = "100%";
  });
  const sync = page.getByRole("button").filter({ hasText: "Sync Changes" });
  await sync.focus();
  await sync.press("Enter");
  await expect(sync).toHaveAttribute("aria-busy", "true");
  await expect(sync).toBeFocused();
  await expect(page.locator("header").first().getByRole("status")).toHaveCount(0);
  await sync.press("Enter");
  const calls = (command: string) =>
    page.evaluate(
      (name) =>
        (window as unknown as { gitFixtureCalls: { command: string }[] }).gitFixtureCalls.filter(
          (call) => call.command === name,
        ).length,
      command,
    );
  expect(await calls("git_sync")).toBe(1);
  for (const width of [280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      expect(
        await page
          .locator("#root > div.border-r")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`git-pending-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
  await page.evaluate(() =>
    (
      window as unknown as { gitFixtureFinishAction: (command: string) => void }
    ).gitFixtureFinishAction("git_sync"),
  );
  await expect(sync).not.toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: /^Stashes/ }).click();
  // The row's more action is named "Actions for …" at rest and its loading label while busy.
  const stashMenu = page
    .getByRole("listitem")
    .filter({ hasText: "WIP: keyboard navigation" })
    .locator('button[aria-haspopup="menu"]');
  await expect(stashMenu).toHaveAccessibleName("Actions for WIP: keyboard navigation");
  await stashMenu.click();
  await page.getByRole("menuitem", { name: /^Apply\b/ }).click();
  await expect(stashMenu).toHaveAttribute("aria-busy", "true");
  await expect(
    page.getByRole("button", { name: "Stash all changes", exact: true }),
  ).not.toHaveAttribute("aria-busy", "true");
  expect(await calls("git_stash_action")).toBe(1);
  await page.evaluate(() =>
    (window as unknown as { gitFixtureRemount: () => Promise<void> }).gitFixtureRemount(),
  );
  await expect(stashMenu).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() =>
    (
      window as unknown as { gitFixtureFinishAction: (command: string) => void }
    ).gitFixtureFinishAction("git_stash_action"),
  );
  await expect(stashMenu).not.toHaveAttribute("aria-busy", "true");
});

test("hunk targets retain identity and allow keyboard and pointer recovery after a mock failure", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/tests/browser/source-control/git-workspace.html?diff-usability");
  await page.locator("#root > div.border-r").evaluate((node) => {
    node.style.width = "100%";
  });
  const repository = "/fixture/engineering/long-repository-name-for-working-tree-review";
  const relative =
    "src/features/a-very-long-feature-directory/another-long-nested-directory/selected-hunk-review.ts";
  // The header shows the folder name; the shared tooltip carries the full repository path.
  const hint = page.getByRole("tooltip");
  await page.getByText("long-repository-name-for-working-tree-review", { exact: true }).hover();
  await expect(hint).toHaveText(repository);
  await page.mouse.move(0, 0);
  await expect(hint).toHaveCount(0);
  const file = page.locator(`[data-diff-file="${repository}/${relative}"]`);
  // The file header is a labelled action group; its middle-truncated path recovers the full path
  // through the shared overflow hint.
  await file.getByRole("group").first().locator("[data-middle-truncate]").first().hover();
  await expect(hint).toContainText(/selected-hunk-review\.ts/);
  await page.mouse.move(0, 0);
  await expect(hint).toHaveCount(0);
  const hunks = file.getByRole("button", { name: "Stage hunk", exact: true });
  await expect(hunks.first()).toBeAttached();
  await hunks.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Fixture index.lock");
  await expect(file).toBeVisible();
  await expect(file.getByRole("group").first().locator("button[aria-expanded]")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(hunks.first()).toBeFocused();
  const calls = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitFixtureCalls.filter((call) => call.command === "git_stage_contents"),
    );
  const first = (await calls())[0];
  expect(first.args.cwd).toBe(repository);
  expect(first.args.relative).toBe(relative);
  expect(first.args.contents).toContain("value2 = 200");
  expect(first.args.contents).toContain("value22 = 22;");
  expect(first.args.expectedOriginal).toContain("value2 = 2;");
  await hunks.first().locator("..").hover();
  await hunks.first().click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(async () => (await calls()).length).toBe(2);
  expect((await calls())[1].args).toEqual(first.args);
  await hunks.last().scrollIntoViewIfNeeded();
  await hunks.last().focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await calls()).length).toBe(3);
  const last = (await calls())[2];
  expect(last.args.contents).toContain("value2 = 2;");
  expect(last.args.contents).toContain("value22 = 2200;");
  for (const light of [false, true]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    await page.screenshot({
      path: testInfo.outputPath(`hunk-recovery-${light ? "light" : "dark"}.png`),
      animations: "disabled",
    });
  }
});

test("repository overview collapses with keyboard and preserves open panels and drafts", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/source-control/git-workspace.html?submodules");
  const overview = page.getByRole("button", { name: "Repository", exact: true });
  const selector = overview.locator("..").getByRole("button", { name: /^Repository:/ });
  const panel = page.locator('[data-git-repository="/fixture/core-pack"]');
  const row = panel.locator("header button[aria-expanded]").first();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  // Folder and branch share one compact line; the full path remains discoverable.
  await row.hover();
  await expect(page.getByRole("tooltip")).toHaveText(/core-pack.*\/fixture\/core-pack/);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  expect((await panel.locator("header").boundingBox())!.height).toBeLessThanOrEqual(44);
  for (const width of [280, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.locator("#root > div.border-r").evaluate((element, size) => {
      (element as HTMLElement).style.width = `${size}px`;
    }, width);
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      expect(
        await page
          .locator("[data-workspace-source-control]")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`repositories-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
  await row.click();
  const message = panel.getByRole("textbox", { name: "Commit message", exact: true });
  await message.fill("Keep my submodule draft");
  await overview.focus();
  await page.keyboard.press("Enter");
  await expect(overview).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  await expect(selector).toBeVisible();
  await page.keyboard.press("Space");
  await expect(message).toHaveValue("Keep my submodule draft");
  await overview.click();
  await selector.click();
  // Option names carry the path description (label + path) in the accessible name.
  await page.getByRole("option", { name: "core-pack /fixture/core-pack", exact: true }).click();
  await expect(overview).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("textbox", { name: "Commit message", exact: true })).toHaveValue(
    "Keep my submodule draft",
  );
});

test("repository choice survives sidebar remount and reload before delayed submodule discovery", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/source-control/git-workspace.html?submodules&slow-discovery");
  // The overview filter and the Stashes/Graph repository selector have separate scopes.
  const selector = page
    .getByRole("button", { name: "Repository", exact: true })
    .locator("..")
    .getByRole("button", { name: /^Repository:/ });
  await expect(page.locator('[data-git-repository="/fixture/core-pack"]')).toBeVisible();
  await selector.click();
  // Option names carry the path description (label + path) in the accessible name.
  await page.getByRole("option", { name: "core-pack /fixture/core-pack", exact: true }).click();
  await expect(selector).toContainText("core-pack");
  await page.evaluate(async () => {
    await (window as unknown as { gitFixtureRemount: () => Promise<void> }).gitFixtureRemount();
  });
  await expect(selector).toContainText("core-pack");
  await expect(page.getByRole("textbox", { name: "Commit message", exact: true })).toHaveCount(1);
  await expect(page.locator("[data-git-repository]")).toHaveCount(0);
  await page.reload();
  await expect(selector).toContainText("core-pack");
  await expect(page.getByRole("textbox", { name: "Commit message", exact: true })).toHaveCount(1);
  await page.waitForTimeout(650);
  await expect(selector).toContainText("core-pack");
  await expect(page.getByRole("textbox", { name: "Commit message", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Refresh source control", exact: true }).first().click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as unknown as { gitFixtureCalls: { command: string; args: { cwd?: string } }[] }
        ).gitFixtureCalls;
        return calls.filter((call) => call.command === "git_diff_index").at(-1)?.args.cwd;
      }),
    )
    .toBe("/fixture/core-pack");
});

test("a submodule pointer change shows once, on the submodule row", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.goto("/tests/browser/source-control/git-workspace.html?submodules&pointer");
  const parent = page.locator('[data-git-repository="/fixture"]');
  const module = page.locator('[data-git-repository="/fixture/core-pack"]');
  await parent.locator("header button[aria-expanded]").first().click();
  await expect(parent.getByText("README.md")).toBeVisible();
  await expect(parent.getByText("Submodule pointer changes: 1", { exact: false })).toBeVisible();
  await expect(parent.locator("li").filter({ hasText: /^core-pack/ })).toHaveCount(0);
  await expect(module.getByRole("button", { name: "Pointer changed" })).toBeVisible();
  await module.getByRole("button", { name: "Stage the pointer in fixture" }).click();
  await expect(module.getByRole("button", { name: "Pointer staged" })).toBeVisible();
  for (const width of [320, 520]) {
    await page.locator("#root > div.border-r").evaluate((element, size) => {
      (element as HTMLElement).style.width = `${size}px`;
    }, width);
    // The name stays readable beside the badge and its action at every width ("core-pack"
    // needs about 60px; Linux and Windows font metrics differ by a few pixels).
    const name = module.locator("header button[aria-expanded]").first();
    expect((await name.boundingBox())!.width).toBeGreaterThan(64);
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await page.screenshot({
        path: testInfo.outputPath(`submodule-pointer-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
});

test("submodules keep independent drafts, staging, commits and pushes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/source-control/git-workspace.html?submodules");
  const parent = page.locator('[data-git-repository="/fixture"]');
  const module = page.locator('[data-git-repository="/fixture/core-pack"]');
  const nested = page.locator('[data-git-repository="/fixture/core-pack/nested"]');
  await expect(nested).toBeVisible();
  for (const panel of [parent, module])
    await panel.locator("header button[aria-expanded]").first().click();
  const parentMessage = parent.getByRole("textbox", { name: "Commit message", exact: true });
  const message = module.getByRole("textbox", { name: "Commit message", exact: true });
  await parentMessage.fill("Parent draft stays here");
  await message.fill("Commit only the submodule");
  await module.getByRole("button", { name: "Stage All Changes", exact: true }).click();
  await expect(module.getByRole("button", { name: "Stage All Changes", exact: true })).toHaveCount(
    0,
  );
  // Commit leads; Commit & Push is one menu choice away.
  await module.getByRole("button", { name: "Commit options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Commit & Push", exact: true }).click();
  // The submodule is on its default branch: the push asks first in the in-app dialog.
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(message).toHaveValue("");
  await expect(parentMessage).toHaveValue("Parent draft stays here");
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitFixtureCalls,
  );
  for (const command of ["git_stage_all", "git_commit", "git_push"]) {
    const mutations = calls.filter((call) => call.command === command);
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.every((call) => call.args.cwd === "/fixture/core-pack")).toBe(true);
  }
  for (const width of [280, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator("#root > div.border-r").evaluate((element, size) => {
      (element as HTMLElement).style.width = `${size}px`;
    }, width);
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      expect(await module.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
  }
  await page.screenshot({ path: testInfo.outputPath("submodules.png") });
});

test("new branch from accepts typed references with branch suggestions", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/source-control/git-workspace.html?checkouts");
  await page
    .getByRole("button", { name: /^Branch / })
    .first()
    .click();
  await page.getByRole("button", { name: "New branch from…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New branch from…", exact: true });
  const base = dialog.getByLabel("Base branch", { exact: true });
  const name = dialog.getByLabel("Branch name", { exact: true });
  const create = dialog.getByRole("button", { name: "Create branch", exact: true });
  await expect(name).toBeFocused();
  expect(
    await base.evaluate((element) =>
      Array.from((element as HTMLInputElement).list!.options, (option) => option.value),
    ),
  ).toContain("origin/feature/team");
  await name.fill("feature/from-typed-reference");
  await base.fill("   ");
  await expect(create).toBeDisabled();
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await base.fill("origin/unlisted");
      await expect(base).toHaveValue("origin/unlisted");
      await base.press("Tab");
      await expect(name).toBeFocused();
      await expect(create).toBeEnabled();
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
  }
  await name.press("Enter");
  await expect(dialog).toBeHidden();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).gitFixtureCalls,
  );
  expect(calls.find((call) => call.command === "git_create_branch_from")?.args).toMatchObject({
    name: "feature/from-typed-reference",
    reference: "origin/unlisted",
  });
});

test("grouped commit forms retain their height and drafts after disclosure and resize", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/source-control/git-workspace.html?repositories");
  const panel = page.locator("[data-git-repository]").first();
  const toggle = panel.locator("header button[aria-expanded]").first();
  const message = panel.getByRole("textbox", { name: "Commit message", exact: true });
  // The borderless editor sits inside a FieldControl frame, which owns the visible height.
  const frame = message.locator("xpath=ancestor::*[@data-field-control][1]");
  await toggle.click();
  await expect(message).toBeVisible();
  // The commit message is a compact (fieldSize="sm", 28px) field that grows with its draft.
  expect((await frame.boundingBox())!.height).toBeGreaterThanOrEqual(28);
  const draft =
    "Preserve the worktree commit draft while its panel is reopened\n\nA longer body that wraps differently as the sidebar width changes.";
  await message.fill(draft);
  await toggle.click();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(message).toHaveValue(draft);
  for (const width of [280, 390, 566]) {
    await page.setViewportSize({ width, height: 650 });
    await page.locator("#root > div.border-r").evaluate((element, size) => {
      (element as HTMLElement).style.width = `${size}px`;
    }, width);
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await expect.poll(async () => (await frame.boundingBox())!.height).toBeGreaterThan(32);
      // One contextual primary (Commit or sync) sits below the message in a single row with
      // its menu. The autosized message can still be settling after a width or theme change,
      // so measure all three boxes together until the layout is stable.
      const primary = panel.locator('[data-split-part="primary"]').first();
      const optionsButton = panel.getByRole("button", { name: "Commit options", exact: true });
      await expect
        .poll(async () => {
          const input = (await frame.boundingBox())!;
          const commit = (await primary.boundingBox())!;
          const options = (await optionsButton.boundingBox())!;
          return commit.y >= input.y + input.height - 0.5 && Math.abs(options.y - commit.y) < 2;
        })
        .toBe(true);
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await expect(panel.getByRole("button", { name: "Commit options" })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`commit-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
  await toggle.click();
  await toggle.click();
  await expect(message).toHaveValue(draft);
  await expect(message).toBeVisible();
  // Reopening keeps the draft immediately; ResizeObserver fits the revealed
  // textarea on the next animation frame. Wait for that actual layout result.
  await expect.poll(async () => (await message.boundingBox())!.height).toBeGreaterThan(32);
});

test("compact checkout header and branch fetch remain usable across widths and themes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/source-control/git-workspace.html?checkouts");
  const header = page.locator("[data-workspace-source-control] > div").first();
  const branch = page.getByRole("button", { name: /^Branch / }).first();
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await expect(header.getByText("Working copy", { exact: true })).toHaveCount(0);
      await expect(header.getByRole("button", { name: /^Working copy:/ })).toBeVisible();
      expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      // The switch hint is the shared tooltip (no native title).
      await branch.hover();
      await expect(page.getByRole("tooltip")).toContainText("Switch branch in this working copy");
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await branch.focus();
      await page.keyboard.press("Enter");
      const picker = page.locator("[data-branch-picker]");
      await expect(picker.getByRole("button", { name: "Fetch", exact: true })).toBeVisible();
      expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`compact-${width}-${light ? "light" : "dark"}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
    }
  }
  await branch.click();
  await page.getByRole("button", { name: "Fetch", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { gitFixtureCalls: { command: string; args: { cwd?: string } }[] }
          ).gitFixtureCalls.filter((call) => call.command === "git_fetch").length,
      ),
    )
    .toBe(1);
  await expect(page.locator("[data-branch-picker]")).toBeVisible();
});

test("grouped repository files allow wheel scrolling the outer list", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.setViewportSize({ width: 390, height: 450 });
  await page.goto("/tests/browser/source-control/git-workspace.html?repositories");
  const panels = page.locator("[data-git-repository]");
  await expect(panels).toHaveCount(3);
  for (const panel of await panels.all()) {
    await panel.locator("header button[aria-expanded]").first().click();
  }
  const outer = page.locator("[data-workspace-source-control] .overflow-y-auto").first();
  await outer.evaluate((element) => {
    element.scrollTop = 0;
  });
  expect(await outer.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await panels.first().getByText("workspace.tsx", { exact: true }).hover();
  // Hover scrolls an offscreen file into view before dispatching the wheel event.
  const baseline = await outer.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBeGreaterThan(baseline);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBe(baseline);
  await panels.first().getByText("workspace.tsx", { exact: true }).hover();
  const diagonalBaseline = await outer.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(20, 100);
  await expect
    .poll(() => outer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(diagonalBaseline);
});

test("checkout panels preserve identity, keyboard expansion and searchable selection", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.goto("/tests/browser/source-control/git-workspace.html?checkouts");
  // The picker opens on the session checkout; the overview lists every checkout.
  await page.getByRole("button", { name: /^Working copy:/ }).click();
  await page.getByRole("option", { name: "All checkouts", exact: true }).click();
  const list = page.locator("[data-checkout-overview]");
  const panelFor = (cwd: string) => list.locator(`[data-git-repository="${cwd}"]`);
  const headerFor = (cwd: string) => panelFor(cwd).locator("header button[aria-expanded]").first();
  const row = headerFor("/trees/audit/very-long-worktree-folder-name");
  await expect(list.locator("[data-git-repository]")).toHaveCount(3);
  await expect(headerFor("/fixture")).toHaveAttribute("aria-expanded", "true");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  // The shared tooltip retains exact repository paths without repeating them in rows.
  for (const path of ["/trees/audit/very-long-worktree-folder-name", "/fixture"]) {
    await headerFor(path).hover();
    await expect(page.getByRole("tooltip")).toHaveCount(1);
    await expect(page.getByRole("tooltip")).toContainText(path);
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    // Tooltip focus hints follow keyboard modality, not programmatic pointer focus.
    await page.keyboard.press("Tab");
    await headerFor(path).focus();
    await expect(page.getByRole("tooltip")).toHaveCount(1);
    await expect(page.getByRole("tooltip")).toContainText(path);
    await headerFor(path).blur();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await expect(row).toContainText("audit/2026-10-14-long-branch-name-for-responsive-review");
      await expect(row).toContainText("very-long-worktree-folder-name");
      // Full repository panels retain the same horizontal containment as the picker.
      await expect
        .poll(() =>
          list.evaluate((element) =>
            [element, ...element.querySelectorAll("[data-git-repository]")].every(
              (node) => node.scrollWidth <= node.clientWidth,
            ),
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`checkouts-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(
    panelFor("/trees/audit/very-long-worktree-folder-name").getByText("workspace.tsx", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Working copy: All checkouts", exact: true }).click();
  await page.getByRole("combobox").fill("audit");
  await page
    .getByRole("option")
    .filter({ hasText: "/trees/audit/very-long-worktree-folder-name" })
    .click();
  await expect(list).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Working copy: very-long-worktree-folder-name/ }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`all checkouts expose independent repository changes and drafts: ${theme} ${width}`, async ({
      page,
    }) => {
      await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        "/tests/browser/source-control/git-workspace.html?checkouts&all-repositories",
      );
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: /^Working copy:/ }).click();
      await page.getByRole("option", { name: "All checkouts", exact: true }).click();
      const overview = page.locator("[data-checkout-overview]");
      const main = overview.locator('[data-git-repository="/fixture"]');
      const worktree = overview.locator('[data-git-repository="/trees/cross-provider"]');
      const mobile = overview.locator('[data-git-repository="/fixture/mobile"]');
      const toggle = (panel: typeof main) => panel.locator("header button[aria-expanded]").first();
      const message = (panel: typeof main) =>
        panel.getByRole("textbox", { name: "Commit message", exact: true });
      await expect(overview.locator("[data-git-repository]")).toHaveCount(3);
      await expect(toggle(main)).toHaveAttribute("aria-expanded", "true");
      await expect(toggle(worktree)).toHaveAttribute("aria-expanded", "false");
      await expect(toggle(mobile)).toHaveAttribute("aria-expanded", "false");
      await expect(main.getByText("workspace.tsx", { exact: true })).toBeVisible();
      await expect(main.getByText("theme.css", { exact: true })).toBeVisible();
      await message(main).fill("Main checkout draft stays here");
      const evidence = "temp/verification/2026-11-06-all-checkouts";
      mkdirSync(evidence, { recursive: true });
      for (const sidebar of [570, 400]) {
        await page.locator("#root > div.border-r").evaluate((element, size) => {
          (element as HTMLElement).style.width = `${size}px`;
        }, sidebar);
        await main.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${evidence}/overview-${theme}-${width}-${sidebar}.png` });
      }
      await toggle(worktree).focus();
      await page.keyboard.press("Enter");
      await expect(worktree.getByText("parity.ts", { exact: true })).toBeVisible();
      await expect(worktree.getByText("accounts.ts", { exact: true })).toBeVisible();
      await message(worktree).fill("Worktree draft stays here");
      for (const sidebar of [570, 400]) {
        await page.locator("#root > div.border-r").evaluate((element, size) => {
          (element as HTMLElement).style.width = `${size}px`;
        }, sidebar);
        await worktree.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${evidence}/worktree-${theme}-${width}-${sidebar}.png` });
      }
      await toggle(mobile).click();
      await expect(mobile.getByText("index.tsx", { exact: true })).toBeVisible();
      await expect(mobile.getByText("theme.ts", { exact: true })).toBeVisible();
      await expect(mobile.getByText("app.json", { exact: true })).toBeVisible();
      await message(mobile).fill("Mobile draft stays here");
      await toggle(mobile).click();
      await expect(message(mobile)).not.toBeVisible();
      await toggle(mobile).click();
      await expect(message(mobile)).toHaveValue("Mobile draft stays here");
      for (const sidebar of [570, 400]) {
        await page.locator("#root > div.border-r").evaluate((element, size) => {
          (element as HTMLElement).style.width = `${size}px`;
        }, sidebar);
        await mobile.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${evidence}/mobile-${theme}-${width}-${sidebar}.png` });
        expect(
          await overview.evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
      }
      await mobile.getByRole("button", { name: "Stage All Changes", exact: true }).click();
      await expect(
        mobile.getByRole("button", { name: "Stage All Changes", exact: true }),
      ).toHaveCount(0);
      await expect(
        main.getByRole("button", { name: "Stage All Changes", exact: true }),
      ).toBeAttached();
      await expect(
        worktree.getByRole("button", { name: "Stage All Changes", exact: true }),
      ).toBeAttached();
      await expect(message(main)).toHaveValue("Main checkout draft stays here");
      await expect(message(worktree)).toHaveValue("Worktree draft stays here");
      const calls = await page.evaluate(
        () =>
          (
            window as unknown as {
              gitFixtureCalls: { command: string; args: Record<string, unknown> }[];
            }
          ).gitFixtureCalls,
      );
      expect(
        calls.filter((call) => call.command === "git_stage_all").map((call) => call.args.cwd),
      ).toEqual(["/fixture/mobile"]);
      expect(
        calls.some(
          (call) =>
            call.command === "git_submodules" &&
            call.args.cwd === "/fixture" &&
            call.args.includeRepositories === true,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: /^Working copy:/ }).click();
      await page.getByRole("option").filter({ hasText: "/fixture/mobile" }).click();
      await expect(page.getByRole("textbox", { name: "Commit message", exact: true })).toHaveValue(
        "Mobile draft stays here",
      );
      await page.getByRole("button", { name: /^Working copy:/ }).click();
      await page.getByRole("option", { name: "All checkouts", exact: true }).click();
      await expect(message(main)).toHaveValue("Main checkout draft stays here");
      await expect(message(worktree)).toHaveValue("Worktree draft stays here");
      await expect(message(mobile)).toHaveValue("Mobile draft stays here");
    });
  }

for (const theme of ["light", "dark"] as const)
  for (const width of [800, 1280]) {
    test(`conflict row compact geometry ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/source-control/git-workspace.html?conflict&action-feedback");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const row = page.locator('[data-conflict="src/conflict.ts"] [data-action-host]');
      await expect(row).toBeVisible();
      const height = await row.evaluate((node) => {
        const probe = document.createElement("div");
        probe.style.height = "var(--ui-control-height-compact)";
        node.append(probe);
        const result = {
          actual: node.getBoundingClientRect().height,
          expected: probe.getBoundingClientRect().height,
        };
        probe.remove();
        return result;
      });
      expect(Math.abs(height.actual - height.expected)).toBeLessThan(1);
      mkdirSync("temp/verification/feature-controls", { recursive: true });
      await page.screenshot({
        path: `temp/verification/feature-controls/conflict-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }
