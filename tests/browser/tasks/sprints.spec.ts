import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const fixture = "/tests/browser/tasks/tasks.html?sprints";
const captures = "temp/verification/2026-10-26-task-sprints";
type HostCall = {
  command: string;
  args: { method?: string; machineId?: string; params?: Record<string, unknown> };
};
// Server, Project, Status and Sprint scope live in the toolbar's one Filter popover; open it when it is closed.
async function openFilter(page: Page) {
  if (await page.getByRole("dialog", { name: "Filter", exact: true }).count()) return;
  await page
    .locator("header.task-board-toolbar")
    .getByRole("button", { name: "Filter", exact: true })
    .click();
}
async function choose(page: Page, label: string, option: string | RegExp, scope?: Locator) {
  if (!scope && (label === "Project" || label === "Server" || label === "Sprint"))
    await openFilter(page);
  await (scope ?? page).getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("option", { name: option, exact: typeof option === "string" }).click();
}
async function open(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixture);
  await expect(page.getByRole("tab", { name: "Tasks", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: "MacBook checkout", exact: true })).toBeVisible();
}
// Sprint dates use the shared calendar picker: step to the month, then pick the day.
async function pickDate(page: Page, scope: Locator, label: string, date: string) {
  await scope.getByRole("button", { name: label, exact: true }).click();
  const calendar = page.getByRole("dialog", { name: label, exact: true });
  const day = calendar.locator(`[data-date="${date}"]`);
  for (let step = 0; step < 24 && !(await day.count()); step++) {
    const first = await calendar.locator("[data-date]").first().getAttribute("data-date");
    const previous = first! > date;
    await calendar
      .getByRole("button", { name: previous ? "Previous month" : "Next month", exact: true })
      .click();
  }
  await day.click();
  await expect(calendar).toHaveCount(0);
}
// The board's sprint filter lives in the Filter popover with the other collection filters.
async function filterSprint(page: Page, sprint: string) {
  await choose(page, "Sprint", sprint);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Sprint:/ })).toHaveCount(0);
}
async function allProjects(page: Page) {
  await choose(page, "Project", "All projects");
}
async function createSprint(
  page: Page,
  name = "Release confidence",
  goal = "Keep the PC and MacBook rollout separate and visible.",
) {
  await page.getByRole("tab", { name: "Sprints", exact: true }).click();
  await page.getByRole("button", { name: "New sprint", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New sprint", exact: true });
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("Goal (optional)", { exact: true }).fill(goal);
  await form.getByRole("button", { name: /^Projects:/ }).click();
  await page.getByRole("option", { name: /^local-project / }).click();
  await page.getByRole("option", { name: /^remote-project / }).click();
  await page.keyboard.press("Escape");
  await form
    .locator("summary")
    .filter({ hasText: /^Capacity/ })
    .click();
  await form.getByLabel("Sprint capacity (points)", { exact: true }).fill("13");
  await pickDate(page, form, "Start date", "2026-10-26");
  await pickDate(page, form, "End date", "2026-11-09");
  await form.getByRole("button", { name: "Create sprint", exact: true }).click();
  await expect(form).not.toBeVisible();
  await page.getByRole("radio", { name: "Board view", exact: true }).check();
  await expect(page.getByRole("button", { name: "Start sprint", exact: true })).toBeVisible();
}
async function assignTasks(page: Page) {
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "More actions", exact: true }).first().click();
  await page.getByRole("menuitemcheckbox", { name: "Select tasks", exact: true }).click();
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
// The report is a closed "Report" disclosure on the selected sprint's page.
async function openReport(page: Page) {
  const report = page.getByRole("region", { name: "Sprint reports", exact: true });
  if (!(await report.count()))
    await page
      .locator("summary")
      .filter({ hasText: /^Report$/ })
      .click();
  await expect(report).toBeVisible();
  return report;
}
async function calls(page: Page): Promise<HostCall[]> {
  return page.evaluate(
    () => (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls,
  );
}

test("current project is isolated and all-project overview remains explicit", async ({ page }) => {
  await open(page);
  // The board opens on every project; the Scope popover narrows it to one.
  await expect(page.getByRole("button", { name: "PC onboarding", exact: true })).toBeVisible();
  await choose(page, "Project", /^remote-project · Demo MacBook/);
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
  // There is no manual refresh on a healthy board: the sprint read follows the 15 s poll.
  test.setTimeout(90_000);
  await expect(page.getByRole("heading", { name: longName, exact: true })).toBeVisible({
    timeout: 40_000,
  });
  await mkdir(captures, { recursive: true });
  await page.screenshot({
    path: `${captures}/${test.info().project.name}-long-content-390.png`,
    fullPage: true,
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page
    .locator("summary")
    .filter({ hasText: /^Goal$/ })
    .click();
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
  await page.getByRole("tab", { name: "Sprints", exact: true }).click();
  await filterSprint(page, "Release confidence");
  await openFilter(page);
  await page.getByRole("button", { name: /^Project:/ }).click();
  await expect(page.getByRole("option", { name: /^remote-api / })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /^local-docs / })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /^local-project ·/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^remote-project ·/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("article", { name: "PC onboarding", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "MacBook checkout", exact: true })).toBeVisible();
  await choose(page, "Project", /^remote-project · Demo MacBook/);
  await filterSprint(page, "Release confidence");
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
  expect((created.args.params!.task as Record<string, unknown>).projectId).toBe("remote-project");
  await expect
    .poll(
      async () => (await calls(page)).filter((call) => call.args.method === "sprints.plan").length,
    )
    .toBe(3);
  await allProjects(page);
  await filterSprint(page, "Release confidence");
  await page.getByRole("button", { name: "Start sprint", exact: true }).click();
  await expect(page.getByRole("button", { name: "Complete sprint", exact: true })).toBeVisible();
  const report = await openReport(page);
  await expect(report.getByText("Burndown", { exact: true })).toBeVisible();
  await expect(
    report
      .getByRole("table", { name: "Project capacity" })
      .getByRole("cell", { name: "3", exact: true }),
  ).toHaveCount(2);
  await mkdir(captures, { recursive: true });
  await page.screenshot({
    path: `${captures}/${test.info().project.name === "webkit" ? "webkit-" : ""}report-1440-dark.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Complete sprint", exact: true }).click();
  const completion = page.getByRole("dialog", { name: "Complete sprint", exact: true });
  await completion.getByRole("checkbox", { name: "PC onboarding", exact: true }).check();
  await completion.getByRole("button", { name: "Complete sprint", exact: true }).click();
  await expect(completion).not.toBeVisible();
  await openReport(page);
  await expect(
    page.getByText("This report was frozen when the sprint completed.", { exact: true }),
  ).toBeVisible();
  // Recorded velocity is a closed disclosure under the report.
  await expect(page.locator("summary").filter({ hasText: /^Sprint velocity$/ })).toBeVisible();
  const mutations = (await calls(page)).filter(
    (call) =>
      call.args.method?.startsWith("sprints.") &&
      !["sprints.list", "sprints.ingest", "sprints.report"].includes(call.args.method!),
  );
  expect(mutations.every((call) => call.args.machineId === "machine-local")).toBe(true);
});

for (const { width, theme } of [
  { width: 800, theme: "light" },
  { width: 800, theme: "dark" },
  { width: 1280, theme: "light" },
  { width: 1280, theme: "dark" },
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

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`seeded sprint report visual ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/tasks/tasks.html?sprintSeed");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("tab", { name: "Sprints", exact: true }).click();
      const collection = page.locator("ul.sprint-collection");
      await expect(collection).toBeVisible();
      expect(await collection.locator(":scope > li").count()).toBeGreaterThan(1);
      await expect(collection.locator(":scope > li").first()).toHaveCSS(
        "border-bottom-width",
        "1px",
      );
      await expect(collection.locator(":scope > li").last()).toHaveCSS(
        "border-bottom-width",
        "0px",
      );
      await mkdir("temp/verification/task-surfaces", { recursive: true });
      await page.screenshot({
        path: `temp/verification/task-surfaces/sprint-list-${theme}-${width}.png`,
      });
      // The report belongs to the chosen sprint's page.
      await collection.getByRole("button", { name: /^Sprint 42/ }).click();
      const report = await openReport(page);
      await expect(report.getByText("Burndown", { exact: true })).toBeVisible();
      await mkdir("temp/verification/sprint-report-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/sprint-report-visual/${theme}-${width}.png`,
        animations: "disabled",
        fullPage: true,
      });
    });
  }
