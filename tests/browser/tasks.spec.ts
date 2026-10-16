import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

type HostCall = {
  command: string;
  args: {
    machineId?: string;
    method?: string;
    params?: { task?: Record<string, unknown>; goal?: Record<string, unknown> };
  };
};
const fixture = "/tests/browser/tasks.html";

for (const width of [390, 768, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`existing goal settings at ${width}px in ${theme} theme`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${fixture}?boardControls`);
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("theme-light", theme === "light"),
        theme,
      );
      const edit = page.getByRole("button", { name: "Edit goal settings", exact: true });
      await edit.click();
      const form = page.getByRole("form", { name: "Edit goal settings", exact: true });
      await expect(form).toBeVisible();
      await expect(form).toContainText("Applies to existing unfinished tasks.");
      const merge = form.getByRole("checkbox", { name: /^Merge automatically/ });
      await merge.focus();
      await page.keyboard.press("Space");
      await expect(merge).toBeChecked();
      await choose(
        page,
        form.getByRole("button", { name: /^Concurrent tasks in this goal:/ }),
        "3",
      );
      await form.getByRole("spinbutton", { name: "Run limit (minutes)", exact: true }).fill("25");
      const bounds = await form.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath("goal-settings.png"),
        animations: "disabled",
      });
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(form).toHaveCount(0);
      const changes = await page.evaluate(() =>
        (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls.filter(
          (call) => call.args.method === "goals.update",
        ),
      );
      expect(changes).toHaveLength(1);
      expect(changes[0].args).toMatchObject({
        machineId: "machine-local",
        params: {
          goalId: "controls-goal",
          expectedUpdatedAt: 1,
          settings: { autoMerge: true, maxRunningTasks: 3, maxRunMinutes: 25 },
        },
      });
      await expect(edit).toBeFocused();
    });
  }
}

test("execution mode is selectable in task and goal dialogs", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const kind of ["task", "goal"] as const) {
    const form = await start(page, kind);
    expect(
      await form
        .getByRole("radiogroup", { name: "Execution mode", exact: true })
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    await expect(form.getByRole("radio", { name: "Shared checkout", exact: true })).toBeChecked();
    await form.getByRole("radio", { name: "Separate worktree", exact: true }).click();
    await expect(form.getByRole("radio", { name: "Separate worktree", exact: true })).toBeChecked();
    if (kind === "task")
      await form.getByRole("button", { name: "Agent settings", exact: true }).click();
    const merge = form.getByRole("checkbox", { name: /^Merge automatically/ });
    await expect(merge).toBeEnabled();
    await form.getByRole("radio", { name: "Shared checkout", exact: true }).click();
    await expect(merge).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath(`${kind}-execution-mode.png`),
      animations: "disabled",
    });
  }
});

for (const viewport of [
  { width: 925, height: 657 },
  { width: 480, height: 720 },
]) {
  test(`goal dialog menus stay clickable above the dialog at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const form = await start(page, "goal");
    await form.getByRole("button", { name: /Demo agent/ }).click();
    const settings = page.getByRole("menu", { name: "Model and settings", exact: true });
    await expect(settings).toBeVisible();
    // A normal click checks hit testing: a menu behind the modal cannot receive it.
    await settings.getByRole("menuitem", { name: /^Model/ }).click();
    const models = page.getByRole("dialog", { name: "Models", exact: true });
    await models.getByRole("option", { name: /Demo agent/ }).click();
    await expect(models).toHaveCount(0);
    await expect(form).toBeVisible();
    await form.getByRole("button", { name: /^Time limit:/ }).click();
    await page.getByRole("option", { name: "No limit", exact: true }).click();
    await expect(form).toBeVisible();
  });
}

test("goal dialog keeps workspace, manual start and concurrency choices together", async ({
  page,
}, testInfo) => {
  const form = await start(page, "goal");
  const dialog = page.getByRole("dialog", { name: "New goal", exact: true });
  await expect(dialog).toBeVisible();
  await fillGoal(form);
  await choose(
    page,
    form.getByRole("button", { name: /^Start planned tasks:/ }),
    "Manually from To do",
  );
  await choose(page, form.getByRole("button", { name: /^Concurrent tasks in this goal:/ }), "3");
  await form
    .getByRole("textbox", { name: "New integration branch", exact: true })
    .fill("goal/settings");
  await expect(form.getByRole("button", { name: "Plan it", exact: true })).toBeDisabled();
  await form.getByRole("button", { name: "Create a separate worktree", exact: true }).click();
  await expect(form.getByRole("button", { name: /^Worktree:/ })).toContainText("goal/settings");
  const screenshots = resolve("temp/verification/2026-10-12-task-controls");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: resolve(screenshots, `goal-dialog-${testInfo.project.name}.png`),
    animations: "disabled",
  });
  await form.getByRole("button", { name: "Plan it", exact: true }).click();
  await expect.poll(() => mutations(page)).toHaveLength(1);
  expect((await mutations(page))[0].args.params?.goal).toMatchObject({
    manualStart: true,
    maxRunningTasks: 3,
    workspaces: {
      "local-project": {
        checkoutCwd: "C:/fixture/local-project-integration",
        baseBranch: "goal/settings",
      },
    },
  });
});

test("board cards support reorder, explicit start and reviewed delivery choices", async ({
  page,
}) => {
  await page.goto(`${fixture}?boardControls`);
  const queued = page.locator('[data-task-column="queued"]');
  const first = queued.getByRole("article", { name: "First queued task", exact: true });
  const second = queued.getByRole("article", { name: "Second queued task", exact: true });
  await expect(first).toBeVisible();
  await second.dragTo(first);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls.filter(
            (call) => call.args.method === "tasks.reorder",
          ).length,
      ),
    )
    .toBe(1);
  await first.getByRole("button", { name: "Start now", exact: true }).click();
  await expect(
    page
      .locator('[data-task-column="running"]')
      .getByRole("article", { name: "First queued task", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("article", { name: "Completed task", exact: true })
    .getByRole("button", { name: "Choose delivery target", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Choose delivery target", exact: true });
  await dialog
    .getByRole("textbox", { name: "New integration branch", exact: true })
    .fill("goal/recovery");
  await expect(
    dialog.getByRole("button", { name: "Save delivery target", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Create a separate worktree", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /^Worktree:/ })).toContainText("goal/recovery");
  await dialog.getByRole("button", { name: "Save delivery target", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Completed task", exact: true }),
  ).not.toContainText("uncommitted");
});

test("a goal lists its created session links", async ({ page }) => {
  await page.goto(`${fixture}?boardControls`);
  await page
    .getByRole("article", { name: "Settings goal", exact: true })
    .getByRole("button", { name: "Task sessions", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Task sessions", exact: true });
  await expect(dialog).toContainText("Session will appear when this task starts.");
  await dialog.getByRole("button", { name: "Open worker session", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { taskFixtureOpenedSessions: OpenedSession[] })
            .taskFixtureOpenedSessions,
      ),
    )
    .toMatchObject([
      {
        machineId: "machine-local",
        projectId: "local-project",
        cwd: "C:/fixture/local-project",
        sessionId: "completed-worker",
      },
    ]);
});
type OpenedSession = {
  machineId: string;
  cwd: string;
  projectId: string;
  sessionId: string;
};
const machine = (form: Locator) => form.getByRole("button", { name: /^Machine:/ });
const project = (form: Locator) => form.getByRole("button", { name: /^Project:/ });
async function choose(page: Page, trigger: Locator, name: string) {
  await trigger.click();
  await page.getByRole("option", { name, exact: true }).click();
}
async function mutations(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls.filter(
      (call) => call.args.method === "tasks.save" || call.args.method === "goals.create",
    ),
  );
}
async function start(page: Page, kind: "task" | "goal", query = "") {
  await page.goto(fixture + query);
  await expect(page.getByRole("region", { name: "Tasks", exact: true })).toBeVisible();
  await page.getByRole("button", { name: `New ${kind}`, exact: true }).click();
  return page.getByRole("form", { name: `New ${kind}`, exact: true });
}
async function fillTask(form: Locator) {
  await form
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Run on the selected computer");
  await form
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Finish the fixture task without stopping.");
}
async function fillGoal(form: Locator) {
  await form
    .getByRole("textbox", { name: "Goal title", exact: true })
    .fill("Finish the selected projects");
  await form
    .getByRole("textbox", { name: "Main job", exact: true })
    .fill("Plan and complete the selected projects on this machine.");
}

test("a task defaults locally from a remote workspace and saves on the local host", async ({
  page,
}) => {
  const form = await start(page, "task");
  await expect(machine(form)).toHaveAccessibleName("Machine: This computer");
  await expect(form).toContainText("Runs on this computer");
  await fillTask(form);
  await form.getByRole("button", { name: "Add and start", exact: true }).click();
  await expect.poll(() => mutations(page)).toHaveLength(1);
  expect((await mutations(page))[0].args).toMatchObject({
    machineId: "machine-local",
    method: "tasks.save",
    params: {
      task: {
        projectId: "local-project",
        status: "queued",
        continueUntilDone: true,
      },
    },
  });
});

test("an explicit remote task discovers remote projects and sends the remote project ID", async ({
  page,
}) => {
  const form = await start(page, "task");
  await choose(page, machine(form), "Demo MacBook");
  await expect(machine(form)).toHaveAccessibleName("Machine: Demo MacBook");
  await choose(page, project(form), "remote-api");
  await expect(form).toContainText("Runs on Demo MacBook");
  await fillTask(form);
  await form.getByRole("button", { name: "Add and start", exact: true }).click();
  await expect.poll(() => mutations(page)).toHaveLength(1);
  expect((await mutations(page))[0].args).toMatchObject({
    machineId: "machine-remote",
    params: { task: { projectId: "remote-api", status: "queued" } },
  });
});

test("a goal defaults locally and changing machines clears its projects before remote creation", async ({
  page,
}) => {
  const form = await start(page, "goal");
  await expect(machine(form)).toHaveAccessibleName("Machine: This computer");
  await expect(form.locator("[data-goal-project]")).toHaveCount(1);
  await expect(form.locator("[data-goal-project]")).toHaveAttribute(
    "data-goal-project",
    "C:/fixture/local-project",
  );
  await fillGoal(form);
  await choose(page, machine(form), "Demo MacBook");
  await expect(form.locator("[data-goal-project]")).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Plan it", exact: true })).toBeDisabled();
  await choose(page, project(form), "remote-api");
  await expect(form.locator("[data-goal-project]")).toHaveAttribute(
    "data-goal-project",
    "remote://env-remote/fixture/remote-api",
  );
  await form.getByRole("button", { name: "Plan it", exact: true }).click();
  await expect.poll(() => mutations(page)).toHaveLength(1);
  expect((await mutations(page))[0].args).toMatchObject({
    machineId: "machine-remote",
    method: "goals.create",
    params: {
      goal: {
        projectIds: ["remote-api"],
        leadProjectId: "remote-api",
        continueUntilDone: true,
      },
    },
  });
});

test("a local goal creates on the local host", async ({ page }) => {
  const form = await start(page, "goal");
  await fillGoal(form);
  await form.getByRole("button", { name: "Plan it", exact: true }).click();
  await expect.poll(() => mutations(page)).toHaveLength(1);
  expect((await mutations(page))[0].args).toMatchObject({
    machineId: "machine-local",
    params: {
      goal: { projectIds: ["local-project"], leadProjectId: "local-project" },
    },
  });
});

test("an unavailable local host does not silently start a task remotely", async ({ page }) => {
  const form = await start(page, "task", "?noLocal");
  await fillTask(form);
  await expect(form.getByRole("button", { name: "Add and start", exact: true })).toBeDisabled();
  await expect(form.getByRole("button", { name: "Add to To do", exact: true })).toBeDisabled();
  expect(await mutations(page)).toEqual([]);
  await choose(page, machine(form), "Demo MacBook");
  await choose(page, project(form), "remote-api");
  await form.getByRole("button", { name: "Add and start", exact: true }).click();
  await expect.poll(() => mutations(page)).toHaveLength(1);
  expect((await mutations(page))[0].args.machineId).toBe("machine-remote");
});

test("machine and project selection work by keyboard and restore trigger focus", async ({
  page,
}) => {
  const form = await start(page, "task");
  await machine(form).focus();
  await page.keyboard.press("ArrowDown");
  const search = page.getByRole("combobox", {
    name: "Search options…",
    exact: true,
  });
  await expect(search).toBeFocused();
  await search.fill("Demo MacBook");
  await page.keyboard.press("Enter");
  await expect(machine(form)).toHaveAccessibleName("Machine: Demo MacBook");
  await expect(machine(form)).toBeFocused();
  await project(form).focus();
  await page.keyboard.press("ArrowDown");
  await expect(search).toBeFocused();
  await search.fill("remote-api");
  await page.keyboard.press("Enter");
  await expect(project(form)).toHaveAccessibleName("Project: remote-api");
  await expect(project(form)).toBeFocused();
});

test("project discovery errors have an in-form retry", async ({ page }) => {
  const form = await start(page, "goal", "?projectError");
  await choose(page, machine(form), "Demo MacBook");
  await expect(form.getByRole("alert")).toContainText("Demo MacBook project discovery failed");
  await page.evaluate(() =>
    (window as unknown as { taskFixtureRecoverProjects: () => void }).taskFixtureRecoverProjects(),
  );
  await form.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(form.getByRole("alert")).toHaveCount(0);
  await choose(page, project(form), "remote-api");
  await expect(form.locator("[data-goal-project]")).toHaveCount(1);
});

test("task and goal controls stay inside a narrow viewport", async ({ page }, testInfo) => {
  const screenshots = resolve("temp/verification/2026-10-12-task-controls");
  await mkdir(screenshots, { recursive: true });
  for (const width of [320, 480]) {
    await page.setViewportSize({ width, height: 900 });
    for (const kind of ["task", "goal"] as const) {
      await page.goto(fixture);
      await expect(page.getByText("Up to date", { exact: true })).toBeVisible();
      await expect(page.getByText("No task board", { exact: true })).toHaveCount(0);
      for (const label of ["Summary", "Limits", "New goal", "New task"]) {
        const control = page.getByRole("button", { name: label, exact: true });
        await expect(control).toBeVisible();
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      await page.getByRole("button", { name: `New ${kind}`, exact: true }).click();
      const form = page.getByRole("form", { name: `New ${kind}`, exact: true });
      await expect(machine(form)).toBeVisible();
      const title = form.getByRole("textbox", {
        name: kind === "task" ? "Task title" : "Goal title",
        exact: true,
      });
      await expect(title).toBeVisible();
      expect(
        await title.evaluate((element) => element.getBoundingClientRect().width),
      ).toBeGreaterThanOrEqual(200);
      const measurements = await form.evaluate((element) => ({
        formWidth: element.getBoundingClientRect().width,
        formClient: element.clientWidth,
        formScroll: element.scrollWidth,
        documentScroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        overflow: Array.from(element.querySelectorAll("*")).flatMap((child) => {
          const bounds = child.getBoundingClientRect();
          const formBounds = element.getBoundingClientRect();
          return bounds.right > formBounds.right || child.scrollWidth > child.clientWidth + 1
            ? [
                {
                  tag: child.tagName,
                  className: child.className,
                  label: child.getAttribute("aria-label"),
                  width: bounds.width,
                  right: bounds.right,
                  client: child.clientWidth,
                  scroll: child.scrollWidth,
                },
              ]
            : [];
        }),
        controls: Array.from(element.querySelectorAll("button, input, textarea")).map((control) => {
          const bounds = control.getBoundingClientRect();
          return {
            label: control.getAttribute("aria-label") ?? control.textContent,
            left: bounds.left,
            right: bounds.right,
          };
        }),
      }));
      expect(measurements.documentScroll).toBeLessThanOrEqual(width);
      // A dialog's enter transform scales its visual bounds, not its scroll box.
      expect(measurements.formScroll, JSON.stringify(measurements)).toBeLessThanOrEqual(
        measurements.formClient,
      );
      expect(
        measurements.controls.filter((control) => control.left < -1 || control.right > width + 1),
      ).toEqual([]);
      await page.screenshot({
        animations: "disabled",
        path: resolve(screenshots, `tasks-${testInfo.project.name}-${kind}-${width}.png`),
      });
    }
  }
});

test("task details use the narrow panel and retain the desktop board", async ({
  page,
}, testInfo) => {
  const screenshots = resolve("temp/verification/2026-10-12-task-controls");
  await mkdir(screenshots, { recursive: true });
  for (const width of [320, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    const form = await start(page, "task");
    await fillTask(form);
    await form.getByRole("button", { name: "Add to To do", exact: true }).click();
    await expect.poll(() => mutations(page)).toHaveLength(1);
    expect((await mutations(page))[0].args).toMatchObject({
      machineId: "machine-local",
      method: "tasks.save",
      params: {
        task: {
          projectId: "local-project",
          status: "todo",
          prompt: "Finish the fixture task without stopping.",
        },
      },
    });
    const board = page.locator('[data-task-column="todo"]');
    const card = page.getByRole("article", {
      name: "Run on the selected computer",
      exact: true,
    });
    await expect(card).toBeVisible();
    await card.click();
    const details = page.getByRole("complementary", {
      name: "Task details",
      exact: true,
    });
    await expect(details).toBeVisible();
    await expect(details).toContainText("Finish the fixture task without stopping.");
    const panelWidth = await details.evaluate((element) => element.getBoundingClientRect().width);
    if (width === 320) {
      expect(panelWidth).toBeGreaterThanOrEqual(288);
      await expect(board).toBeHidden();
      await page.screenshot({
        animations: "disabled",
        path: resolve(screenshots, `tasks-${testInfo.project.name}-details-320.png`),
      });
    } else {
      expect(panelWidth).toBe(380);
      await expect(board).toBeVisible();
    }
    await details.getByRole("button", { name: "Close details", exact: true }).click();
    await expect(details).toHaveCount(0);
    await expect(board).toBeVisible();
    await expect(card).toBeVisible();
  }
});

for (const method of ["environment.describe", "goals.list"]) {
  test(`local task writes stay usable while remote ${method} is pending`, async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(`${fixture}?slowRemote=${method}&changes`);
    await expect(page.locator('[data-remote-data-state="refreshing"]')).toBeVisible();
    await expect(page.locator('[data-task-column="todo"]')).toBeVisible();
    await expect(page.getByText("No task board", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New task", exact: true })).toBeEnabled();
    expect(
      await page.evaluate(() =>
        (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls.some(
          (call) => call.args.method === "machine.changes",
        ),
      ),
    ).toBe(false);
    await page.getByRole("button", { name: "New task", exact: true }).click();
    const form = page.getByRole("form", { name: "New task", exact: true });
    await expect(machine(form)).toHaveAccessibleName("Machine: This computer");
    await fillTask(form);
    await form.getByRole("button", { name: "Add to To do", exact: true }).click();
    await expect.poll(() => mutations(page)).toHaveLength(1);
    expect((await mutations(page))[0].args).toMatchObject({
      machineId: "machine-local",
      method: "tasks.save",
      params: { task: { projectId: "local-project", status: "todo" } },
    });
    await expect(form).toHaveCount(0);
    const localCard = page.getByRole("article", {
      name: "Run on the selected computer",
      exact: true,
    });
    await expect(localCard).toBeVisible();
    await localCard.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(localCard).toHaveCount(0);
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await expect(form.getByRole("button", { name: "Add to To do", exact: true })).toBeDisabled();
    await fillTask(form);
    await expect(form.getByRole("button", { name: "Add to To do", exact: true })).toBeEnabled();
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { taskFixtureRemoteReleased: () => boolean }
        ).taskFixtureRemoteReleased(),
      ),
    ).toBe(false);
    await page.evaluate(() =>
      (window as unknown as { taskFixtureReleaseRemote: () => void }).taskFixtureReleaseRemote(),
    );
    await expect(
      page.getByRole("article", { name: "Remote task arrived", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-remote-data-state="ready"]')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls.filter(
              (call) => call.args.method === "machine.changes",
            ).length,
        ),
      )
      .toBeGreaterThan(0);
    await expect(localCard).toHaveCount(0);
  });
}

test("task worker, running reviewer and retained attempts navigate to their own host project", async ({
  page,
}, testInfo) => {
  const screenshots = resolve("temp/verification/2026-10-12-task-controls");
  await mkdir(screenshots, { recursive: true });
  for (const host of ["local", "remote"]) {
    await page.setViewportSize({
      width: host === "local" ? 320 : 1000,
      height: 900,
    });
    await page.goto(`${fixture}?sessionLinks=${host}`);
    const taskCard = page.getByRole("article", {
      name: "Session-linked task",
      exact: true,
    });
    await expect(taskCard).toBeVisible();
    await taskCard.getByRole("button", { name: "Open worker session", exact: true }).click();
    await taskCard.getByRole("button", { name: "Open review session", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "Task details", exact: true }),
    ).toHaveCount(0);
    await taskCard.click();
    const details = page.getByRole("complementary", {
      name: "Task details",
      exact: true,
    });
    const history = details.getByRole("region", {
      name: "Attempt history",
      exact: true,
    });
    await expect(history.locator("[data-timeline-trigger]").first()).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(
      history.getByRole("button", { name: "Open worker session", exact: true }),
    ).toBeVisible();
    await expect(
      history.getByRole("button", { name: "Open review session", exact: true }),
    ).toBeVisible();
    await history.getByRole("button", { name: "Open worker session", exact: true }).click();
    await history.getByRole("button", { name: "Open review session", exact: true }).click();
    const targets = await page.evaluate(
      () =>
        (window as unknown as { taskFixtureOpenedSessions: OpenedSession[] })
          .taskFixtureOpenedSessions,
    );
    const binding =
      host === "local"
        ? {
            machineId: "machine-local",
            cwd: "C:/fixture/local-project",
            projectId: "local-project",
          }
        : {
            machineId: "machine-remote",
            cwd: "remote://env-remote/fixture/remote-project",
            projectId: "remote-project",
          };
    expect(targets).toEqual(
      ["worker-current", "review-current", "worker-retained", "review-retained"].map(
        (sessionId) => ({ ...binding, sessionId }),
      ),
    );
    if (host === "local")
      await page.screenshot({
        animations: "disabled",
        path: resolve(screenshots, `tasks-${testInfo.project.name}-sessions-320.png`),
      });
  }
});
