import { test, expect, type Page, type Locator } from "@playwright/test";
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
  await page.goto("/tests/browser/jira-board.html");
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
  await page.getByRole("button", { name: "Backlog & sprints", exact: true }).click();
  const backlog = page.getByRole("region", { name: "Backlog", exact: true });
  const active = page.getByRole("region", { name: "Sprint 21", exact: true });
  await expect(backlog.locator(".jira-board-card")).toHaveCount(2);
  await drag(
    page,
    backlog.locator(".jira-board-card").filter({ hasText: "ENG-1" }),
    active.locator("header"),
  );
  await expect(active.locator(".jira-board-card")).toHaveCount(2);
  await drag(
    page,
    active.locator(".jira-board-card").filter({ hasText: "ENG-1" }),
    backlog.locator("header"),
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
  await source.getByRole("button", { name: "In Progress", exact: true }).click();
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
  await page.goto("/tests/browser/jira-board.html?uiControls");
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
  await page.goto("/tests/browser/jira-board.html?uiControls");
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
    const field = await input.boundingBox(),
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
