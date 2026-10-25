import { test, expect } from "@playwright/test";

test("Git actions show progress in place without losing focus or repeating mutations", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/tests/browser/git-workspace.html?action-feedback");
  await page.locator("#root > div").evaluate((node) => {
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
        await page.locator("#root > div").evaluate((node) => node.scrollWidth <= node.clientWidth),
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
  const stashMenu = page.getByTitle("Actions for WIP: keyboard navigation", { exact: true });
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
  await page.goto("/tests/browser/git-workspace.html?diff-usability");
  await page.locator("#root > div").evaluate((node) => {
    node.style.width = "100%";
  });
  const repository = "/fixture/engineering/long-repository-name-for-working-tree-review";
  const relative =
    "src/features/a-very-long-feature-directory/another-long-nested-directory/selected-hunk-review.ts";
  await expect(page.getByTitle(repository, { exact: true })).toBeVisible();
  const file = page.locator(`[data-diff-file="${repository}/${relative}"]`);
  await expect(file.locator("header span[title]").first()).toHaveAttribute(
    "title",
    /selected-hunk-review\.ts/,
  );
  const hunks = file.getByRole("button", { name: "Stage hunk", exact: true });
  await expect(hunks.first()).toBeAttached();
  await hunks.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Fixture index.lock");
  await expect(file).toBeVisible();
  await expect(file.locator("header button[aria-expanded]")).toHaveAttribute(
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
  await page.goto("/tests/browser/git-workspace.html?submodules");
  const overview = page.getByRole("button", { name: "Repository", exact: true });
  const selector = page.getByRole("button", { name: /^Repository:/ });
  const panel = page.locator('[data-git-repository="/fixture/core-pack"]');
  const row = panel.locator("header button[aria-expanded]").first();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  // Repository identity occupies one line; its full path remains discoverable.
  await expect(row).toHaveAttribute("title", /core-pack.*\/fixture\/core-pack/);
  expect((await panel.locator("header").boundingBox())!.height).toBeLessThanOrEqual(40);
  for (const width of [280, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.locator("#root > div").evaluate((element, size) => {
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
  await page.getByRole("option", { name: "Submodule · core-pack", exact: true }).click();
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
  await page.goto("/tests/browser/git-workspace.html?submodules&slow-discovery");
  const selector = page.getByRole("button", { name: /^Repository:/ });
  await expect(page.locator('[data-git-repository="/fixture/core-pack"]')).toBeVisible();
  await selector.click();
  await page.getByRole("option", { name: "Submodule · core-pack", exact: true }).click();
  await expect(selector).toContainText("Submodule · core-pack");
  await page.evaluate(async () => {
    await (window as unknown as { gitFixtureRemount: () => Promise<void> }).gitFixtureRemount();
  });
  await expect(selector).toContainText("Submodule · core-pack");
  await expect(page.getByRole("textbox", { name: "Commit message", exact: true })).toHaveCount(1);
  await expect(page.locator("[data-git-repository]")).toHaveCount(0);
  await page.reload();
  await expect(selector).toContainText("core-pack");
  await expect(page.getByRole("textbox", { name: "Commit message", exact: true })).toHaveCount(1);
  await page.waitForTimeout(650);
  await expect(selector).toContainText("Submodule · core-pack");
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

test("submodules keep independent drafts, staging, commits and pushes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/git-workspace.html?submodules");
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
  await module.getByRole("button", { name: "Commit options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Commit & Push", exact: true }).click();
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
    await page.locator("#root > div").evaluate((element, size) => {
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
  await page.goto("/tests/browser/git-workspace.html?checkouts");
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
  await page.goto("/tests/browser/git-workspace.html?repositories");
  const panel = page.locator("[data-git-repository]").first();
  const toggle = panel.locator("header button[aria-expanded]").first();
  const message = panel.getByRole("textbox", { name: "Commit message", exact: true });
  await toggle.click();
  await expect(message).toBeVisible();
  expect((await message.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  const draft =
    "Preserve the worktree commit draft while its panel is reopened\n\nA longer body that wraps differently as the sidebar width changes.";
  await message.fill(draft);
  await toggle.click();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(message).toHaveValue(draft);
  for (const width of [280, 390, 566]) {
    await page.setViewportSize({ width, height: 650 });
    await page.locator("#root > div").evaluate((element, size) => {
      (element as HTMLElement).style.width = `${size}px`;
    }, width);
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await expect.poll(async () => (await message.boundingBox())!.height).toBeGreaterThan(32);
      const input = (await message.boundingBox())!;
      const commit = (await panel
        .getByRole("button", { name: "Commit", exact: true })
        .boundingBox())!;
      expect(commit.y).toBeGreaterThanOrEqual(input.y + input.height);
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
  expect((await message.boundingBox())!.height).toBeGreaterThan(32);
});

test("compact checkout header and branch fetch remain usable across widths and themes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/git-workspace.html?checkouts");
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
      await expect(branch).toHaveAttribute("title", /Switch branch in this working copy/);
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
  await page.goto("/tests/browser/git-workspace.html?repositories");
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
  await page.mouse.wheel(0, 100);
  await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBe(0);
  await panels.first().getByText("workspace.tsx", { exact: true }).hover();
  await page.mouse.wheel(20, 100);
  await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("checkout rows preserve identity, keyboard selection and searchable selection", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.goto("/tests/browser/git-workspace.html?checkouts");
  // The picker opens on the session checkout; the overview lists every checkout.
  await page.getByRole("button", { name: /^Working copy:/ }).click();
  await page.getByRole("option", { name: "All checkouts", exact: true }).click();
  const list = page.locator("[data-checkout-list]");
  const row = list.locator('button[title="/trees/audit/very-long-worktree-folder-name"]');
  await expect(list.locator("li")).toHaveCount(3);
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await expect(row).toContainText("audit/2026-10-14-long-branch-name-for-responsive-review");
      await expect(row).toContainText("very-long-worktree-folder-name");
      await expect(row.getByRole("img", { name: "Uncommitted changes" })).toBeVisible();
      await expect(list.locator('button[title="/fixture"]')).toContainText("This session");
      // Poll: the picker's value roll briefly overflows while the old label exits.
      await expect
        .poll(() =>
          list.evaluate((element) =>
            [element, ...element.querySelectorAll("li")].every(
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
  const detachedRow = list.locator('button[title="/trees/detached"]');
  await expect(detachedRow).toContainText("fd3caac");
  await detachedRow.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Working copy: Detached · /trees/detached", exact: true }),
  ).toBeVisible();
  await expect(list).toHaveCount(0);
  await page.getByRole("button", { name: /^Working copy:/ }).click();
  await page.getByRole("option", { name: "All checkouts", exact: true }).click();
  await expect(list.locator("li")).toHaveCount(3);
  await page.getByRole("button", { name: "Working copy: All checkouts", exact: true }).click();
  await page.getByRole("combobox").fill("audit");
  await page
    .getByRole("option", {
      name: "audit/2026-10-14-long-branch-name-for-responsive-review · /trees/audit/very-long-worktree-folder-name",
      exact: true,
    })
    .click();
  await expect(list).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Working copy: audit\// })).toBeVisible();
});
