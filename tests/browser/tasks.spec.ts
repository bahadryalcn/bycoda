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
        const form = page.getByRole("form", { name: `New ${kind}`, exact: true });
        if (kind === "task")
          await form.getByRole("button", { name: "Agent settings", exact: true }).click();
        const preference = form.getByRole("checkbox", { name: /^Merge automatically/ });
        await expect(preference).toBeDisabled();
        await preference.scrollIntoViewIfNeeded();
        await expect(form).toContainText("Review changes to renew approval");
        await page.screenshot({
          path: `temp/verification/s5/${kind}-suspended-merge-${width}-${theme}.png`,
          animations: "disabled",
        });
        await form.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      await page.getByRole("button", { name: "Edit goal settings", exact: true }).click();
      const settings = page.getByRole("form", { name: "Edit goal settings", exact: true });
      await expect(settings).toContainText("Delivery requires approval");
      const existing = settings.getByRole("checkbox", { name: /^Merge automatically/ });
      await expect(existing).toBeChecked();
      await existing.focus();
      await page.keyboard.press("Space");
      await expect(existing).not.toBeChecked();
      await expect(existing).toBeDisabled();
      await page.screenshot({
        path: `temp/verification/s5/goal-settings-suspended-merge-${width}-${theme}.png`,
        animations: "disabled",
      });
      await settings.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "More actions", exact: true }).first().click();
      await page.getByRole("menuitemcheckbox", { name: "Stewards", exact: true }).click();
      await page.getByRole("button", { name: "Add steward", exact: true }).click();
      const steward = page.getByRole("form", { name: "New steward", exact: true });
      const preference = steward.getByRole("checkbox", { name: /^Merge automatically/ });
      await expect(preference).toBeDisabled();
      await preference.evaluate((node) =>
        node.closest("label")?.scrollIntoView({ block: "center" }),
      );
      const section = page.getByRole("region", { name: "Stewards", exact: true });
      await section.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
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
      await expect(
        page.getByRole("complementary", { name: "Task details", exact: true }),
      ).toContainText("Not delivered");
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
      await expect(task.locator("[data-task-completion]")).toHaveText("Implementation finished");
      await expect(task.locator("[data-task-delivery]")).toHaveText("Not delivered");
      await expect(task.locator("[data-task-renewed-approval]")).toContainText("renew approval");
      await expect(task.getByRole("button", { name: "Review changes", exact: true })).toBeVisible();
      await mkdir("temp/verification/s5", { recursive: true });
      await task.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/s5/tasks-delivery-${width}-${theme}.png`,
        animations: "disabled",
      });
      await task.click();
      const details = page.getByRole("complementary", { name: "Task details", exact: true });
      await expect(details).toContainText("Completion");
      await expect(details).toContainText("Not delivered");
      await page.screenshot({
        path: `temp/verification/s5/task-detail-delivery-${width}-${theme}.png`,
        animations: "disabled",
      });
      await details.getByRole("button", { name: "Mark finished", exact: true }).click();
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
/** Legacy workflow checks explicitly choose the global board; the product now opens a project backlog. */
async function openTasks(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("radio", { name: "Sprints", exact: true }).click();
  const projectScope = page
    .locator("header.task-board-toolbar")
    .getByRole("button", { name: /^Project:/ });
  await projectScope.click();
  await page.getByRole("option", { name: "All projects", exact: true }).click();
  const goals = page.locator("details.task-goals-disclosure");
  if (await goals.count()) await goals.locator("summary").first().click();
}
test("worktree creation keeps the active button visible and focused", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const form = await start(page, "goal", "?slowOperation=git.worktreeCreate");
  await fillGoal(form);
  const workspaceDisclosure = form
    .locator("summary")
    .filter({ hasText: "Working branch and worktree" });
  await workspaceDisclosure.focus();
  await workspaceDisclosure.press("Enter");
  const branch = form.getByPlaceholder("goal/settings", { exact: true });
  await branch.fill("ui-feedback");
  const create = form.getByRole("button", { name: "Create a separate worktree", exact: true });
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
        name: kind === "task" ? "Add and start" : "Plan it",
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
    await form.getByRole("textbox", { name: "Description", exact: true }).fill(objective);
    const summary = form.locator("summary").filter({ hasText: /^Workflow and preparation$/ });
    await summary.focus();
    await page.keyboard.press("Enter");
    await choose(page, form.getByRole("button", { name: /^Workflow:/ }), "Source research");
    await form.getByRole("button", { name: "Apply workflow", exact: true }).click();
    const applied = JSON.parse(
      await form.getByRole("textbox", { name: "Description", exact: true }).inputValue(),
    );
    expect(applied.objective).toBe(objective);
    expect(applied.acceptance).toContain(
      "Factual claims are checked against opened primary sources",
    );
    await form.getByRole("button", { name: "Agent settings", exact: true }).click();
    const reviewer = form
      .locator("details")
      .filter({ has: page.locator("summary").filter({ hasText: /^Reviewer profile$/ }) });
    await reviewer.locator("summary").click();
    await reviewer
      .getByRole("checkbox", { name: "Use a separate reviewer profile", exact: true })
      .check();
    const reviewerInstructions = "Check every source and preserve unresolved acceptance evidence.";
    await reviewer
      .getByRole("textbox", { name: "Reviewer instructions", exact: true })
      .fill(reviewerInstructions);
    await reviewer.getByRole("button", { name: /^Claude Code/ }).click();
    await page
      .getByRole("menu", { name: "Model and settings", exact: true })
      .getByRole("menuitem", { name: /^(Effort|Reasoning)/ })
      .click();
    await page.getByRole("menuitemradio", { name: "High", exact: true }).click();
    await form
      .locator("summary")
      .filter({ hasText: /^Required resources/ })
      .click();
    await form.getByRole("button", { name: "Add resource", exact: true }).click();
    await form
      .getByRole("textbox", { name: "Resource reference", exact: true })
      .fill("sources/report.md");
    await form.getByRole("button", { name: "Check preparation", exact: true }).click();
    await expect(form).toContainText("Checked by the in-memory fixture");
    expect(await mutations(page)).toHaveLength(0);
    await form.getByRole("textbox", { name: "Workflow name", exact: true }).fill("My checked flow");
    await form.getByRole("button", { name: "Save workflow", exact: true }).click();
    await expect(form).toContainText("Workflow saved for this project.");
    await form
      .locator("summary")
      .filter({ hasText: /^Total run budget$/ })
      .click();
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
    const reopened = page.getByRole("form", { name: "New task", exact: true });
    await reopened
      .locator("summary")
      .filter({ hasText: /^Workflow and preparation$/ })
      .click();
    await choose(page, reopened.getByRole("button", { name: /^Workflow:/ }), "My checked flow");
    await reopened.getByRole("button", { name: "Apply workflow", exact: true }).click();
    const restored = JSON.parse(
      await reopened.getByRole("textbox", { name: "Description", exact: true }).inputValue(),
    );
    expect(restored.acceptance).toContain(
      "Factual claims are checked against opened primary sources",
    );
    await reopened.getByRole("button", { name: "Agent settings", exact: true }).click();
    const restoredReviewer = reopened
      .locator("details")
      .filter({ has: page.locator("summary").filter({ hasText: /^Reviewer profile$/ }) });
    await restoredReviewer.locator("summary").click();
    await expect(
      restoredReviewer.getByRole("checkbox", {
        name: "Use a separate reviewer profile",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      restoredReviewer.getByRole("textbox", { name: "Reviewer instructions", exact: true }),
    ).toHaveValue(reviewerInstructions);
    await expect(
      restoredReviewer.getByRole("button", { name: /^Claude Code/ }),
    ).toHaveAccessibleName(/effort High/);
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
    await expect(comparison).toContainText("claude · claude:fixture");
    await expect(comparison).toContainText("not a controlled model benchmark");
    await expect(comparison).toContainText("2.5");
    expect(await comparison.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await mkdir(harnessCaptures, { recursive: true });
    await page.screenshot({
      path: resolve(harnessCaptures, `quality-${testInfo.project.name}-${width}-${theme}.png`),
      animations: "disabled",
    });
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
  const form = page.getByRole("form", { name: "Edit task", exact: true });
  await form.getByRole("button", { name: "Agent settings", exact: true }).click();
  const reviewer = form
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: /^Reviewer profile$/ }) });
  await reviewer.locator("summary").click();
  const separate = reviewer.getByRole("checkbox", {
    name: "Use a separate reviewer profile",
    exact: true,
  });
  await expect(separate).toBeChecked();
  await expect(
    reviewer.getByRole("textbox", { name: "Reviewer instructions", exact: true }),
  ).toHaveValue("Stored custom reviewer instructions.");
  await separate.uncheck();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(() => mutations(page)).toHaveLength(1);
  expect((await mutations(page))[0].args.params!.task).toMatchObject({
    id: "first",
    review: true,
    reviewerConfig: null,
  });
  await taskMenuAction(page, card, "Edit");
  await form.getByRole("button", { name: "Agent settings", exact: true }).click();
  await reviewer.locator("summary").click();
  await expect(separate).not.toBeChecked();
  await expect(
    reviewer.getByRole("textbox", { name: "Reviewer instructions", exact: true }),
  ).toHaveCount(0);
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
        page.getByText(`Final goal acceptance: ${state === "finalFailure" ? "Failed" : "Queued"}`, {
          exact: true,
        }),
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
        await expect(
          page.getByText("Final goal acceptance: Queued", { exact: true }),
        ).toBeVisible();
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
      await page.getByRole("article", { name: "Completed task", exact: true }).click();
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
      await expect(evidence).toContainText(
        "Recorded reviewer evidence. Files may have changed since this review.",
      );
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
  await page.getByRole("button", { name: "Select tasks", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select all results", exact: true }).check();
  await expect(page.getByText("102 selected", { exact: true })).toBeVisible();
  const actions = page.getByRole("region", { name: "Selected task actions" });
  await actions.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete selected tasks", exact: true });
  await expect(confirm).toContainText("100 are eligible");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(actions).toContainText("99 succeeded, 2 skipped, 1 failed");
  await actions.getByRole("button", { name: "Retry failed tasks", exact: true }).click();
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
  await page.getByRole("button", { name: "Select tasks", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select all results", exact: true }).check();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search tasks", exact: true }).fill("Protected");
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
});

test("compact goal filters retain scope, reset and keyboard menu focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTasks(page, `${fixture}?boardControls&uiFilters`);
  const filters = page.getByRole("button", { name: "Filters", exact: true });
  await filters.focus();
  await page.keyboard.press("Enter");
  const popover = page.getByRole("dialog", { name: "Filters", exact: true });
  await choose(page, popover.getByRole("button", { name: /^Show goal:/ }), "Settings goal");
  await expect(filters).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article", { name: "Independent task", exact: true })).toHaveCount(0);
  await popover.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(filters).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("article", { name: "Independent task", exact: true })).toBeVisible();
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
      const edit = page.getByRole("button", { name: "Edit goal settings", exact: true });
      await edit.click();
      const form = page.getByRole("form", { name: "Edit goal settings", exact: true });
      await expect(form).toBeVisible();
      await expect(form).toContainText("Applies to existing unfinished tasks.");
      const merge = form.getByRole("checkbox", { name: /^Merge automatically/ });
      await merge.focus();
      await page.keyboard.press("Space");
      await expect(merge).not.toBeChecked();
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
          settings: { autoMerge: false, maxRunningTasks: 3, maxRunMinutes: 25 },
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
    if (kind === "task")
      await form.locator("summary").filter({ hasText: "Working branch and worktree" }).click();
    expect(
      await form
        .getByRole("radiogroup", { name: "Execution mode", exact: true })
        .evaluate((node) => getComputedStyle(node).borderTopStyle),
    ).toBe("solid");
    await expect(form.getByRole("radio", { name: "Shared checkout", exact: true })).toBeChecked();
    await form.getByRole("radio", { name: "Separate worktree", exact: true }).click();
    await expect(form.getByRole("radio", { name: "Separate worktree", exact: true })).toBeChecked();
    if (kind === "task")
      await form.getByRole("button", { name: "Agent settings", exact: true }).click();
    const merge = form.getByRole("checkbox", { name: /^Merge automatically/ });
    await expect(merge).toBeDisabled();
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
    await form.getByRole("button", { name: /^Claude Code/ }).click();
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
  await form.locator("summary").filter({ hasText: "Working branch and worktree" }).click();
  await form
    .getByRole("textbox", { name: "New integration branch", exact: true })
    .fill("goal/settings");
  await expect(form.getByRole("button", { name: "Plan it", exact: true })).toBeDisabled();
  await form.getByRole("button", { name: "Create a separate worktree", exact: true }).click();
  await expect(form.getByRole("button", { name: /^Worktree:/ })).toContainText("goal/settings");
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
  await openTasks(page, `${fixture}?boardControls`);
  await page
    .getByRole("article", { name: "Settings goal", exact: true })
    .getByRole("button", { name: "Task sessions", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Task sessions", exact: true });
  await expect(dialog).toContainText("Session will appear when this task starts.");
  await dialog.getByRole("button", { name: "Open worker session", exact: true }).click();
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
    await page.getByRole("button", { name: "More actions", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "New goal", exact: true }).click();
  } else await page.getByRole("button", { name: "New task", exact: true }).click();
}
async function start(page: Page, kind: "task" | "goal", query = "") {
  await openTasks(page, fixture + query);
  await expect(page.getByRole("region", { name: "Tasks", exact: true })).toBeVisible();
  await openCreate(page, kind);
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
  const screenshots = resolve("temp/verification/2026-10-16-ui-system/W4b-TASKS-captures");
  await mkdir(screenshots, { recursive: true });
  for (const width of [320, 480]) {
    await page.setViewportSize({ width, height: 900 });
    for (const kind of ["task", "goal"] as const) {
      await openTasks(page, fixture);
      await expect(page.getByRole("region", { name: "Tasks", exact: true })).toBeVisible();
      await expect(
        page
          .locator("header.task-board-toolbar")
          .getByRole("button", { name: "Refresh", exact: true }),
      ).toBeEnabled();
      await expect(page.getByText("No task board", { exact: true })).toHaveCount(0);
      for (const label of ["More actions", "New task"]) {
        const control = page.getByRole("button", { name: label, exact: true });
        await expect(control).toBeVisible();
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      await openCreate(page, kind);
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
    await expect(page.getByRole("radio", { name: "Board view", exact: true })).toBeChecked();
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
    await expect(
      history.getByRole("button", { name: "Open worker session", exact: true }),
    ).toBeVisible();
    await expect(
      history.getByRole("button", { name: "Open review session", exact: true }),
    ).toBeVisible();
    await history.getByRole("button", { name: "Open worker session", exact: true }).click();
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
      await complete.getByRole("button", { name: "Delivery is blocked", exact: true }).click();
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
  const advanced = form.locator("details.task-advanced-options");
  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(form.getByRole("button", { name: "Agent settings", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await machine(form).click();
  await expect(page.getByRole("option", { name: "Demo MacBook", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(machine(form)).toBeFocused();
  await fillTask(form);
  await form
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Detailed instructions and acceptance criteria.\n".repeat(80));
  const prompt = (await form
    .getByRole("textbox", { name: "Description", exact: true })
    .boundingBox())!;
  expect(prompt.height).toBeLessThanOrEqual(225);
  await expect(form.getByRole("button", { name: "Add to To do", exact: true })).toBeVisible();
  await page.screenshot({
    path: resolve("temp/verification/2026-10-18-tasks-redesign/form-390-dark.png"),
    animations: "disabled",
  });
  await advanced.locator("summary").click();
  await expect(form.getByRole("radio", { name: "Shared checkout", exact: true })).toBeVisible();
  await choose(page, form.getByRole("button", { name: /^Base branch:/ }), "main");
  await expect(form.getByRole("button", { name: /^Base branch:/ })).toContainText("main");
});
