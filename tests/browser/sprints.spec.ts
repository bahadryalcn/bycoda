import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const fixture = "/tests/browser/tasks.html?sprints";
const captures = "temp/verification/2026-10-26-task-sprints";
type HostCall = {
  command: string;
  args: { method?: string; machineId?: string; params?: Record<string, unknown> };
};
async function choose(page: Page, label: string, option: string | RegExp, scope?: Locator) {
  await (scope ?? page).getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("option", { name: option, exact: typeof option === "string" }).click();
}
async function open(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixture);
  await expect(page.getByRole("radio", { name: "Backlog", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "MacBook checkout", exact: true })).toBeVisible();
}
async function allProjects(page: Page) {
  await choose(page, "Project", "All projects");
}
async function createSprint(
  page: Page,
  name = "Release confidence",
  goal = "Keep the PC and MacBook rollout separate and visible.",
) {
  await page.getByRole("radio", { name: "Sprints", exact: true }).click();
  await page.getByRole("button", { name: "New sprint", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New sprint", exact: true });
  await form.getByLabel("Sprint name", { exact: true }).fill(name);
  await form.getByLabel("Sprint goal", { exact: true }).fill(goal);
  await form.getByRole("button", { name: /^Projects:/ }).click();
  await page.getByRole("option", { name: /^local-project / }).click();
  await page.getByRole("option", { name: /^remote-project / }).click();
  await page.keyboard.press("Escape");
  await form.getByLabel("Sprint capacity (points)", { exact: true }).fill("13");
  await form.getByLabel("Start date", { exact: true }).fill("2026-10-26");
  await form.getByLabel("End date", { exact: true }).fill("2026-11-09");
  await form.getByRole("button", { name: "Save sprint", exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Start sprint", exact: true })).toBeVisible();
}
async function assignTasks(page: Page) {
  await page.getByRole("radio", { name: "Backlog", exact: true }).click();
  await page.getByRole("button", { name: "Select tasks", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select task: PC onboarding", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select task: MacBook checkout", exact: true }).check();
  const planning = page.getByRole("region", { name: "Planning", exact: true });
  await choose(page, "Sprint", "Release confidence", planning);
  await choose(page, "Story points", "3", planning);
  await planning.getByRole("button", { name: "Apply to 2 tasks", exact: true }).click();
  await expect
    .poll(
      async () => (await calls(page)).filter((call) => call.args.method === "sprints.plan").length,
    )
    .toBe(2);
  await page.getByRole("button", { name: "Finish selection", exact: true }).click();
}
async function calls(page: Page): Promise<HostCall[]> {
  return page.evaluate(
    () => (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls,
  );
}

test("current project is isolated and all-project overview remains explicit", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "PC onboarding", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "API stability", exact: true })).not.toBeVisible();
  await allProjects(page);
  await expect(page.getByRole("button", { name: "PC onboarding", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "API stability", exact: true })).toBeVisible();
});

test("long sprint names and goals keep planning controls and the board reachable at 390px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await open(page);
  await allProjects(page);
  const longName = "Sprint".repeat(30);
  const longGoal = "Plan this project carefully and preserve existing work. ".repeat(60);
  await createSprint(page, "Long sprint", longGoal);
  // Imported/Host-created names can reach the Host's 200-character limit even
  // though the local editor currently limits new names to 160 characters.
  await page.evaluate(async (name) => {
    const fixture = (
      window as unknown as {
        taskFixtureSprints: {
          rpc(method: string, machineId: string, params: Record<string, unknown>): Promise<unknown>;
        };
      }
    ).taskFixtureSprints;
    const board = (await fixture.rpc("sprints.list", "machine-local", {})) as {
      sprints: { id: string; revision: number }[];
    };
    await fixture.rpc("sprints.update", "machine-local", {
      id: board.sprints[0].id,
      input: { name, expectedRevision: board.sprints[0].revision, requestId: "long-name-import" },
    });
    await fixture.rpc("sprints.plan", "machine-local", {
      input: {
        environmentId: "env-local",
        projectId: "local-project",
        taskId: "local-task",
        sprintId: board.sprints[0].id,
        storyPoints: 3,
        expectedRevision: 0,
        requestId: "long-sprint-task",
      },
    });
  }, longName);
  await page
    .getByRole("region", { name: "Sprints", exact: true })
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: longName, exact: true })).toBeVisible();
  await mkdir(captures, { recursive: true });
  await page.screenshot({
    path: `${captures}/${test.info().project.name}-long-content-390.png`,
    fullPage: true,
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.locator("summary").filter({ hasText: "Sprint goal" }).click();
  await page.screenshot({
    path: `${captures}/${test.info().project.name}-long-content-expanded-390.png`,
    fullPage: true,
  });
  const picker = page.locator(".task-board-column-picker");
  await picker.scrollIntoViewIfNeeded();
  await expect(picker).toBeInViewport();
  await expect(page.getByRole("heading", { name: longName, exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Start sprint", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "New task", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "New task", exact: true })).toBeInViewport();
});

test("cross-machine sprint supports planning, inheritance, completion and frozen reports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await allProjects(page);
  await createSprint(page);
  await assignTasks(page);
  await page.getByRole("radio", { name: "Sprints", exact: true }).click();
  await choose(page, "Sprint", "Release confidence");
  await page.getByRole("button", { name: /^Project:/ }).click();
  await expect(page.getByRole("option", { name: /^remote-api / })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /^local-docs / })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /^local-project ·/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^remote-project ·/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("article", { name: "PC onboarding", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "MacBook checkout", exact: true })).toBeVisible();
  await choose(page, "Project", /^remote-project · Demo MacBook/);
  await choose(page, "Sprint", "Release confidence");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const newTask = page.getByRole("dialog", { name: "New task", exact: true });
  await newTask
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Inherited sprint task");
  await newTask.getByRole("button", { name: "Add to To do", exact: true }).click();
  await expect(newTask).not.toBeVisible();
  await expect(
    page.getByRole("article", { name: "Inherited sprint task", exact: true }),
  ).toBeVisible();
  const created = (await calls(page)).find((call) => call.args.method === "tasks.save")!;
  expect(created.args.machineId).toBe("machine-remote");
  expect((created.args.params?.task as Record<string, unknown>).projectId).toBe("remote-project");
  await expect
    .poll(
      async () => (await calls(page)).filter((call) => call.args.method === "sprints.plan").length,
    )
    .toBe(3);
  await allProjects(page);
  await choose(page, "Sprint", "Release confidence");
  await page.getByRole("button", { name: "Start sprint", exact: true }).click();
  await expect(page.getByRole("button", { name: "Complete sprint", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Burndown", exact: true })).toBeVisible();
  await expect(
    page.getByRole("table").first().getByRole("cell", { name: "3", exact: true }),
  ).toHaveCount(2);
  await mkdir(captures, { recursive: true });
  await page.screenshot({
    path: `${captures}/${test.info().project.name === "webkit" ? "webkit-" : ""}report-1440-dark.png`,
    fullPage: true,
  });
  await page.getByRole("radio", { name: "Sprints", exact: true }).click();
  await page.getByRole("button", { name: "Complete sprint", exact: true }).click();
  const completion = page.getByRole("dialog", { name: "Complete sprint", exact: true });
  await completion.getByRole("checkbox", { name: "PC onboarding", exact: true }).check();
  await completion.getByRole("button", { name: "Complete sprint", exact: true }).click();
  await expect(completion).not.toBeVisible();
  await page.getByRole("radio", { name: "Reports", exact: true }).click();
  await expect(
    page.getByText("This report was frozen when the sprint completed.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sprint velocity", exact: true })).toBeVisible();
  const mutations = (await calls(page)).filter(
    (call) =>
      call.args.method?.startsWith("sprints.") &&
      !["sprints.list", "sprints.ingest", "sprints.report"].includes(call.args.method!),
  );
  expect(mutations.every((call) => call.args.machineId === "machine-local")).toBe(true);
});

for (const { width, theme } of [
  { width: 390, theme: "light" },
  { width: 768, theme: "dark" },
  { width: 1024, theme: "dark" },
  { width: 1440, theme: "light" },
] as const) {
  test(`sprint planning remains usable at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await open(page);
    await allProjects(page);
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    await createSprint(page);
    await expect(page.getByRole("button", { name: "Start sprint", exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await mkdir(captures, { recursive: true });
    await page.screenshot({
      path: `${captures}/${test.info().project.name === "webkit" ? "webkit-" : ""}sprints-${width}-${theme}.png`,
      fullPage: true,
    });
  });
}
