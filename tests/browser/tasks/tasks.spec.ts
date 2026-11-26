import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// A create or edit form sits beside its footer (Cancel, Add) inside one dialog, so the dialog
// holding the form is the scope that reaches both the fields and the footer actions.
const formDialog = (page: Page, name: string) =>
  page.getByRole("dialog").filter({ has: page.getByRole("form", { name, exact: true }) });

// The final acceptance label and its status are two texts in one row.
const finalAcceptance = (page: Page, status: string) =>
  page
    .getByText("Final epic acceptance", { exact: true })
    .locator("xpath=..")
    .getByText(status, { exact: true });

type HostCall = {
  command: string;
  args: {
    machineId?: string;
    method?: string;
    params?: { task?: Record<string, unknown>; goal?: Record<string, unknown> };
  };
};

// Project, server, and task filters share one toolbar popover.
async function openFilter(page: Page) {
  if (await page.getByRole("dialog", { name: "Filter", exact: true }).count()) return;
  await page
    .locator("header.task-board-toolbar")
    .getByRole("button", { name: "Filter", exact: true })
    .click();
}
for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`tasks redesign states ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        "/tests/browser/tasks/tasks.html?boardControls&tasksUx&sprints&slowOperation=tasks.delete",
      );
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("tab", { name: "Sprints", exact: true }).click();
      await openFilter(page);
      await page.getByRole("button", { name: /^Project:/ }).click();
      await page.getByRole("option", { name: "All projects", exact: true }).click();
      const captures = "temp/verification/tasks-actions-20261114";
      await mkdir(captures, { recursive: true });
      const capture = async (state: string) => {
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await page.screenshot({
          path: `${captures}/${width}-${theme}-${state}.png`,
          animations: "disabled",
        });
      };
      await openFilter(page);
      await page.getByRole("button", { name: /^Project:/ }).click();
      await page.getByRole("combobox").fill("no-matching-project");
      await expect(page.getByRole("option", { name: "All projects", exact: true })).toBeVisible();
      await capture("project-filter");
      await page.getByRole("option", { name: "All projects", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "New sprint", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "New task", exact: true })).toHaveCount(0);
      await expect(page.locator('[data-task-column="todo"]')).toBeHidden();
      await capture("sprints-empty");
      await page.getByRole("button", { name: "New sprint", exact: true }).click();
      const sprint = page.getByRole("dialog", { name: "New sprint", exact: true });
      await sprint.getByLabel("Name", { exact: true }).fill("Release confidence");
      await expect(sprint.getByLabel("Sprint capacity (points)", { exact: true })).toBeHidden();
      await capture("sprint-form");
      await sprint
        .locator("summary")
        .filter({ hasText: /^Capacity · optional$/ })
        .click();
      await sprint.getByLabel("Sprint capacity (points)", { exact: true }).fill("13");
      await capture("sprint-capacity");
      await sprint.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("tab", { name: "Tasks", exact: true }).click();
      await openFilter(page);
      await page.getByRole("button", { name: /^Project:/ }).click();
      await page.getByRole("option", { name: /^local-project / }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("radio", { name: "List view", exact: true }).check();
      await expect(
        page.getByRole("button", { name: "Repair standalone packaging", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".task-list-description")).toHaveCount(0);
      await capture("list");
      await page.getByRole("radio", { name: "Board view", exact: true }).check();
      await expect(page.locator("[data-task-description]")).toHaveCount(0);
      await capture("board");
      const card = page.getByRole("article", { name: "Repair standalone packaging", exact: true });
      // Click the title: the card's center can land on the status button, which opens the stop reason.
      await card.getByRole("heading", { name: "Repair standalone packaging", exact: true }).click();
      const detail = page.getByRole("complementary", { name: "Task details", exact: true });
      await expect(detail).toContainText("Responsibilities");
      await expect(detail.locator("summary").filter({ hasText: /^Error details$/ })).toBeVisible();
      const errorDetails = detail
        .locator("summary")
        .filter({ hasText: /^Error details$/ })
        .locator("..");
      await expect(errorDetails).not.toHaveAttribute("open", "");
      await capture("detail");
      await errorDetails.locator("summary").click();
      await expect(errorDetails).toHaveAttribute("open", "");
      await capture("error-details");
      await errorDetails.locator("summary").click();
      const estimate = detail.getByRole("button", { name: /^Points:/ });
      await choose(page, estimate, "3");
      await expect(estimate).toHaveAccessibleName("Points: 3");
      await expect(detail.getByRole("button", { name: "Save planning", exact: true })).toHaveCount(
        0,
      );
      await capture("detail-planning");
      await detail.getByRole("button", { name: "Edit title and description", exact: true }).click();
      await expect(detail.getByLabel("Description", { exact: true })).toHaveValue(
        /Responsibilities/,
      );
      await capture("inline-edit");
      await detail.getByRole("button", { name: "Cancel", exact: true }).click();
      await detail.getByRole("button", { name: "Close details", exact: true }).click();
      await card.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
      const editForm = page.getByRole("dialog", { name: "Edit task", exact: true });
      await expect(editForm.getByLabel("Description", { exact: true })).toHaveValue(
        /Responsibilities/,
      );
      await capture("task-edit");
      await editForm.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "More actions", exact: true }).first().click();
      await page.getByRole("menuitemcheckbox", { name: "Select tasks", exact: true }).click();
      await page.getByRole("checkbox", { name: "Select all results", exact: true }).check();
      const bulk = page.getByRole("region", { name: "Selected task actions", exact: true });
      await expect(bulk.getByRole("button", { name: /^Start\b/ })).toBeEnabled();
      await expect(bulk.getByRole("button", { name: /^Retry\b/ })).toBeEnabled();
      await expect(bulk.getByRole("button", { name: /^Stop\b/ })).toBeDisabled();
      await expect(bulk.getByRole("button", { name: /^Delete\b/ })).toBeEnabled();
      await capture("bulk-eligibility");
      await bulk.getByRole("button", { name: /^Delete\b/ }).click();
      const confirm = page.getByRole("dialog", { name: "Delete selected tasks", exact: true });
      await expect(confirm).toContainText("5 are eligible");
      await capture("delete-confirm");
      await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls.filter(
              (call) => call.args.method === "tasks.delete",
            ).length,
        ),
      ).toBe(0);
      await bulk.getByRole("button", { name: "Finish selection", exact: true }).click();
      await page.getByRole("button", { name: "New task", exact: true }).click();
      const form = page.getByRole("dialog", { name: "New task", exact: true });
      await form.getByLabel("Task title", { exact: true }).fill("Verify release packaging");
      await form
        .getByLabel("Description", { exact: true })
        .fill(
          "Keep the existing build pipelines.\nVerify the standalone package.\nPreserve active work and report checks.",
        );
      await capture("task-form");
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("tab", { name: "Sprints", exact: true }).click();
      await page.getByRole("button", { name: "New sprint", exact: true }).click();
      const createSprint = page.getByRole("dialog", { name: "New sprint", exact: true });
      await createSprint.getByLabel("Name", { exact: true }).fill("Release confidence");
      await createSprint.getByRole("button", { name: "Create sprint", exact: true }).click();
      await expect(createSprint).toBeHidden();
      await expect(
        page.getByRole("heading", { name: "No tasks in this sprint", exact: true }),
      ).toBeVisible();
      await capture("sprint-selected-empty");
      await page.getByRole("button", { name: "Browse tasks", exact: true }).click();
      await page.getByRole("button", { name: "More actions", exact: true }).first().click();
      await page.getByRole("menuitemcheckbox", { name: "Select tasks", exact: true }).click();
      await page.getByRole("checkbox", { name: "Select all results", exact: true }).check();
      const planning = page.getByRole("region", { name: "Planning", exact: true });
      await planning.getByRole("button", { name: /^Sprint:/ }).click();
      await page.getByRole("option", { name: "Release confidence", exact: true }).click();
      await planning.getByRole("button", { name: "Apply to 5 tasks", exact: true }).click();
      await expect(planning).toContainText("Updated 5 of 5 tasks");
      await bulk.getByRole("button", { name: "Finish selection", exact: true }).click();
      await page.getByRole("tab", { name: "Sprints", exact: true }).click();
      await capture("sprint-list");
      await page.getByRole("button", { name: /^Release confidence\b/ }).click();
      await expect(
        page.getByRole("article", { name: "Repair standalone packaging", exact: true }),
      ).toBeVisible();
      await capture("sprint-selected");
      await page.getByRole("button", { name: "More actions", exact: true }).first().click();
      await page.getByRole("menuitemcheckbox", { name: "Select tasks", exact: true }).click();
      await page.getByRole("checkbox", { name: "Select all results", exact: true }).check();
      await bulk.getByRole("button", { name: /^Delete\b/ }).click();
      await page
        .getByRole("dialog", { name: "Delete selected tasks", exact: true })
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await expect(bulk.getByRole("button", { name: /^Delete\b/ })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await capture("delete-pending");
      await page.evaluate(() =>
        (window as unknown as { taskFixtureReleaseRemote: () => void }).taskFixtureReleaseRemote(),
      );
      await expect(bulk).toContainText("5 succeeded, 0 skipped, 0 failed");
    });
  }
const fixture = "/tests/browser/tasks/tasks.html";
for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`shared server sprints ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.install();
      await page.goto(`${fixture}?sprints&sharedServers`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const captures = "temp/verification/tasks-shared-20261114";
      await mkdir(captures, { recursive: true });
      const capture = async (state: string) => {
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await page.screenshot({
          path: `${captures}/${width}-${theme}-${state}.png`,
          animations: "disabled",
        });
      };
      await openFilter(page);
      await expect(
        page.getByRole("button", { name: "Project: All projects", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Server: All servers", exact: true }),
      ).toBeVisible();
      await capture("tasks-all-servers");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Running · 1", exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "Sprints", exact: true }).click();
      await expect(page.getByRole("button", { name: /^Desktop sprint\b/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Mac sprint\b/ })).toBeVisible();
      await capture("sprint-catalog");
      await openFilter(page);
      await page.getByRole("button", { name: "Server: All servers", exact: true }).click();
      await page.getByRole("option", { name: "Demo MacBook", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: /^Desktop sprint\b/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Mac sprint\b/ })).toBeVisible();
      await capture("sprint-server-filter");
      await openFilter(page);
      const filters = page.getByRole("dialog", { name: "Filter", exact: true });
      await filters.getByRole("button", { name: /^Status:/ }).click();
      await page.getByRole("option", { name: "Done", exact: true }).click();
      await expect(
        filters.getByRole("button", { name: "Server: Demo MacBook", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Reset filters", exact: true }).click();
      await openFilter(page);
      await expect(
        filters.getByRole("button", { name: "Server: All servers", exact: true }),
      ).toBeVisible();
      await choose(page, filters.getByRole("button", { name: /^Server:/ }), "Demo MacBook");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Mac sprint\b/ }).click();
      await expect(page.getByRole("heading", { name: "Mac sprint", exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "MacBook checkout", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Start sprint", exact: true }).click();
      await expect(page.locator('[data-sprint-state="active"]')).toBeVisible();
      expect(
        await page.evaluate(() =>
          (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls.some(
            (call) =>
              call.args.method === "sprints.start" && call.args.machineId === "machine-remote",
          ),
        ),
      ).toBe(true);
      await capture("remote-sprint");
      await expect(page.getByRole("button", { name: /^Running ·/ })).toHaveCount(0);
      const sprints = page.getByRole("region", { name: "Sprints", exact: true });
      await taskMenuAction(page, sprints, "New sprint");
      const form = page.getByRole("dialog", { name: "New sprint", exact: true });
      await form.getByLabel("Name", { exact: true }).fill("Shared rollout");
      await form.getByRole("button", { name: /^Projects:/ }).click();
      const desktopProject = page.getByRole("option", {
        name: /local-project.*Renamed development PC/,
      });
      const macProject = page.getByRole("option", { name: /remote-project.*Demo MacBook/ });
      await desktopProject.click();
      await macProject.click();
      await expect(desktopProject).toHaveAttribute("aria-selected", "true");
      await expect(macProject).toHaveAttribute("aria-selected", "true");
      await capture("sprint-project-servers");
      await page.keyboard.press("Escape");
      await form
        .locator("summary")
        .filter({ hasText: /^Capacity · optional$/ })
        .click();
      await expect(form).toContainText("Points are not hours and do not limit running tasks.");
      await capture("sprint-estimates");
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "All sprints", exact: true }).click();
      await openFilter(page);
      await choose(page, page.getByRole("button", { name: /^Server:/ }), "All servers");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "New sprint", exact: true }).click();
      const saveOn = page.getByRole("dialog", { name: "New sprint", exact: true });
      await choose(
        page,
        saveOn.getByRole("button", { name: /^Save on:/ }),
        "Renamed development PC",
      );
      await saveOn.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("button", { name: /^Desktop sprint\b/ })).toBeVisible();
      await page.evaluate(() =>
        (
          window as unknown as { taskFixtureDisconnectSprintServer: () => void }
        ).taskFixtureDisconnectSprintServer(),
      );
      await page.clock.fastForward(16_000);
      const offlineSprint = page.getByRole("button", { name: /^Mac sprint\b/ });
      await expect(offlineSprint).toBeDisabled();
      await expect(offlineSprint.locator('[data-sprint-state="active"]')).toBeVisible();
      await expect(page.getByRole("button", { name: /^Desktop sprint\b/ })).toBeEnabled();
      await expect(page.getByText(/Fixture sprint server offline/)).toBeVisible();
      await capture("sprint-server-offline");
    });
  }
for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`task action recovery ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `${fixture}?boardControls&tasksUx&tasksActions&taskDeleteError&epicDeleteError`,
      );
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const capture = async (state: string) => {
        await page.screenshot({
          path: `temp/verification/tasks-actions-20261114/${width}-${theme}-${state}.png`,
          animations: "disabled",
        });
      };
      await openFilter(page);
      await page.getByRole("button", { name: /^Project:/ }).click();
      const allProjects = page.getByRole("option", { name: "All projects", exact: true });
      await page.getByRole("listbox").evaluate((list) => {
        list.scrollTop = list.scrollHeight;
      });
      await expect(allProjects).toBeInViewport();
      await capture("projects-scrolled");
      await allProjects.click();
      await page.keyboard.press("Escape");
      await openGoals(page);
      const epic = page.getByRole("article", { name: "Mobile workspace refresh", exact: true });
      await expect(epic).toBeVisible();
      const details = epic.getByRole("button", { name: "Details", exact: true });
      await expect(details).toHaveAttribute("aria-expanded", "false");
      await expect(epic.getByText("Final epic acceptance", { exact: true })).toBeHidden();
      await capture("epic-collapsed");
      await details.click();
      await expect(epic.getByText("Run usage", { exact: true })).toBeVisible();
      await capture("epic-details");
      await epic.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
      const epicConfirm = page.getByRole("dialog", { name: "Delete epic", exact: true });
      await epicConfirm.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(epicConfirm).toContainText("Stop this goal’s running tasks before deleting it.");
      await expect(epic).toBeVisible();
      await capture("epic-delete-error");
      await epicConfirm.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(epicConfirm).toBeHidden();
      await expect(epic).toHaveCount(0);
      await page.getByRole("radio", { name: "Board view", exact: true }).check();
      const task = page.getByRole("article", { name: "Repair standalone packaging", exact: true });
      await task.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
      const taskConfirm = page.getByRole("dialog", { name: "Delete task", exact: true });
      await taskConfirm.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(taskConfirm).toContainText("The machine disconnected during deletion.");
      await expect(task).toBeVisible();
      await capture("task-delete-error");
      await taskConfirm.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(taskConfirm).toBeHidden();
      await expect(task).toHaveCount(0);
    });
  }
for (const width of [1280, 800])
  for (const theme of ["light", "dark"])
    for (const zoom of [1, 2]) {
      test(`workbench critical labels stay readable ${width} ${theme} zoom ${zoom}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(`${fixture}?uiCoherence&data=worst&rtl`);
        await page.evaluate(
          ({ light, scale }) => {
            document.documentElement.classList.toggle("theme-light", light);
            document.documentElement.style.zoom = String(scale);
          },
          { light: theme === "light", scale: zoom },
        );
        const label = page.getByText(
          "Araştırma ortamındaki ajanların günlük çalışma süresi üst sınırı",
          { exact: true },
        );
        await expect(label).toBeVisible();
        const configure = page.getByRole("button", { name: "Configure", exact: true });
        const actionBounds = await configure.boundingBox();
        expect(actionBounds?.x).toBeGreaterThanOrEqual(0);
        await expect(page.getByRole("region", { name: "Addresses", exact: true })).toBeVisible();
        await mkdir("temp/verification/2026-11-13-ui-coherence/workbench", { recursive: true });
        await page.screenshot({
          path: `temp/verification/2026-11-13-ui-coherence/workbench/${process.env.BYCODA_UI_BEFORE ? "before" : "after"}-${width}-${theme}-${zoom}.png`,
          fullPage: true,
        });
        expect(
          await label.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);
        const status = page.locator(".goal-card-meta").getByText("Offline", { exact: true });
        await expect(status).toBeVisible();
        expect(
          await status.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);
        const endpoint = page.getByText(
          "research-development-workstation.northwind-industries-holdings.example.com",
          { exact: true },
        );
        await expect(endpoint).toBeVisible();
        expect(await endpoint.evaluate((element) => getComputedStyle(element).wordBreak)).not.toBe(
          "break-all",
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        ).toBe(true);
        await page.getByRole("radio", { name: "Demo data", exact: true }).click();
        await expect(page.getByText("Daily agent time", { exact: true })).toBeVisible();
        await expect(page.locator(".goal-card-meta")).not.toContainText("Offline");
      });
    }
for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`stalled worker stays running with a diagnostic ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?stalled`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await mkdir("temp/verification/arif-assistant-stalls", { recursive: true });
      const card = page.getByRole("article", { name: "Inspect delayed worker", exact: true });
      await expect(card.getByText("Running · no recent output", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/arif-assistant-stalls/${theme}-${width}-board.png`,
      });
      await page.getByRole("radio", { name: "List view", exact: true }).click();
      await expect(page.getByText("Running · no recent output", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/arif-assistant-stalls/${theme}-${width}-list.png`,
      });
      await page.getByRole("button", { name: "Inspect delayed worker", exact: true }).click();
      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      await expect(details.locator("[data-task-status-line=stalled]")).toContainText(
        "The task is still running.",
      );
      await expect(details.getByText("Running · no recent output", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/arif-assistant-stalls/${theme}-${width}-detail.png`,
      });
      await openTasks(page, `${fixture}?stalled&cleared`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await expect(page.getByText("Running · no recent output", { exact: true })).toHaveCount(0);
      await page.screenshot({
        path: `temp/verification/arif-assistant-stalls/${theme}-${width}-cleared.png`,
      });
    });
  }
for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`suspended merge preferences require review in forms at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?boardControls&renewedApprovalSettings&suspendedForms`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await mkdir("temp/verification/s5", { recursive: true });
      for (const kind of ["task", "goal"] as const) {
        await openCreate(page, kind);
        const form = formDialog(page, `New ${kind === "goal" ? "epic" : "task"}`);
        await openOptions(form);
        await expect(form.getByText("Merge automatically", { exact: true })).toHaveCount(0);
        await page.screenshot({
          path: `temp/verification/s5/${kind}-suspended-merge-${width}-${theme}.png`,
          animations: "disabled",
        });
        await form.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      await openGoals(page);
      await openEpicSettings(page);
      const settings = formDialog(page, "Edit epic settings");
      await openOptions(settings);
      await expect(settings.getByText("Merge automatically", { exact: true })).toHaveCount(0);
      await settings.getByRole("button", { name: "About epic settings" }).click();
      await expect(page.getByText(/Delivery requires approval/)).toBeVisible();
      await page.screenshot({
        path: `temp/verification/s5/goal-settings-suspended-merge-${width}-${theme}.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await settings.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "More actions", exact: true }).first().click();
      await page.getByRole("menuitemcheckbox", { name: "Stewards", exact: true }).click();
      await page.getByRole("button", { name: "Add steward", exact: true }).click();
      const steward = formDialog(page, "New steward");
      await openOptions(steward);
      await expect(steward.getByText("Merge automatically", { exact: true })).toHaveCount(0);
      await page.screenshot({
        path: `temp/verification/s5/steward-suspended-merge-${width}-${theme}.png`,
        animations: "disabled",
      });
    });
  }
for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`managed task list keeps completion and delivery visible at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?managedDelivery`);
      await page.getByRole("radio", { name: "List view", exact: true }).click();
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const list = page.getByRole("list", { name: "Tasks", exact: true });
      await expect(list).toContainText("Implementation finished · Not delivered");
      await expect(list).toContainText("renew approval");
      await mkdir("temp/verification/s5", { recursive: true });
      await page.screenshot({
        path: `temp/verification/s5/tasks-list-delivery-${width}-${theme}.png`,
        animations: "disabled",
      });
      await list
        .getByRole("button", { name: "Finished implementation awaiting delivery", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      const detail = page.getByRole("complementary", { name: "Task details", exact: true });
      await openDetailDisclosure(detail);
      await expect(detail.getByText("Not delivered", { exact: true })).toBeVisible();
    });
  }
for (const width of [1280, 800])
  for (const theme of ["light", "dark"]) {
    test(`managed tasks separate completion and approval at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?managedDelivery`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const task = page.getByRole("article", {
        name: "Finished implementation awaiting delivery",
        exact: true,
      });
      // Exceptional state leads the card; completion and delivery details live in the detail panel.
      await expect(task).toContainText(
        "Automatic merge is suspended. Review changes to renew approval.",
      );
      await expect(task.getByRole("button", { name: "Review changes", exact: true })).toBeVisible();
      await mkdir("temp/verification/i2a", { recursive: true });
      await task.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/i2a/tasks-delivery-${width}-${theme}.png`,
        animations: "disabled",
      });
      await task.click();
      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      await openDetailDisclosure(details);
      await expect(details.getByText("Completion", { exact: true })).toBeVisible();
      await expect(details.getByText("Not delivered", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/i2a/task-detail-delivery-${width}-${theme}.png`,
        animations: "disabled",
      });
      await details.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Mark finished", exact: true }).click();
      const calls = () =>
        page.evaluate(
          () => (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls,
        );
      await expect
        .poll(async () => (await calls()).some((call) => call.args.method === "workspaces.finish"))
        .toBe(true);
      expect((await calls()).some((call) => call.args.method === "tasks.move")).toBe(false);
    });
  }
for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`task operations visual acceptance ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?boardControls&visualSteward`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await mkdir("temp/verification/task-ops-visual", { recursive: true });
      await page.getByRole("button", { name: "More actions", exact: true }).first().click();
      await page.getByRole("menuitemcheckbox", { name: "Stewards", exact: true }).click();
      const stewards = page.getByRole("region", { name: "Stewards", exact: true });
      await expect(stewards.getByRole("article")).toBeVisible();
      await stewards.screenshot({
        path: `temp/verification/task-ops-visual/${theme}-${width}-stewards.png`,
        animations: "disabled",
      });
      const counts = page.getByRole("region", { name: "Task counts", exact: true });
      await expect(counts).toBeVisible();
      await counts.getByRole("button", { name: /^Agent time today ·/ }).click();
      const breakdown = page.getByRole("dialog", { name: "Agent time today", exact: true });
      await expect(breakdown).toBeVisible();
      await page.screenshot({
        path: `temp/verification/task-ops-visual/${theme}-${width}-counts.png`,
        animations: "disabled",
      });
    });
  }
/** Choose all projects and Board view for cases that exercise the board across projects. */
async function openTasks(page: Page, url: string) {
  await page.goto(url);
  await openFilter(page);
  const projectScope = page.getByRole("button", { name: /^Project:/ });
  await projectScope.click();
  await page.getByRole("option", { name: "All projects", exact: true }).click();
  await page.keyboard.press("Escape");
  const boardView = page.getByRole("radio", { name: "Board view", exact: true });
  if (await boardView.count()) await boardView.check();
  // boardControls seeds an existing goal through asynchronous Host reads. A
  // synchronous DOM count can miss it, leaving every existing-goal action hidden.
  if (new URLSearchParams(url.split("?")[1]).has("boardControls")) await openGoals(page);
}

async function openGoals(page: Page) {
  await expect(page.getByRole("region", { name: "Epics", exact: true })).toBeVisible();
}
test("worktree creation keeps the active button visible and focused", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const form = await start(page, "goal", "?slowOperation=git.worktreeCreate");
  await fillGoal(form);
  await workspaceChip(form).focus();
  await page.keyboard.press("Enter");
  const workspace = page.getByRole("dialog", { name: "Workspace", exact: true });
  const branch = workspace.getByPlaceholder("goal/settings", { exact: true });
  await branch.fill("ui-feedback");
  const create = workspace.getByRole("button", { name: "Create a separate worktree", exact: true });
  await create.focus();
  await create.press("Enter");
  await expect(create).toHaveAttribute("aria-busy", "true");
  await expect(create).toBeFocused();
  await expect(branch).toBeDisabled();
  await create.evaluate((node: HTMLButtonElement) => node.click());
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls.filter(
          (call) => call.args.method === "git.worktreeCreate",
        ).length,
    ),
  ).toBe(1);
  await page.screenshot({
    path: "temp/verification/2026-10-25-full-ui/tasks-crews/pending-worktree-390.png",
    fullPage: true,
  });
  await page.evaluate(() =>
    (window as unknown as { taskFixtureReleaseRemote: () => void }).taskFixtureReleaseRemote(),
  );
  await expect(branch).toHaveValue("");
  await expect(create).not.toHaveAttribute("aria-busy", "true");
});
for (const kind of ["task", "goal"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`local ${kind} submit feedback retains focus and draft in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 950 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const method = kind === "task" ? "tasks.save" : "goals.create";
      const form = await start(page, kind, `?slowOperation=${method}`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      if (kind === "task") await fillTask(form);
      else await fillGoal(form);
      const action = form.getByRole("button", {
        name: kind === "task" ? "Start" : "Plan it",
        exact: true,
      });
      await action.focus();
      await action.press("Enter");
      await expect(action).toHaveAttribute("aria-busy", "true");
      await expect(action).toBeFocused();
      expect(await action.evaluate((node) => !!node.closest("[inert]"))).toBe(false);
      if (kind === "task")
        await expect(
          form.getByRole("button", { name: "Add to To do", exact: true }),
        ).not.toHaveAttribute("aria-busy", "true");
      await action.evaluate((node: HTMLButtonElement) => node.click());
      await expect
        .poll(
          async () => (await mutations(page)).filter((call) => call.args.method === method).length,
        )
        .toBe(1);
      await expect(form.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
      await page.screenshot({
        path: `temp/verification/2026-10-25-full-ui/tasks-crews/pending-${kind}-390-${theme}.png`,
        fullPage: true,
      });
      await page.evaluate(() =>
        (window as unknown as { taskFixtureReleaseRemote: () => void }).taskFixtureReleaseRemote(),
      );
      await expect(form).toHaveCount(0);
    });
  }
}
const harnessPageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }, testInfo) => {
  if (
    /^(harness |editing a saved custom reviewer|final acceptance |acceptance evidence )/.test(
      testInfo.title,
    )
  ) {
    const errors: string[] = [];
    harnessPageErrors.set(page, errors);
    page.on("pageerror", (error) => errors.push(error.message));
  }
});
test.afterEach(({ page }) => {
  const errors = harnessPageErrors.get(page);
  if (errors) expect(errors, "Uncaught browser errors in the harness flow").toEqual([]);
});

const harnessCaptures = resolve("temp/verification/2026-10-24-task-harness");
for (const { width, theme } of [
  { width: 390, theme: "light" },
  { width: 1440, theme: "dark" },
] as const) {
  test(`harness workflow, preparation and run budget preserve the draft at ${width}px ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const form = await start(page, "task", "?boardControls&harness");
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value === "light"),
      theme,
    );
    await fillTask(form);
    const objective = "Keep this exact user objective while reusing the workflow.";
    await form.getByRole("combobox", { name: "Description", exact: true }).fill(objective);
    const template = form.getByRole("button", { name: /^Template(?:[: ]|$)/ });
    await template.focus();
    await page.keyboard.press("Enter");
    const templates = page.getByRole("menu", { name: "Template", exact: true });
    await templates.getByRole("menuitemradio", { name: "Source research", exact: true }).click();
    await expect(templates).toBeHidden();
    await expect(template).toBeFocused();
    const applied = JSON.parse(
      await form.getByRole("combobox", { name: "Description", exact: true }).inputValue(),
    );
    expect(applied.objective).toBe(objective);
    expect(applied.acceptance).toContain(
      "Factual claims are checked against opened primary sources",
    );
    const review = form.getByRole("switch", { name: "Review with a second agent", exact: true });
    if (!(await review.isChecked())) await review.click();
    await expect(review).toBeChecked();
    await openOptions(form);
    const reviewerInstructions = "Check every source and preserve unresolved acceptance evidence.";
    await form.getByRole("button", { name: "Same as worker", exact: true }).click();
    const modelPanel = page.getByRole("dialog", { name: "Model and settings", exact: true });
    await modelPanel.getByRole("option", { name: /Demo agent/ }).click();
    const high = modelPanel
      .locator("[data-model-settings]")
      .getByRole("radiogroup", { name: /^(Effort|Reasoning)$/ })
      .getByRole("radio", { name: "High", exact: true });
    await high.click();
    await expect(high).toHaveAttribute("aria-checked", "true");
    // A picked setting keeps the panel open; Escape closes only the panel.
    await page.keyboard.press("Escape");
    await expect(modelPanel).toHaveCount(0);
    await expect(form).toBeVisible();
    await form.getByRole("button", { name: "Add resource", exact: true }).scrollIntoViewIfNeeded();
    await form.getByRole("button", { name: "Add resource", exact: true }).click();
    await form
      .getByRole("textbox", { name: "Resource reference", exact: true })
      .fill("sources/report.md");
    await form
      .getByRole("textbox", { name: "Reviewer instructions", exact: true })
      .fill(reviewerInstructions);
    await expect(form).toContainText("Checked by the in-memory fixture");
    expect(await mutations(page)).toHaveLength(0);
    await template.click();
    await templates.getByRole("menuitem", { name: "Save as template", exact: true }).click();
    await page.getByRole("textbox", { name: "Template name", exact: true }).fill("My checked flow");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      templates.getByRole("menuitemradio", { name: "My checked flow", exact: true }),
    ).toBeChecked();
    await page.screenshot({
      path: testInfo.outputPath("template-menu.png"),
      animations: "disabled",
    });
    await template.click();
    await form.getByRole("spinbutton", { name: "Agent minutes", exact: true }).fill("15.5");
    await form.getByRole("spinbutton", { name: "Maximum agent runs", exact: true }).fill("12");
    await form
      .getByRole("spinbutton", { name: "Reported token limit", exact: true })
      .fill("100000");
    await mkdir(harnessCaptures, { recursive: true });
    await form
      .getByRole("spinbutton", { name: "Reported token limit", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(
        harnessCaptures,
        `workflow-budget-${testInfo.project.name}-${width}-${theme}.png`,
      ),
      animations: "disabled",
    });
    await form.getByRole("button", { name: "Add to To do", exact: true }).click();
    await expect.poll(() => mutations(page)).toHaveLength(1);
    const input = (await mutations(page))[0].args.params!.task!;
    expect(input).toMatchObject({
      budget: { maxAgentMinutes: 15.5, maxAttempts: 12, maxTokens: 100000 },
      preflightRequirements: [{ kind: "source", id: "sources/report.md", required: true }],
      review: true,
      reviewerConfig: {
        harness: "claude",
        model: "claude:fixture",
        modelSettings: { effort: "high" },
        instructions: reviewerInstructions,
      },
    });
    expect(JSON.parse(String(input.prompt)).objective).toBe(objective);
    await openTasks(page, page.url());
    await openCreate(page, "task");
    const reopened = formDialog(page, "New task");
    await reopened.getByRole("button", { name: "Template", exact: true }).click();
    await templates.getByRole("menuitemradio", { name: "My checked flow", exact: true }).click();
    await expect(templates).toBeHidden();
    await expect(
      reopened.getByRole("button", { name: "Template: My checked flow", exact: true }),
    ).toBeFocused();
    await openOptions(reopened);
    const restored = JSON.parse(
      await reopened.getByRole("combobox", { name: "Description", exact: true }).inputValue(),
    );
    expect(restored.acceptance).toContain(
      "Factual claims are checked against opened primary sources",
    );
    await expect(
      reopened.getByRole("switch", { name: "Review with a second agent", exact: true }),
    ).toBeChecked();
    await expect(
      reopened.getByRole("textbox", { name: "Reviewer instructions", exact: true }),
    ).toHaveValue(reviewerInstructions);
    await expect(
      reviewerRow(page, reopened).getByRole("button", { name: /^Claude Code.*effort High/ }),
    ).toBeVisible();
    expect(await mutations(page)).toHaveLength(0);
  });

  test(`harness quality comparison records explicit owner evaluation at ${width}px ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await openTasks(page, `${fixture}?boardControls&harness`);
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value === "light"),
      theme,
    );
    await page.getByRole("article", { name: "Completed task", exact: true }).click();
    const details = page.getByRole("complementary", { name: "Task details", exact: true });
    const summary = details.locator("summary").filter({ hasText: /^Run quality and usage$/ });
    await summary.focus();
    await page.keyboard.press("Enter");
    await details
      .getByRole("checkbox", { name: "I accept this result for quality comparison", exact: true })
      .check();
    await details
      .getByRole("spinbutton", { name: "My review time (minutes)", exact: true })
      .fill("2.5");
    await details.getByRole("spinbutton", { name: "Corrections I needed", exact: true }).fill("1");
    await details.getByRole("button", { name: "Save evaluation", exact: true }).click();
    await expect(
      details.getByRole("status").filter({ hasText: /^Evaluation saved$/ }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).taskFixtureCalls.filter(
              (call: any) => call.args.method === "tasks.evaluation.save",
            ).length,
        ),
      )
      .toBe(1);
    const saved = await page.evaluate(() =>
      (window as any).taskFixtureCalls.find(
        (call: any) => call.args.method === "tasks.evaluation.save",
      ),
    );
    expect(saved.args.params).toMatchObject({
      taskId: "review",
      expectedUpdatedAt: 3,
      evaluation: { accepted: true, reviewMinutes: 2.5, corrections: 1 },
    });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Compare accepted results", exact: true }).click();
    const comparison = page.getByRole("dialog", { name: "Compare accepted results", exact: true });
    await expect(comparison).toContainText("Demo agent");
    const help = comparison.getByRole("button", { name: "Help", exact: true });
    await help.click();
    await expect(page.getByRole("dialog", { name: "Help", exact: true })).toContainText(
      "not a controlled model benchmark",
    );
    await help.click();
    await expect(comparison).toContainText("2.5");
    expect(await comparison.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await mkdir(harnessCaptures, { recursive: true });
    await page.screenshot({
      path: resolve(harnessCaptures, `quality-${testInfo.project.name}-${width}-${theme}.png`),
      animations: "disabled",
    });
    // The zoom passes drive device metrics over CDP, which only Chromium offers.
    const chromium = testInfo.project.name === "chromium";
    const layouts =
      chromium && width === 390
        ? [1280, 800].flatMap((width) =>
            ["light", "dark"].flatMap((theme) => [1, 2].map((zoom) => ({ width, theme, zoom }))),
          )
        : [];
    const device = chromium ? await page.context().newCDPSession(page) : null;
    for (const layout of [{ width, theme, zoom: 1 }, ...layouts]) {
      const viewport = { width: layout.width / layout.zoom, height: 950 / layout.zoom };
      await page.setViewportSize(viewport);
      // Reflow plus pixel density emulates zoom geometry without CSS zoom changing vw behavior.
      await device?.send("Emulation.setDeviceMetricsOverride", {
        ...viewport,
        deviceScaleFactor: layout.zoom,
        mobile: false,
      });
      await page.evaluate(({ theme }) => {
        document.documentElement.classList.toggle("theme-light", theme === "light");
      }, layout);
      const values = comparison.locator("dd");
      await expect(values).toHaveCount(6);
      await expect(values).toHaveText(["1", "3", "2.5", "1", "1,200", "0.12"]);
      for (const value of await values.all()) {
        const bounds = await value.evaluate((node) => ({
          height: node.clientHeight,
          line: parseFloat(getComputedStyle(node).lineHeight),
          overflow: node.scrollWidth - node.clientWidth,
        }));
        expect(bounds.height).toBeLessThanOrEqual(bounds.line + 1);
        expect(bounds.overflow).toBeLessThanOrEqual(0);
      }
      expect(
        await comparison.evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(0);
      const bounds = await comparison.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({
        path: testInfo.outputPath(
          `quality-reflow-${layout.width}-${layout.theme}-${layout.zoom}.png`,
        ),
        animations: "disabled",
      });
    }
    await device?.detach();
  });
}

test("editing a saved custom reviewer can restore the worker profile", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTasks(page, `${fixture}?boardControls&harness&customReviewer`);
  const card = page.getByRole("article", { name: "First queued task", exact: true });
  await taskMenuAction(page, card, "Edit");
  const form = formDialog(page, "Edit task");
  await openOptions(form);
  const instructions = form.getByRole("textbox", { name: "Reviewer instructions", exact: true });
  await expect(instructions).toHaveValue("Stored custom reviewer instructions.");
  await reviewerRow(page, form)
    .getByRole("button", { name: /^Claude Code/ })
    .click();
  const modelPanel = page.getByRole("dialog", { name: "Model and settings", exact: true });
  await modelPanel.getByRole("button", { name: "Same as worker", exact: true }).click();
  if (await modelPanel.isVisible()) await page.keyboard.press("Escape");
  await expect(instructions).toBeDisabled();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(() => mutations(page)).toHaveLength(1);
  expect((await mutations(page))[0].args.params!.task).toMatchObject({
    id: "first",
    review: true,
    reviewerConfig: null,
  });
  await taskMenuAction(page, card, "Edit");
  await openOptions(form);
  await expect(form.getByRole("button", { name: "Same as worker", exact: true })).toBeVisible();
  await expect(instructions).toBeDisabled();
  const captures = resolve(
    "temp/verification/2026-10-24-task-harness-local/browser/current-captures",
  );
  await mkdir(captures, { recursive: true });
  await page.screenshot({
    path: resolve(captures, `reviewer-reset-${testInfo.project.name}-390.png`),
    animations: "disabled",
  });
});

for (const state of ["finalPending", "finalFailure"] as const) {
  for (const { width, theme } of [
    { width: 390, theme: "light" },
    { width: 1440, theme: "dark" },
  ] as const) {
    test(`final acceptance ${state} stays visible and supports owner recheck at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?boardControls&${state}`);
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value === "light"),
        theme,
      );
      await expect(
        finalAcceptance(page, state === "finalFailure" ? "Failed" : "Queued"),
      ).toBeVisible();
      if (state === "finalFailure") {
        await mkdir(harnessCaptures, { recursive: true });
        await page.screenshot({
          path: resolve(
            harnessCaptures,
            `goal-failed-${test.info().project.name}-${width}-${theme}.png`,
          ),
          animations: "disabled",
        });
        const recheck = page.getByRole("button", { name: "Recheck final acceptance", exact: true });
        await recheck.focus();
        await page.keyboard.press("Enter");
        await expect(finalAcceptance(page, "Queued")).toBeVisible();
        expect(
          await page.evaluate(
            () =>
              (window as any).taskFixtureCalls.filter(
                (call: any) => call.args.method === "goals.final-review.recheck",
              ).length,
          ),
        ).toBe(1);
      }
      await mkdir(harnessCaptures, { recursive: true });
      await page.screenshot({
        path: resolve(
          harnessCaptures,
          `goal-pending-${state}-${test.info().project.name}-${width}-${theme}.png`,
        ),
        animations: "disabled",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`acceptance evidence stays inspectable at ${width}px in ${theme} theme`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?boardControls&acceptanceEvidence`);
      await page.evaluate(
        (selected) =>
          document.documentElement.classList.toggle("theme-light", selected === "light"),
        theme,
      );
      // Click the title: the card's centre can land on its status button, which opens the
      // failure dialog instead of the detail panel when the text wraps differently.
      await page
        .getByRole("article", { name: "Completed task", exact: true })
        .getByRole("heading", { name: "Completed task", exact: true })
        .click();
      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      await expect(details).toBeVisible();
      const summary = details.locator("summary").filter({ hasText: "Acceptance evidence" });
      await expect(summary).toContainText("1/2 verified");
      await expect(summary).toContainText("1 unresolved");
      const evidence = summary.locator("..");
      await expect(evidence).not.toHaveAttribute("open", "");
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(evidence).toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
      await expect(evidence.locator('[data-acceptance-verdict="verified"]')).toHaveCount(1);
      await expect(evidence.locator('[data-acceptance-verdict="unresolved"]')).toHaveCount(1);
      await expect(evidence).toContainText("Physical-device acceptance has not been performed.");
      const help = evidence.getByRole("button", { name: "Help", exact: true });
      await help.click();
      await expect(page.getByRole("dialog", { name: "Help", exact: true })).toContainText(
        "Recorded reviewer evidence. Files may have changed since this review.",
      );
      await help.click();
      await expect(evidence.locator("time")).toHaveAttribute(
        "datetime",
        "2026-10-24T09:30:00.000Z",
      );
      await expect(
        evidence.getByRole("button", { name: "Open review session", exact: true }),
      ).toBeVisible();
      await expect(evidence).toContainText("javascript:window.acceptanceEvidenceExecuted=true");
      await expect(evidence).toContainText('<img src="invalid"');
      await expect(evidence.locator("a, script, img")).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { acceptanceEvidenceExecuted?: boolean })
              .acceptanceEvidenceExecuted,
        ),
      ).toBeUndefined();
      expect(await evidence.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await details.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const bounds = await details.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      const captures = resolve("temp/verification/2026-10-24-task-evidence");
      await mkdir(captures, { recursive: true });
      await evidence.locator('[data-acceptance-verdict="unresolved"]').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(
          captures,
          `acceptance-evidence-${testInfo.project.name}-${width}-${theme}.png`,
        ),
        animations: "disabled",
      });
      await summary.focus();
      await page.keyboard.press("Space");
      await expect(evidence).not.toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
    });
  }
}

test("bulk cleanup uses one confirmation, preserves code and retries only failed deletions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await openTasks(page, `${fixture}?boardControls&bulk&bulkFailure`);
  await page.getByRole("button", { name: "More actions", exact: true }).first().click();
  await page.getByRole("menuitemcheckbox", { name: "Select tasks", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select all results", exact: true }).check();
  await expect(page.getByText("102 selected", { exact: true })).toBeVisible();
  const actions = page.getByRole("region", { name: "Selected task actions" });
  await actions.getByRole("button", { name: /^Delete\b/ }).click();
  const confirm = page.getByRole("dialog", { name: "Delete selected tasks", exact: true });
  await expect(confirm).toContainText("100 are eligible");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(actions).toContainText("99 succeeded, 2 skipped, 1 failed");
  await actions.getByRole("button", { name: /^Repeat on failed tasks/ }).click();
  await page
    .getByRole("dialog", { name: "Delete selected tasks", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(actions).toContainText("1 succeeded, 0 skipped, 0 failed");
  const calls = await page.evaluate(() =>
    (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls.filter(
      (call) => call.args.method === "tasks.delete",
    ),
  );
  expect(calls).toHaveLength(101);
  const ids = calls.map((call) => (call.args.params as { taskId?: string }).taskId);
  expect(ids.filter((id) => id === "bulk-42")).toHaveLength(2);
  expect(ids).not.toContain("protected");
  expect(ids).not.toContain("active");
  await expect(
    page.getByRole("button", { name: "Protected unmerged work", exact: true }),
  ).toBeVisible();
});

test("search-scoped selection never includes hidden tasks", async ({ page }) => {
  await openTasks(page, `${fixture}?boardControls&bulk`);
  await page.getByRole("searchbox", { name: "Search tasks", exact: true }).fill("Cleanup task 99");
  await page.getByRole("button", { name: "More actions", exact: true }).first().click();
  await page.getByRole("menuitemcheckbox", { name: "Select tasks", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select all results", exact: true }).check();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search tasks", exact: true }).fill("Protected");
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
});

test("compact goal filters retain scope, reset and keyboard menu focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTasks(page, `${fixture}?boardControls&uiFilters`);
  const filters = page.getByRole("button", { name: "Filter", exact: true });
  await filters.focus();
  await page.keyboard.press("Enter");
  const popover = page.getByRole("dialog", { name: "Filter", exact: true });
  await choose(page, popover.getByRole("button", { name: /^Show epic:/ }), "Settings goal");
  await expect(filters).toHaveAttribute("aria-expanded", "true");
  await expect(filters.locator("..")).toHaveAttribute("data-filter-active", "");
  await expect(page.getByRole("article", { name: "Independent task", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(filters.locator("..")).not.toHaveAttribute("data-filter-active", "");
  await openFilter(page);
  await expect(page.getByRole("article", { name: "Independent task", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Epic planned task", exact: true })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await expect(filters).toBeFocused();
  const deliveryMenu = page
    .getByRole("article", { name: "Completed task", exact: true })
    .getByRole("button", { name: "More actions", exact: true });
  await deliveryMenu.focus();
  await page.keyboard.press("Enter");
  const delivery = page.getByRole("menuitem", { name: "Choose delivery target", exact: true });
  await delivery.focus();
  await expect(delivery).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deliveryMenu).toBeFocused();
});

for (const width of [390, 768, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`existing goal settings at ${width}px in ${theme} theme`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?boardControls&renewedApprovalSettings`);
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("theme-light", theme === "light"),
        theme,
      );
      const edit = await openEpicSettings(page);
      const form = formDialog(page, "Edit epic settings");
      await expect(form).toBeVisible();
      await form.getByRole("button", { name: "About epic settings" }).click();
      await expect(page.getByText(/Applies to existing unfinished tasks/)).toBeVisible();
      await page.keyboard.press("Escape");
      await openOptions(form);
      await form
        .getByRole("spinbutton", { name: "Concurrent tasks in this epic", exact: true })
        .fill("3");
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
    const settings = kind === "task" ? await openWorkspace(page, form) : form;
    if (kind === "goal") await openOptions(form);
    const mode = settings.getByRole("button", { name: /^Execution mode:/ });
    await expect(mode).toHaveAccessibleName("Execution mode: Automatic");
    await choose(page, mode, "Separate worktree");
    await expect(mode).toHaveAccessibleName("Execution mode: Separate worktree");
    await choose(page, mode, "Shared checkout");
    await expect(mode).toHaveAccessibleName("Execution mode: Shared checkout");
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
    await form.getByRole("button", { name: /^Claude Code/ }).click();
    const settings = page.getByRole("dialog", { name: "Model and settings", exact: true });
    await expect(settings).toBeVisible();
    // A normal click checks hit testing: a panel behind the modal cannot receive it.
    const demo = settings.getByRole("option", { name: /Demo agent/ });
    await demo.click();
    await expect(demo).toHaveAttribute("aria-selected", "true");
    // The panel stays open after a pick; Escape closes it without closing the dialog.
    await expect(settings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    await expect(form).toBeVisible();
    await openOptions(form);
    await form.getByRole("button", { name: /^Time limit:/ }).click();
    await page.getByRole("option", { name: "No limit", exact: true }).click();
    await expect(form).toBeVisible();
  });
}

test("goal dialog keeps workspace, manual start and concurrency choices together", async ({
  page,
}, testInfo) => {
  const form = await start(page, "goal");
  const dialog = page.getByRole("dialog", { name: "New epic", exact: true });
  await expect(dialog).toBeVisible();
  await fillGoal(form);
  await openOptions(form);
  await form.getByRole("switch", { name: "Start planned tasks manually" }).click();
  await form
    .getByRole("spinbutton", { name: "Concurrent tasks in this epic", exact: true })
    .fill("3");
  const workspace = await openWorkspace(page, form);
  await workspace
    .getByRole("textbox", { name: "New integration branch", exact: true })
    .fill("goal/settings");
  await expect(form.getByRole("button", { name: "Plan it", exact: true })).toBeDisabled();
  await workspace.getByRole("button", { name: "Create a separate worktree", exact: true }).click();
  await expect(workspaceChip(form)).toContainText("goal/settings");
  await page.keyboard.press("Escape");
  const screenshots = resolve("temp/verification/2026-10-16-ui-system/W4b-TASKS-captures");
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
  await openTasks(page, `${fixture}?boardControls`);
  const queued = page.locator('[data-task-column="queued"]');
  const first = queued.getByRole("article", { name: "First queued task", exact: true });
  const second = queued.getByRole("article", { name: "Second queued task", exact: true });
  await expect(first).toBeVisible();
  await second.dragTo(first, {
    sourcePosition: { x: 10, y: 10 },
    targetPosition: { x: 10, y: 10 },
  });
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
  await taskMenuAction(
    page,
    page.getByRole("article", { name: "Completed task", exact: true }),
    "Choose delivery target",
  );
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
  await openTasks(page, `${fixture}?boardControls&goalTasks`);
  await taskMenuAction(
    page,
    page.getByRole("article", { name: "Settings goal", exact: true }),
    "Task sessions",
  );
  const dialog = page.getByRole("dialog", { name: "Task sessions", exact: true });
  await expect(dialog).toContainText("Session will appear when this task starts.");
  await dialog.getByRole("button", { name: /^Open worker session/ }).click();
  await page.getByRole("button", { name: "Open in Sessions", exact: true }).click();
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
/** Open optional form settings while retaining the current draft. */
async function openOptions(form: Locator) {
  const summary = form.locator("summary").filter({ hasText: /^More options/ });
  if (!(await summary.locator("..").evaluate((node: HTMLDetailsElement) => node.open)))
    await summary.click();
}

const workspaceChip = (form: Locator) =>
  form.getByRole("button", { name: /^Workspace(?:[:· ]|$)/ });

async function openWorkspace(page: Page, form: Locator) {
  await workspaceChip(form).click();
  const popup = page.getByRole("dialog", { name: "Workspace", exact: true });
  await expect(popup).toBeVisible();
  return popup;
}

const reviewerRow = (page: Page, form: Locator) =>
  form.locator(".task-form-row").filter({ has: page.getByText("Reviewer", { exact: true }) });

async function openDetailDisclosure(detail: Locator) {
  await detail
    .locator("summary")
    .filter({ hasText: /^Details$/ })
    .click();
}

async function openEpicSettings(page: Page) {
  const epic = page.getByRole("article", { name: "Settings goal", exact: true });
  const edit = epic.getByRole("button", { name: "More actions", exact: true });
  await taskMenuAction(page, epic, "Edit");
  return edit;
}
async function choose(page: Page, trigger: Locator, name: string) {
  await trigger.click();
  await page.getByRole("option", { name, exact: true }).click();
}
async function taskMenuAction(page: Page, card: Locator, name: string) {
  await card.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function mutations(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { taskFixtureCalls: HostCall[] }).taskFixtureCalls.filter(
      (call) => call.args.method === "tasks.save" || call.args.method === "goals.create",
    ),
  );
}
async function openCreate(page: Page, kind: "task" | "goal") {
  if (kind === "goal") {
    await page.getByRole("button", { name: "More creation options", exact: true }).click();
    await page.getByRole("menuitem", { name: "New epic", exact: true }).click();
  } else await page.getByRole("button", { name: "New task", exact: true }).click();
}
async function start(page: Page, kind: "task" | "goal", query = "") {
  await openTasks(page, fixture + query);
  await expect(page.getByRole("region", { name: "Tasks", exact: true })).toBeVisible();
  await openCreate(page, kind);
  return formDialog(page, `New ${kind === "goal" ? "epic" : "task"}`);
}
async function fillTask(form: Locator) {
  await form
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Run on the selected computer");
  await form
    .getByRole("combobox", { name: "Description", exact: true })
    .fill("Finish the fixture task without stopping.");
}
async function fillGoal(form: Locator) {
  await form
    .getByRole("textbox", { name: "Epic title", exact: true })
    .fill("Finish the selected projects");
  await form
    .getByRole("textbox", { name: "Objective", exact: true })
    .fill("Plan and complete the selected projects on this machine.");
}

test("a task defaults locally from a remote workspace and saves on the local host", async ({
  page,
}) => {
  const form = await start(page, "task");
  await expect(machine(form)).toHaveAccessibleName("Machine: This computer");
  await expect(form.getByRole("textbox", { name: "Task title", exact: true })).toBeEmpty();
  await form
    .getByRole("combobox", { name: "Description", exact: true })
    .fill("Finish the fixture task without stopping.");
  await form.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(() => mutations(page)).toHaveLength(1);
  expect((await mutations(page))[0].args).toMatchObject({
    machineId: "machine-local",
    method: "tasks.save",
    params: {
      task: {
        projectId: "local-project",
        status: "queued",
        title: "Finish the fixture task without stopping.",
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
  await expect(machine(form)).toHaveAccessibleName("Machine: Demo MacBook");
  await fillTask(form);
  await form.getByRole("button", { name: "Start", exact: true }).click();
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
  await expect(form.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await expect(form.getByRole("button", { name: "Add to To do", exact: true })).toBeDisabled();
  expect(await mutations(page)).toEqual([]);
  await choose(page, machine(form), "Demo MacBook");
  await choose(page, project(form), "remote-api");
  await form.getByRole("button", { name: "Start", exact: true }).click();
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
  await form.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(form.getByRole("alert")).toHaveCount(0);
  await choose(page, project(form), "remote-api");
  await expect(form.locator("[data-goal-project]")).toHaveCount(1);
});

test("task and goal controls stay inside a narrow viewport", async ({ page }, testInfo) => {
  const screenshots = resolve("temp/verification/2026-10-16-ui-system/W4b-TASKS-captures");
  await mkdir(screenshots, { recursive: true });
  for (const width of [320, 480]) {
    await page.setViewportSize({ width, height: 900 });
    for (const kind of ["task", "goal"] as const) {
      await openTasks(page, fixture);
      await expect(page.getByRole("region", { name: "Tasks", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeEnabled();
      await expect(page.getByText("No task board", { exact: true })).toHaveCount(0);
      for (const label of ["More actions", "New task", "More creation options"]) {
        const control = page.getByRole("button", { name: label, exact: true });
        await expect(control).toBeVisible();
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      await openCreate(page, kind);
      const form = formDialog(page, `New ${kind === "goal" ? "epic" : "task"}`);
      await expect(machine(form)).toBeVisible();
      const title = form.getByRole("textbox", {
        name: kind === "task" ? "Task title" : "Epic title",
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
  const screenshots = resolve("temp/verification/2026-10-16-ui-system/W4b-TASKS-captures");
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
    // The backlog opens as a list; the board is an explicit view choice.
    await page.getByRole("radio", { name: "Board view", exact: true }).check();
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
    await openTasks(page, `${fixture}?slowRemote=${method}&changes`);
    await expect(page.locator('[data-remote-data-state="refreshing"]')).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tasks", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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
    const form = formDialog(page, "New task");
    await expect(project(form)).toHaveAccessibleName("Project: local-project");
    await fillTask(form);
    await form.getByRole("button", { name: "Add to To do", exact: true }).click();
    await expect.poll(() => mutations(page)).toHaveLength(1);
    expect((await mutations(page))[0].args).toMatchObject({
      machineId: "machine-local",
      method: "tasks.save",
      params: { task: { projectId: "local-project", status: "todo" } },
    });
    await expect(form).toHaveCount(0);
    await page.getByRole("radio", { name: "Board view", exact: true }).check();
    const localCard = page.getByRole("article", {
      name: "Run on the selected computer",
      exact: true,
    });
    await expect(localCard).toBeVisible();
    await taskMenuAction(page, localCard, "Delete");
    const confirmation = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "Delete task", exact: true }) });
    await expect(confirmation).toContainText("Run on the selected computer");
    await expect(localCard).toHaveCount(1);
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
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
  const screenshots = resolve("temp/verification/2026-10-16-ui-system/W4b-TASKS-captures");
  await mkdir(screenshots, { recursive: true });
  for (const host of ["local", "remote"]) {
    await page.setViewportSize({
      width: host === "local" ? 320 : 1000,
      height: 900,
    });
    await openTasks(page, `${fixture}?sessionLinks=${host}`);
    const taskCard = page.getByRole("article", {
      name: "Session-linked task",
      exact: true,
    });
    await expect(taskCard).toBeVisible();
    await taskMenuAction(page, taskCard, "Open worker session");
    await page.getByRole("button", { name: "Open in Sessions", exact: true }).click();
    await taskMenuAction(page, taskCard, "Open review session");
    await page.getByRole("button", { name: "Open in Sessions", exact: true }).click();
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
    await expect(history.getByRole("button", { name: /^Open worker session/ })).toBeVisible();
    await expect(
      history.getByRole("button", { name: "Open review session", exact: true }),
    ).toBeVisible();
    await history.getByRole("button", { name: /^Open worker session/ }).click();
    await page.getByRole("button", { name: "Open in Sessions", exact: true }).click();
    await history.getByRole("button", { name: "Open review session", exact: true }).click();
    await page.getByRole("button", { name: "Open in Sessions", exact: true }).click();
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

for (const width of [390, 768, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`redesigned task board previews and secondary actions at ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?boardControls&uiFilters`);
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("theme-light", theme === "light"),
        theme,
      );
      const complete = page.getByRole("article", { name: "Completed task", exact: true });
      await complete.scrollIntoViewIfNeeded();
      const actions = complete.getByRole("button", { name: "More actions", exact: true });
      await actions.click();
      await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(actions).toBeFocused();
      await complete.locator("button[data-task-status-line]").click();
      const error = page.getByRole("dialog", { name: "Task details", exact: true });
      await expect(error).toContainText("The project has uncommitted changes.");
      await page.keyboard.press("Escape");
      await taskMenuAction(page, complete, "Open worker session");
      const sheet = page.getByRole("dialog", { name: "Preview completed-worker", exact: true });
      await expect(sheet).toContainText("Task transcript preview on its original host.");
      await expect(
        sheet.getByRole("button", { name: "Open in Sessions", exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => (window as any).taskFixtureOpenedSessions)).toEqual([]);
      const box = (await sheet.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({
        animations: "disabled",
        path: resolve("temp/verification/2026-10-18-tasks-redesign", `sheet-${width}-${theme}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(actions).toBeFocused();
      await page.screenshot({
        animations: "disabled",
        path: resolve("temp/verification/2026-10-18-tasks-redesign", `board-${width}-${theme}.png`),
      });
    });
  }
}

test("compact task form keeps advanced choices and long instructions manageable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const form = await start(page, "task");
  const advanced = form
    .locator("summary")
    .filter({ hasText: /^More options/ })
    .locator("..");
  await expect(advanced).not.toHaveAttribute("open", "");
  await machine(form).click();
  await expect(page.getByRole("option", { name: "Demo MacBook", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(machine(form)).toBeFocused();
  await fillTask(form);
  await form
    .getByRole("combobox", { name: "Description", exact: true })
    .fill("Detailed instructions and acceptance criteria.\n".repeat(80));
  const prompt = (await form
    .getByRole("combobox", { name: "Description", exact: true })
    .boundingBox())!;
  expect(prompt.height).toBeLessThanOrEqual(225);
  await expect(form.getByRole("button", { name: "Add to To do", exact: true })).toBeVisible();
  await page.screenshot({
    path: resolve("temp/verification/2026-10-18-tasks-redesign/form-390-dark.png"),
    animations: "disabled",
  });
  await openOptions(form);
  await expect(form.getByRole("textbox", { name: "Check command", exact: true })).toBeVisible();
  const workspace = await openWorkspace(page, form);
  await expect(workspace.getByRole("button", { name: /^Execution mode:/ })).toBeVisible();
  await choose(page, workspace.getByRole("button", { name: /^Base branch:/ }), "main");
  await expect(workspace.getByRole("button", { name: /^Base branch:/ })).toContainText("main");
});

for (const width of [1280, 800]) {
  for (const theme of ["light", "dark"]) {
    test(`inherited execution mode fits task and goal forms at ${width}px ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 1000 });
      await mkdir("temp/verification/d1", { recursive: true });
      for (const kind of ["task", "goal"] as const) {
        const form = await start(page, kind);
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        const settings = kind === "task" ? await openWorkspace(page, form) : form;
        if (kind === "goal") await openOptions(form);
        const mode = settings.getByRole("button", {
          name: "Execution mode: Automatic",
          exact: true,
        });
        await expect(mode).toBeVisible();
        await mode.scrollIntoViewIfNeeded();
        const bounds = (await mode.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `temp/verification/d1/${kind}-execution-${theme}-${width}-${testInfo.project.name}.png`,
          animations: "disabled",
        });
        if (kind === "task") {
          await page.keyboard.press("Escape");
          await openOptions(form);
          const rows = form
            .locator(".task-form-rows")
            .filter({ has: page.getByRole("textbox", { name: "Check command", exact: true }) });
          await rows.scrollIntoViewIfNeeded();
          await expect(rows).toBeVisible();
          await expect(rows.locator(":scope > *").first()).toHaveCSS("border-bottom-width", "1px");
          await expect(rows.locator(":scope > *").last()).toHaveCSS("border-bottom-width", "0px");
          await page.screenshot({
            path: `temp/verification/task-surfaces/agent-settings-${theme}-${width}.png`,
          });
        }
      }
    });
  }
}

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`goal and empty visual states ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?boardControls`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await mkdir("temp/verification/task-goal-empty-visual", { recursive: true });
      await expect(page.getByRole("region", { name: "Epics", exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/task-goal-empty-visual/${theme}-${width}-goal.png`,
        animations: "disabled",
      });
      await page.getByRole("searchbox", { name: "Search tasks" }).fill("fixture-no-such-task-3927");
      await expect(page.getByText("No tasks match your search or filters.")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/task-goal-empty-visual/${theme}-${width}-empty.png`,
        animations: "disabled",
      });
    });
  }

for (const width of [800, 1280]) {
  for (const theme of ["light", "dark"]) {
    test(`shared task drag cues and detail frame ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?boardControls`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const queued = page.locator('[data-task-column="queued"]');
      const first = queued.getByRole("article", { name: "First queued task", exact: true });
      const second = queued.getByRole("article", { name: "Second queued task", exact: true });
      await expect(first).toBeVisible();
      await expect(first).toHaveCSS("border-top-left-radius", "6px");
      const firstRow = first.locator("..");
      const secondRow = second.locator("..");
      await expect(secondRow).toHaveCSS("cursor", "grab");
      await page.mouse.move(width - 3, 3);
      await expect(second.locator(".task-drag-grip")).toHaveCSS("opacity", "0");
      await second.hover();
      await expect(second.locator(".task-drag-grip")).toHaveCSS("opacity", "1");
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await secondRow.dispatchEvent("dragstart", { dataTransfer: transfer });
      await queued.dispatchEvent("dragover", { dataTransfer: transfer });
      await firstRow.dispatchEvent("dragover", { dataTransfer: transfer });
      await expect(queued).toHaveCSS("outline-style", "solid");
      const selectedFill = await queued.evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.background = "var(--ui-surface-selected)";
        node.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      });
      await expect(queued).toHaveCSS("background-color", selectedFill);
      await expect(second).toHaveCSS("outline-style", "dashed");
      expect(await firstRow.evaluate((node) => getComputedStyle(node, "::before").height)).toBe(
        "3px",
      );
      await mkdir("temp/verification/task-surfaces", { recursive: true });
      await page.screenshot({ path: `temp/verification/task-surfaces/drag-${theme}-${width}.png` });
      await firstRow.dispatchEvent("drop", { dataTransfer: transfer });
      await secondRow.dispatchEvent("dragend", { dataTransfer: transfer });
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
      await expect(queued).toHaveCSS("outline-style", "none");
      await first.click();
      const detail = page.getByRole("complementary", { name: "Task details", exact: true });
      await expect(detail).toBeVisible();
      await expect(detail).toHaveCSS("border-inline-start-width", "1px");
      await page.screenshot({
        path: `temp/verification/task-surfaces/detail-wide-${theme}-${width}.png`,
      });
      const identity = await detail.getAttribute("aria-label");
      const area = page.locator('[class*="@container/task-area"]');
      await area.evaluate((node: HTMLElement) => {
        node.style.flex = "0 0 600px";
        node.style.width = "600px";
      });
      await expect(detail).toHaveCSS("border-inline-start-width", "0px");
      await expect(detail).toHaveCSS("border-block-start-width", "0px");
      expect(await detail.getAttribute("aria-label")).toBe(identity);
      expect((await detail.boundingBox())!.width).toBe(600);
      await page.screenshot({
        path: `temp/verification/task-surfaces/detail-stacked-${theme}-${width}.png`,
      });
    });
  }
}

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`shared goal session separators ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openTasks(page, `${fixture}?boardControls&goalTasks`);
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await taskMenuAction(
        page,
        page.getByRole("article", { name: "Settings goal", exact: true }),
        "Task sessions",
      );
      const dialog = page.getByRole("dialog", { name: "Task sessions", exact: true });
      const rows = dialog.locator(".goal-session-task");
      await expect(rows).toHaveCount(3);
      await expect(rows.first()).toHaveCSS("border-bottom-width", "1px");
      await expect(rows.last()).toHaveCSS("border-bottom-width", "0px");
      await expect(dialog.getByRole("button", { name: /^Open worker session/ })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/task-surfaces/goal-sessions-${theme}-${width}.png`,
      });
    });
  }
