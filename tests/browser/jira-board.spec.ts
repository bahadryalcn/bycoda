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
    path: `temp/verification/2026-10-12-jira-board/kanban-${test.info().project.name}.png`,
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
    path: `temp/verification/2026-10-12-jira-board/backlog-${test.info().project.name}.png`,
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
