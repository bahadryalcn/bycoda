import { test, expect, type Page, type Locator } from "@playwright/test";

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`Jira comment preview modes ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/inbox/jira-board.html?commentEditor");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const source = page.getByRole("textbox", { name: "Comment", exact: true });
      await source.fill(
        "**Ready for review**\n\n- Keep draft\n- Check preview\n\n`const value = 42;`",
      );
      const preview = page.getByRole("region", { name: "Preview", exact: true });
      await expect(preview.getByText("Ready for review", { exact: true })).toBeVisible();
      await expect(preview.locator("li")).toHaveCount(2);
      await page.locator('input[type="file"]').setInputFiles({
        name: "sample.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT1sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await expect(page.getByRole("img", { name: "sample.png" })).toBeVisible();
      const picker = page.getByRole("button", { name: /^Choose project:/ });
      await picker.click();
      await page.getByRole("option", { name: /bycoda-website/ }).click();
      await expect(picker).toContainText("bycoda-website");
      await expect(picker).not.toContainText("pf-ui-portal");
      for (const mode of ["Split", "Preview", "Source"]) {
        await page.getByRole("tab", { name: mode, exact: true }).click();
        await expect(page.getByRole("tab", { name: mode, exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        if (mode === "Preview") await expect(source).toBeHidden();
        else await expect(source).toBeVisible();
        if (mode === "Source") await expect(preview).toHaveCount(0);
        else await expect(preview.getByText("Ready for review", { exact: true })).toBeVisible();
        await expect(page.getByRole("img", { name: "sample.png" })).toBeVisible();
        await page.screenshot({
          path: `temp/verification/jira-comment-preview/${theme}-${width}-${mode.toLowerCase()}.png`,
        });
      }
      await expect(source).toContainText("**Ready for review**");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
async function drag(page: Page, source: Locator, target: Locator) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from).toBeTruthy();
  expect(to).toBeTruthy();
  await page.mouse.move(from!.x + 30, from!.y + 15);
  await page.mouse.down();
  await page.mouse.move(from!.x + 45, from!.y + 25, { steps: 3 });
  await page.mouse.move(to!.x + 40, to!.y + 25, { steps: 15 });
  await page.mouse.up();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/inbox/jira-board.html");
  await expect(page.getByText("Loading Jira board…")).toHaveCount(0);
  await expect(page.locator(".jira-board-card")).toHaveCount(3);
});
test("pointer drag changes Jira status and ranks in the destination column", async ({ page }) => {
  const working = page.getByRole("region", { name: "In Progress", exact: true });
  const source = page.locator(".jira-board-card").filter({ hasText: "ENG-1" });
  const target = working.locator(".jira-board-card").filter({ hasText: "ENG-2" });
  await drag(page, source, target);
  await expect(working.locator(".jira-board-card").filter({ hasText: "ENG-1" })).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          jiraFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).jiraFixtureCalls,
  );
  expect(calls).toContainEqual({
    command: "jira_issue_transition",
    args: { key: "ENG-1", transitionId: "31" },
  });
  expect(calls).toContainEqual({
    command: "jira_board_move",
    args: {
      boardId: 7,
      key: "ENG-1",
      target: "rank",
      sprintId: null,
      beforeKey: "ENG-2",
      afterKey: null,
    },
  });
  await page.screenshot({
    path: `temp/verification/2026-10-16-ui-system/W5b-INBOX-captures/kanban-${test.info().project.name}.png`,
  });
});
test("pointer drag moves backlog issues to the active sprint and back", async ({ page }) => {
  await page.getByRole("tab", { name: "Backlog & sprints", exact: true }).click();
  const backlog = page.getByRole("region", { name: "Backlog", exact: true });
  const active = page.getByRole("region", { name: "Sprint 21", exact: true });
  // Only the first group opens by default; expand Backlog to load and show its issues.
  await backlog.locator("summary").first().click();
  await expect(backlog.locator(".jira-board-card")).toHaveCount(2);
  await drag(
    page,
    backlog.locator(".jira-board-card").filter({ hasText: "ENG-1" }),
    active.locator("summary").first(),
  );
  await expect(active.locator(".jira-board-card")).toHaveCount(2);
  await drag(
    page,
    active.locator(".jira-board-card").filter({ hasText: "ENG-1" }),
    backlog.locator("summary").first(),
  );
  await expect(backlog.locator(".jira-board-card")).toHaveCount(2);
  await page.screenshot({
    path: `temp/verification/2026-10-16-ui-system/W5b-INBOX-captures/backlog-${test.info().project.name}.png`,
  });
});
test("failed moves preserve the original card and remain visible", async ({ page }) => {
  await page.evaluate(() =>
    (window as unknown as { jiraFixtureFail: () => void }).jiraFixtureFail(),
  );
  const source = page.locator(".jira-board-card").filter({ hasText: "ENG-1" });
  await source.getByRole("button", { name: "Move ENG-1" }).click();
  await page
    .getByRole("menu", { name: "Move ENG-1" })
    .getByRole("menuitem", { name: "In Progress", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Jira permission denied");
  await expect(
    page
      .getByRole("region", { name: "To Do", exact: true })
      .locator(".jira-board-card")
      .filter({ hasText: "ENG-1" }),
  ).toBeVisible();
});

test("split method selection preserves the explicit merge confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/inbox/jira-board.html?uiControls");
  await page.getByRole("button", { name: "Merge options", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Squash and merge", exact: true }).click();
  const mutations = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          jiraFixtureCalls: { command: string; args: Record<string, unknown> }[];
        }
      ).jiraFixtureCalls.filter((call) => call.command === "git_github_pr_action"),
    );
  expect(await mutations()).toHaveLength(0);
  await page.getByRole("button", { name: "Squash and merge", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Squash and merge?", exact: true });
  await expect(confirmation).toBeVisible();
  expect(await mutations()).toHaveLength(0);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await mutations()).toHaveLength(0);
  await page.getByRole("button", { name: "Squash and merge", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Squash and merge?", exact: true })
    .getByRole("button", { name: "Squash and merge", exact: true })
    .click();
  await expect.poll(async () => (await mutations()).length).toBe(1);
  expect((await mutations())[0].args.action).toBe("squash");
});

test("searchable project membership retains unloaded exclusions and clears explicitly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/inbox/jira-board.html?uiControls");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.documentElement.classList.add("theme-light"));
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("button", { name: /^Projects:/ }).click();
  await page.getByRole("combobox", { name: "Search options…", exact: true }).fill("Documentation");
  await page.getByRole("option", { name: /Documentation/ }).click();
  const writes = () =>
    page.evaluate(
      () =>
        (window as unknown as { inboxFixtureFilterWrites: string[][] }).inboxFixtureFilterWrites,
    );
  await expect.poll(writes).toEqual([["stale-project"]]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect.poll(writes).toEqual([["stale-project"], []]);
  await page.screenshot({
    path: `temp/verification/2026-10-16-ui-system/W5b-INBOX-captures/filters-${test.info().project.name}.png`,
  });
});

for (const variant of [
  { theme: "light", width: 390 },
  { theme: "dark", width: 1000 },
] as const) {
  test(`shared search field filters and clears with keyboard - ${variant.theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: variant.width, height: 844 });
    await page.emulateMedia({ colorScheme: variant.theme, reducedMotion: "reduce" });
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle("theme-light", theme === "light");
    }, variant.theme);
    const input = page.getByRole("searchbox", { name: "Filter issues" });
    await input.focus();
    await input.pressSequentially("ENG-1");
    await expect(page.locator(".jira-board-card")).toHaveCount(1);
    const clear = page.getByRole("button", { name: "Clear search", exact: true });
    await input.press("Tab");
    await expect(clear).toBeFocused();
    // The shared field frame owns the boundary; the clear action is its end adornment.
    const field = await input.locator("xpath=ancestor::*[@data-field-control][1]").boundingBox(),
      button = await clear.boundingBox();
    expect(field).toBeTruthy();
    expect(field!.width).toBeGreaterThanOrEqual(140);
    expect(button).toBeTruthy();
    expect(button!.x).toBeGreaterThanOrEqual(field!.x);
    expect(button!.x + button!.width).toBeLessThanOrEqual(field!.x + field!.width + 1);
    await clear.press("Enter");
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(page.locator(".jira-board-card")).toHaveCount(3);
    await page.screenshot({
      path: `temp/verification/2026-10-16-ui-system/W8-SEARCH-CLEANUP-jira-${test.info().project.name}-${variant.theme}.png`,
    });
  });
}

const shotDir = "temp/verification/vis-dnd-3";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`Jira UI demand paging and layout ${theme} ${width}`, async ({ page }) => {
      const directory = "temp/verification/2026-11-13-jira-ui";
      await page.setViewportSize({ width, height: 800 });
      const setTheme = async () => {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.evaluate(
          (value) => document.documentElement.classList.toggle("theme-light", value === "light"),
          theme,
        );
      };
      await page.goto("/tests/browser/inbox/jira-board.html?dense");
      await setTheme();
      await expect(page.locator(".jira-board-card")).toHaveCount(40);
      const board = page.locator(".jira-board-columns");
      const box = (await board.boundingBox())!;
      await page.mouse.move(box.x + 80, box.y + 80);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(box.x - 120, box.y + 50, { steps: 4 });
      await page.mouse.up({ button: "middle" });
      expect(await board.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await board.evaluate((element) => {
        element.scrollLeft = 0;
      });
      await page.screenshot({ path: `${directory}/board-${theme}-${width}.png` });
      const column = page.locator(".jira-board-column [data-continuous-list]").first();
      await column.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll"));
      });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  jiraFixtureCalls: { command: string; args: Record<string, unknown> }[];
                }
              ).jiraFixtureCalls.filter(
                (call) =>
                  call.command === "jira_board_issues" && call.args.nextPageToken === "second",
              ).length,
          ),
        )
        .toBe(1);
      await page.getByRole("tab", { name: "Backlog & sprints", exact: true }).click();
      await page.screenshot({ path: `${directory}/planning-${theme}-${width}.png` });
      await page.goto("/tests/browser/inbox/jira-board.html?inbox&dense");
      await setTheme();
      const list = page.locator('[data-continuous-list^="inbox:"]');
      await expect(list).toBeVisible();
      await list.locator("button").first().click();
      await expect(page.getByRole("heading", { name: "Bulgu", exact: true })).toBeVisible();
      await page.screenshot({ path: `${directory}/inbox-${theme}-${width}.png` });
      const picker = page.getByRole("button", { name: /^Choose project:/ });
      await picker.hover();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await picker.click();
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await page.screenshot({ path: `${directory}/project-${theme}-${width}.png` });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Filter inbox/ }).click();
      await expect(page.getByRole("dialog", { name: "Filter inbox", exact: true })).toBeVisible();
      await page.screenshot({ path: `${directory}/filters-${theme}-${width}.png` });
      await page.keyboard.press("Escape");
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll"));
      });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  jiraFixtureCalls: { command: string; args: Record<string, unknown> }[];
                }
              ).jiraFixtureCalls.filter(
                (call) =>
                  call.command === "jira_list_issue_page" && call.args.nextPageToken === "second",
              ).length,
          ),
        )
        .toBe(1);
    });
  }
}
for (const light of [false, true]) {
  const theme = light ? "light" : "dark";
  test(`drag shows one badge with the issue, a column mark, a rank line, and cancels cleanly (${theme})`, async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== "chromium",
      "Screenshots are Chromium fixture evidence.",
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      light,
    );
    const badge = page.locator(".pointer-drop-hint");
    const marks = page.locator("[data-drop-indicator]");
    const working = page.getByRole("region", { name: "In Progress", exact: true });
    const source = page.locator(".jira-board-card").filter({ hasText: "ENG-1" });
    const from = (await source.boundingBox())!;
    const column = (await working.boundingBox())!;
    await page.mouse.move(from.x + 30, from.y + 15);
    await page.mouse.down();
    await page.mouse.move(from.x + 45, from.y + 25, { steps: 3 });
    // Empty space in another column: the whole column receives the issue.
    await page.mouse.move(column.x + column.width / 2, column.y + column.height - 40, {
      steps: 12,
    });
    await expect(badge).toHaveCount(1);
    await expect(badge).toContainText("ENG-1");
    await expect(badge).toContainText("Move to In Progress");
    await expect(working).toHaveAttribute("data-drop-indicator", "inside");
    await expect(marks).toHaveCount(1);
    await page.screenshot({ path: `${shotDir}/jira-drag-column-${theme}-1280x800.png` });
    // Over a card of the same column: the rank line lands before that card.
    const sibling = page.locator(".jira-board-card").filter({ hasText: "ENG-3" });
    const siblingBox = (await sibling.boundingBox())!;
    await page.mouse.move(siblingBox.x + 60, siblingBox.y + siblingBox.height / 2, { steps: 12 });
    await expect(badge).toContainText("Reorder in To Do");
    await expect(sibling).toHaveAttribute("data-drop-indicator", "before");
    await expect(marks).toHaveCount(1);
    await page.screenshot({ path: `${shotDir}/jira-drag-rank-${theme}-1280x800.png` });
    await page.keyboard.press("Escape");
    await expect(badge).toHaveCount(0);
    await expect(marks).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.classList.contains("is-grabbing")),
    ).toBe(false);
    await page.mouse.up();
    const calls = await page.evaluate(() =>
      (window as unknown as { jiraFixtureCalls: { command: string }[] }).jiraFixtureCalls.map(
        (call) => call.command,
      ),
    );
    expect(calls).not.toContain("jira_issue_transition");
    expect(calls).not.toContain("jira_board_move");
    await expect(page.locator(".jira-board-card")).toHaveCount(3);
  });

  test(`backlog and sprint drag marks the receiving group (${theme})`, async ({ page }) => {
    test.skip(
      test.info().project.name !== "chromium",
      "Screenshots are Chromium fixture evidence.",
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      light,
    );
    await page.getByRole("tab", { name: "Backlog & sprints", exact: true }).click();
    const backlog = page.getByRole("region", { name: "Backlog", exact: true });
    const active = page.getByRole("region", { name: "Sprint 21", exact: true });
    await backlog.locator("summary").first().click();
    await expect(backlog.locator(".jira-board-card")).toHaveCount(2);
    const card = backlog.locator(".jira-board-card").filter({ hasText: "ENG-1" });
    const from = (await card.boundingBox())!;
    const to = (await active.locator("summary").first().boundingBox())!;
    await page.mouse.move(from.x + 30, from.y + 15);
    await page.mouse.down();
    await page.mouse.move(from.x + 45, from.y + 25, { steps: 3 });
    await page.mouse.move(to.x + 40, to.y + 10, { steps: 12 });
    await expect(page.locator(".pointer-drop-hint")).toContainText("Move to Sprint 21");
    await expect(active).toHaveAttribute("data-drop-indicator", "inside");
    await page.screenshot({ path: `${shotDir}/jira-drag-sprint-${theme}-1280x800.png` });
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-drop-indicator]")).toHaveCount(0);
    await page.mouse.up();
  });
}

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`inbox filter layout and assignee names - ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/inbox/jira-board.html?uiControls");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "Filter inbox", exact: true });
      const open = panel.getByRole("checkbox", { name: "Open", exact: true });
      const closed = panel.getByRole("checkbox", { name: "Closed", exact: true });
      const openBox = (await open.boundingBox())!;
      const closedBox = (await closed.boundingBox())!;
      expect(Math.abs(openBox.y - closedBox.y)).toBeLessThan(2);
      expect(closedBox.x).toBeGreaterThan(openBox.x);
      await open.check();
      await closed.check();
      await expect(open).toBeChecked();
      await expect(closed).toBeChecked();
      const time = panel.getByRole("button", { name: /^Time:/ });
      await time.click();
      await page.getByRole("option", { name: "Last 7 days", exact: true }).click();
      await expect(time).toContainText("Last 7 days");
      const assignee = panel.getByRole("button", { name: /^Assignee:/ });
      await assignee.click();
      const ada = page.getByRole("option", { name: "Ada Lovelace", exact: true });
      await expect(ada).toBeVisible();
      await expect(page.getByText("Assigned to {name}", { exact: true })).toHaveCount(0);
      await page.screenshot({
        path: `temp/verification/inbox-filters-20261113/assignees-${theme}-${width}.png`,
      });
      await ada.click();
      await page.keyboard.press("Escape");
      await expect(panel).toBeVisible();
      await expect(assignee).toContainText("Ada Lovelace");
      await page.screenshot({
        path: `temp/verification/inbox-filters-20261113/filters-${theme}-${width}.png`,
      });
      const panelBox = (await panel.boundingBox())!;
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
      expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(800);
    });
  }
}

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`changes glance rows ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (mode) => document.documentElement.classList.toggle("theme-light", mode === "light"),
        theme,
      );
      await page.goto("/tests/browser/inbox/jira-board.html?changes-fixture");
      await page.evaluate(
        (mode) => document.documentElement.classList.toggle("theme-light", mode === "light"),
        theme,
      );
      const rows = page.locator("[data-inbox-pr-glance] ul > li");
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toHaveCSS("border-bottom-width", "1px");
      await expect(rows.last()).toHaveCSS("border-bottom-width", "0px");
      await page.screenshot({
        path: `temp/verification/2026-11-04-session-tools/inbox-changes-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [480, 800, 1280]) {
    test(`inbox collection responsive frame ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/inbox/jira-board.html?inbox&dense");
      await page.evaluate(
        (mode) => document.documentElement.classList.toggle("theme-light", mode === "light"),
        theme,
      );
      const panel = page.locator(".inbox-list-panel");
      await expect(panel).toBeVisible();
      await expect(panel).toHaveCSS("border-right-width", width === 480 ? "0px" : "1px");
      await page.screenshot({
        path: `temp/verification/2026-11-04-session-tools/inbox-frame-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [480, 800, 1280]) {
    test(`jira board detail frame ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/inbox/jira-board.html?inbox&dense");
      await page.evaluate(
        (mode) => document.documentElement.classList.toggle("theme-light", mode === "light"),
        theme,
      );
      await page.getByRole("button", { name: "Board", exact: true }).click();
      await page.locator(".jira-board-card").first().click();
      const detail = page.locator(".jira-board-detail");
      await expect(detail).toBeVisible();
      await expect(detail).toHaveCSS("border-left-width", width === 480 ? "0px" : "1px");
      await page.screenshot({
        path: `temp/verification/2026-11-04-session-tools/board-frame-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`inbox activity rail ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/inbox/jira-board.html?timeline-fixture");
      await page.evaluate(
        (mode) => document.documentElement.classList.toggle("theme-light", mode === "light"),
        theme,
      );
      await expect(page.getByText("Review message")).toBeVisible();
      await expect(page.getByText("First commit")).toBeVisible();
      await expect(page.getByText("Second commit")).toBeVisible();
      const title = page.getByText("First commit");
      const before = await title.evaluate((node) => getComputedStyle(node).color);
      await title.hover();
      const hover = await title.evaluate((node) => getComputedStyle(node).color);
      console.log("COMMIT_HOVER", before, hover);
      await page.screenshot({
        path: `temp/verification/2026-11-04-session-tools/inbox-rail-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`inbox evidence and title hover ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/inbox/jira-board.html?evidence-fixture");
      await page.evaluate(
        (mode) => document.documentElement.classList.toggle("theme-light", mode === "light"),
        theme,
      );
      await expect(page.getByText("expect(first).toBe(2);")).toBeVisible();
      const marked = page.getByText("expect(first).toBe(2);").locator("..");
      await expect(marked).toHaveCSS("border-left-width", "2px");
      const title = page.getByText("Update sidebar activity", { exact: true });
      await expect(title).toHaveCSS("text-decoration-line", "none");
      await title.hover();
      await expect(title).toHaveCSS("text-decoration-line", "underline");
      await page.screenshot({
        path: `temp/verification/2026-11-04-session-tools/inbox-evidence-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [1000, 1280]) {
    test(`narrow inbox discussion ground ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/inbox/jira-board.html?inbox&dense");
      await page.evaluate(
        (mode) => document.documentElement.classList.toggle("theme-light", mode === "light"),
        theme,
      );
      await page.locator(".bycoda-inbox").evaluate((node) => {
        (node as HTMLElement).style.width = "760px";
      });
      await page.getByRole("button", { name: "Ask", exact: true }).click();
      const panel = page.locator(".inbox-discussion-panel");
      await expect(panel).toBeVisible();
      await expect(panel).toHaveCSS("position", "absolute");
      const colors = await panel.evaluate((node) => [
        getComputedStyle(node).backgroundColor,
        getComputedStyle(node).getPropertyValue("--color-background-base").trim(),
      ]);
      console.log("DISCUSSION_GROUND", JSON.stringify(colors));
      await page.screenshot({
        path: `temp/verification/2026-11-04-session-tools/discussion-${theme}-${width}.png`,
        animations: "disabled",
      });
      await page.locator(".bycoda-inbox").evaluate((node) => {
        (node as HTMLElement).style.width = "900px";
      });
      await expect(panel).toHaveCSS("position", "relative");
      const wideColor = await panel.evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(wideColor === "rgba(0, 0, 0, 0)" || wideColor.includes("/ 0)")).toBe(true);
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`pull request checks visual ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/inbox/jira-board.html?checks-fixture");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const checks = page.locator("[data-inbox-pr-checks]");
      await expect(checks).toBeVisible();
      await expect(checks).toContainText("Build");
      await expect(checks).toContainText("Tests");
      await page.screenshot({
        path: `temp/verification/component-families/pr-checks-${theme}-${width}.png`,
      });
    });
