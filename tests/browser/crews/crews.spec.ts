import { test, expect, type Page } from "@playwright/test";
const shots = "temp/verification/2026-10-25-crew-management-v2";

for (const theme of ["light", "dark"] as const) {
  for (const width of [800, 1280]) {
    test(`member library collection visual ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/crews/crews.html?groupRetry&theme=${theme}`);
      await openCrewsTab(page, "Members");
      const collection = page.locator(".settings-collection").first();
      await expect(collection).toBeVisible();
      // The library is no longer inside a settings section card, so the collection carries the thin frame itself.
      await expect(collection).toHaveCSS("border-top-width", "1px");
      await expect(collection).toHaveCSS("border-top-left-radius", "6px");
      await collection.screenshot({
        path: `temp/verification/settings-collection-finish/crew-library-${theme}-${width}.png`,
      });
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`rail heading remains readable and independently collapsible ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/tests/browser/crews/crews.html?headingRegression&theme=${theme}`);
      const rail = page.locator("aside").first();
      const heading = rail.getByRole("button", { name: "Open Crews", exact: true });
      const toggle = rail.getByRole("button", { name: "Crews", exact: true });
      await expect(heading).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-11-crew-heading/${theme}-${width}.png`,
      });
      expect(
        await heading.evaluate((button) => {
          const label = button.querySelector("span")!;
          return label.getBoundingClientRect().width;
        }),
      ).toBeGreaterThan(25);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(heading).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await heading.click();
      await expect(page.getByRole("heading", { name: "Crews", exact: true })).toBeVisible();
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`project picker and creation stay compact ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/crews/crews.html?longProjects&theme=${theme}`);
      const management = await openWork(page);
      // Work is shown for the opened project: the project is chosen elsewhere, so neither the
      // work view nor the new task form offers a project picker or project creation.
      const project = (scope: ReturnType<Page["locator"]>) =>
        scope.getByRole("button", { name: /^Project/ });
      await expect(project(management)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New project…", exact: true })).toHaveCount(0);
      expect(await management.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({
        path: `temp/verification/2026-11-11-crew-pickers/picker-${theme}-${width}.png`,
      });
      const start = await openStart(page);
      await expect(project(start)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New project…", exact: true })).toHaveCount(0);
      await expect(start.getByRole("textbox", { name: "Task title", exact: true })).toBeVisible();
    });
  }
}

test("project creation is not offered from the crew work view", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  const management = await openWork(page);
  await expect(management.getByRole("button", { name: /^Project/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New project…", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Create project", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { crewFixtureOperations: string[] }).crewFixtureOperations.filter(
          (method) => method === "projects.createDirectory",
        ).length,
    ),
  ).toBe(0);
});

type CrewsTab = "Teams" | "Members" | "Work";

for (const theme of ["light", "dark"] as const)
  for (const width of [800, 1280]) {
    test(`crew redesign complete forms ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const capture = async (state: string) => {
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await page.screenshot({
          path: `temp/verification/2026-11-14-crews/${state}-${theme}-${width}.png`,
          animations: "disabled",
        });
      };
      await page.goto(`/tests/browser/crews/crews.html?rich&work-model&theme=${theme}`);
      await openCrewsTab(page, "Work");
      await capture("work-tab");
      const content = await openCrewsTab(page, "Teams");
      await capture("teams");
      await content.getByRole("button", { name: "New work", exact: true }).first().click();
      const task = page.getByRole("dialog", { name: "New task", exact: true });
      await expect(task.getByRole("textbox", { name: "Task title", exact: true })).toBeVisible();
      await expect(task.locator(".task-form-body")).toHaveCSS("padding-left", "16px");
      await expect(task.locator("[data-modal-actions]")).toBeVisible();
      await capture("task");
      await task
        .locator("summary")
        .filter({ hasText: /^More options/ })
        .click();
      // Templates are one menu in the footer; applying one never starts work.
      await task.getByRole("button", { name: /^Template/ }).click();
      await expect(page.getByRole("menu", { name: "Template", exact: true })).toBeVisible();
      await capture("task-workflow");
      await page.keyboard.press("Escape");
      await task
        .getByRole("spinbutton", { name: "Agent minutes", exact: true })
        .scrollIntoViewIfNeeded();
      await capture("task-budget");
      await expect(task.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      await task.getByRole("button", { name: "Cancel", exact: true }).click();
      await editCrew(page);
      const editor = crewEditor(page);
      await expect(editor.getByRole("textbox", { name: "Crew name", exact: true })).toBeVisible();
      await capture("editor");
      await editor
        .locator("summary")
        .filter({ hasText: /^More options/ })
        .click();
      await editor
        .locator("summary")
        .filter({ hasText: /^More options/ })
        .scrollIntoViewIfNeeded();
      await capture("editor-more-options");
      await page.keyboard.press("Escape");
      await openCrewsTab(page, "Members");
      await capture("members");
      await page.getByRole("button", { name: "New member", exact: true }).click();
      const member = page.getByRole("dialog", { name: "New library member", exact: true });
      await capture("member");
      await member
        .locator("summary")
        .filter({ hasText: /^More options/ })
        .click();
      const custom = member.getByRole("radio", { name: "Custom", exact: true });
      await custom.focus();
      await custom.press("Space");
      await member.getByRole("button", { name: /^Host tools:/ }).scrollIntoViewIfNeeded();
      // The profile's description sits behind its info button, not inline.
      await member.getByRole("button", { name: "Tool profile", exact: true }).click();
      await expect(
        page.getByText("Choose the Host tools, MCP servers and skills yourself.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await capture("member-custom-tools");
      await member.getByRole("radio", { name: "Full access", exact: true }).focus();
      await member.getByRole("radio", { name: "Full access", exact: true }).press("Space");
      await expect(member.getByRole("button", { name: /^Host tools:/ })).toHaveCount(0);
      await page.goto(`/tests/browser/crews/crews.html?rich&multiple&theme=${theme}`);
      await openCrewsTab(page, "Work");
      await capture("work");
    });
  }

/** Opens the Crews page on a tab; the fixture has no app shell, so a button mounts the page. */
async function openCrewsTab(page: Page, tab: CrewsTab) {
  await page.getByRole("button", { name: "Crews page", exact: true }).click();
  const content = page.locator("[data-app-crews]");
  const target = content.getByRole("tab", { name: new RegExp(`^${tab}`) });
  await expect(content.getByRole("tab", { selected: true })).toBeVisible();
  // The page picks its landing tab from open decisions until the owner chooses one, and choosing
  // the tab it already shows is not a choice. Pick another first so the tab is pinned (see the
  // expected-failure test about the landing tab).
  if ((await target.getAttribute("aria-selected")) === "true")
    await content
      .getByRole("tab", { name: tab === "Teams" ? "Members" : "Teams", exact: true })
      .click();
  await target.click();
  await expect(content.getByRole("tabpanel")).toBeVisible();
  return content;
}

/** Opens a saved crew's editor from its card on the Teams tab. */
async function editCrew(page: Page, name = "Website Crew") {
  await openCrewsTab(page, "Teams");
  await openCrewEditorFromTeam(page, name);
}

/** The crew editor dialog is titled by the crew's own name; it is the first (outermost) dialog while it is open. */
function crewEditor(page: Page) {
  return page.getByRole("dialog").first();
}

async function openCrewEditorFromTeam(page: Page, name: string) {
  // The sidebar rail lists the same crew; the Teams tab owns this menu.
  await page
    .getByRole("tabpanel", { name: "Teams" })
    .getByRole("button", { name: `${name} options`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Edit crew", exact: true }).click();
}

async function openStart(page: Page) {
  // The rail row's play icon; the Teams card and the Work tab header start work too.
  const row = page
    .locator("aside")
    .first()
    .getByRole("listitem")
    .filter({ hasText: "Website Crew" });
  await row.getByRole("button", { name: "New work with Website Crew" }).click();
  return page.getByRole("dialog", { name: "New task", exact: true });
}

test("a new review shows current activity and opens the current reviewer", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?reviewingAgain");
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  const reviewer = work.getByRole("button", {
    name: /Reviewer.*Build settings.*Reviewing/,
  });
  await expect(reviewer).toBeVisible();
  await expect(work.getByRole("button", { name: /Reviewer.*Passed/ })).toHaveCount(0);
  await reviewer.click();
  await expect(page.getByLabel("Opened session")).toHaveText("current-review-session");
});

type GroupSnapshot = {
  definitions: string[];
  agents: { id: string; groups?: string[] }[];
  agentSaveCounts: Record<string, number>;
  groupUpdateCalls: number;
};
const groupSnapshot = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { crewFixtureSnapshot: () => GroupSnapshot }).crewFixtureSnapshot(),
  );
async function openGroupDialog(page: Page, group: string, action: "Rename group" | "Delete group") {
  await openCrewsTab(page, "Members");
  await page.getByRole("button", { name: /^Member group:/ }).click();
  await page.getByRole("option", { name: group, exact: true }).click();
  await page.getByRole("button", { name: "Group options", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  return page.getByRole("dialog", {
    name: action === "Rename group" ? action : new RegExp(`^Delete group ${group}`),
  });
}

test("a failed library group rename leaves every profile in the old group and retries as one call", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?groupRetry&longLibrary");
  const dialog = await openGroupDialog(page, "UI", "Rename group");
  await dialog.getByRole("textbox", { name: "Group name", exact: true }).fill("Interface");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Group update unavailable");
  // Nothing moved: no profile carries the new name and the field stays editable.
  const failed = await groupSnapshot(page);
  expect(failed.agents.every((agent) => agent.groups?.join() === "UI")).toBe(true);
  await expect(dialog.getByRole("textbox", { name: "Group name", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const snapshot = await groupSnapshot(page);
  expect(snapshot.agents.every((agent) => agent.groups?.join() === "Interface")).toBe(true);
  expect(snapshot.groupUpdateCalls).toBe(2);
  expect(snapshot.agentSaveCounts).toEqual({});
});

test("library group delete removes the label from every member in one call and keeps the members", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?longLibrary");
  const before = await groupSnapshot(page);
  const dialog = await openGroupDialog(page, "UI", "Delete group");
  await dialog.getByRole("button", { name: "Delete group", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const snapshot = await groupSnapshot(page);
  expect(snapshot.agents.map((agent) => agent.id)).toEqual(before.agents.map((agent) => agent.id));
  expect(snapshot.agents.some((agent) => agent.groups?.includes("UI"))).toBe(false);
  expect(snapshot.groupUpdateCalls).toBe(1);
  expect(snapshot.agentSaveCounts).toEqual({});
});

test("renaming a library group onto an existing group is refused instead of merging", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?longLibrary");
  const dialog = await openGroupDialog(page, "UI", "Rename group");
  await dialog.getByRole("textbox", { name: "Group name", exact: true }).fill("Backend");
  await expect(dialog.getByRole("alert")).toContainText("A group with this name already exists");
  await expect(dialog.getByRole("button", { name: "Rename", exact: true })).toBeDisabled();
  expect((await groupSnapshot(page)).groupUpdateCalls).toBe(0);
});

test("library copy reconciles an uncertain saved profile without a second save", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?copyUnknown&longLibrary");
  await openCrewsTab(page, "Members");
  await page
    .locator(".settings-collection-row")
    .filter({ hasText: "API engineer" })
    .getByRole("button", { name: /^Edit / })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "API engineer",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Copy to all projects", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Profile save response unavailable");
  await dialog.getByRole("button", { name: "Copy to all projects", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const snapshot = await page.evaluate(() =>
    (
      window as unknown as {
        crewFixtureSnapshot: () => {
          agents: { id: string }[];
          agentSaveCounts: Record<string, number>;
        };
      }
    ).crewFixtureSnapshot(),
  );
  // Two profiles and five fillers that make the library long, plus the copy.
  expect(snapshot.agents).toHaveLength(8);
  expect(Object.values(snapshot.agentSaveCounts)).toEqual([1]);
});

test("model catalog failure leaves existing work controls and sessions usable", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?catalogUnavailable");
  const management = await openWork(page);
  await expect(
    management.getByRole("alert").filter({ hasText: "Model catalog temporarily unavailable" }),
  ).toBeVisible();
  const work = management.locator('[data-crew-run="run"]');
  await work.getByRole("button", { name: "Pause new assignments" }).click();
  await expect(work.getByRole("button", { name: "Resume work" })).toBeVisible();
  await work
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /Coordinator/ })
    .click();
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
});

test("opening an acknowledged run again after a navigation failure never starts work twice", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?openFailsOnce");
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  await work.getByRole("button", { name: "Open session", exact: true }).first().click();
  // The failure names the action; the Host's reason sits behind its Details control.
  const failure = management.getByRole("alert").filter({ hasText: "Open session failed" });
  await expect(failure).toBeVisible();
  await failure.getByRole("button", { name: /^Details/ }).click();
  await expect(page.getByText("Conversation temporarily unavailable")).toBeVisible();
  await expect(management).toBeVisible();
  await expect(page.getByLabel("Opened session")).toHaveText("");
  await work.getByRole("button", { name: "Open session", exact: true }).first().click();
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
  await expect(page.getByLabel("Started work")).toHaveText("0");
});

test("uncertain start keeps its receipt when closed and reopened", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?startUnknownOnce&taskStart");
  let start = await openStart(page);
  await start
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Review mobile navigation");
  await start
    .getByRole("combobox", { name: "Description", exact: true })
    .fill("Check the narrow layout.");
  await start.getByRole("button", { name: "Start", exact: true }).click();
  await expect(start.getByText("Start response unavailable. Delivery unknown.")).toBeVisible();
  await start.getByRole("button", { name: "Close", exact: true }).click();
  start = await openStart(page);
  await expect(start.getByRole("textbox", { name: "Task title", exact: true })).toHaveValue(
    "Review mobile navigation",
  );
  await start.getByRole("button", { name: "Start", exact: true }).click();
  await expect(start).toHaveCount(0);
  await expect(page.getByLabel("Started work")).toHaveText("1");
  const ids = await page.evaluate(
    () => (window as unknown as { crewFixtureTaskSaveIds: string[] }).crewFixtureTaskSaveIds,
  );
  // The retry reconciles the persisted task by its creation id instead of saving again.
  expect(ids).toHaveLength(1);
});

test("the tab the page landed on stays after the work that needed a decision finishes", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?multiple");
  await page.getByRole("button", { name: "Crews page", exact: true }).click();
  const content = page.locator("[data-app-crews]");
  await expect(content.getByRole("tab", { name: "Work", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.evaluate(() =>
    (window as unknown as { simulateRunFinish: (id: string) => void }).simulateRunFinish("run"),
  );
  // The rail reads the same poll: once it stops naming the decision, the page has seen the change.
  await expect(
    page
      .locator("aside")
      .first()
      .getByRole("button", { name: /^Website Crew, Needs decision/ }),
  ).toHaveCount(0, { timeout: 12000 });
  await expect(content.getByRole("tab", { name: "Work", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("work stays selected when a poll moves it to finished history", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/tests/browser/crews/crews.html?multiple");
  const management = await openWork(page);
  await page.evaluate(() =>
    (window as unknown as { simulateRunFinish: (id: string) => void }).simulateRunFinish("run"),
  );
  // The view is the owner's choice: the finished work stays open and the Ongoing view is not
  // switched, so the other ongoing work stays out of the detail.
  await expect(management.getByRole("radio", { name: /^Ongoing/ })).toBeChecked({
    timeout: 12000,
  });
  await expect(management.getByRole("radio", { name: /^Ongoing/ })).toContainText("(1)");
  await expect(management.getByRole("radio", { name: "Finished", exact: true })).not.toBeChecked();
  await expect(management.locator('[data-crew-run="run"]')).toBeVisible();
  await expect(management.locator('[data-crew-run="second-run"]')).toHaveCount(0);
});

test("legacy activity omission does not claim stopped or permit deleting a session", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?pausedPlanning&unknownActivity");
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  await expect(work.getByRole("button", { name: "Resume work" })).toBeVisible();
  await expect(work.getByRole("button", { name: "Stop work", exact: true })).toBeVisible();
  await expect(work.getByRole("button", { name: "Delete work", exact: true })).toBeDisabled();
});

test("the start dialog starts the work with the crew's access and leaves the crew unchanged", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?taskStart");
  await editCrew(page);
  const edit = crewEditor(page);
  // Access is the crew's own chip: the work form does not repeat it for a known crew.
  await edit.getByRole("button", { name: "Supervised", exact: true }).click();
  await page.getByRole("option", { name: /Auto-accept edits/ }).click();
  await expect(edit.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(edit).toHaveCount(0);
  const operations = () =>
    page.evaluate(
      () => (window as unknown as { crewFixtureOperations: string[] }).crewFixtureOperations,
    );
  const before = (await operations()).length;
  const start = await openStart(page);
  await start
    .locator("summary")
    .filter({ hasText: /^More options/ })
    .click();
  await expect(start.getByRole("button", { name: /^Crew:/ })).toHaveCount(0);
  await expect(start.getByRole("button", { name: "Supervised", exact: true })).toHaveCount(0);
  await expect(start.getByRole("button", { name: "Auto-accept edits", exact: true })).toHaveCount(
    0,
  );
  await start
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Review mobile navigation");
  await start
    .getByRole("combobox", { name: "Description", exact: true })
    .fill("Check the narrow layout.");
  await start.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByLabel("Started work")).toHaveText("1");
  const calls = (await operations()).slice(before);
  expect(
    calls.filter((call) => ["crews.save", "tasks.save", "tasks.start"].includes(call)),
  ).toEqual(["tasks.save", "tasks.start"]);
  const saved = await page.evaluate(() =>
    (
      window as unknown as {
        crewFixtureSavedTasks: () => {
          executor: { kind: string; crewDefinitionId: string };
          runtimeMode: string;
        }[];
      }
    ).crewFixtureSavedTasks(),
  );
  expect(saved).toEqual([
    expect.objectContaining({
      executor: { kind: "crew", crewDefinitionId: "crew" },
      runtimeMode: "auto-accept-edits",
    }),
  ]);
});

test("an externally deleted crew cannot start new work", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?taskStart");
  const start = await openStart(page);
  await start.getByRole("textbox", { name: "Task title", exact: true }).fill("Keep my request");
  await start.getByRole("combobox", { name: "Description", exact: true }).fill("Keep my request");
  await page.evaluate(() =>
    (window as unknown as { simulateCrewDelete: () => void }).simulateCrewDelete(),
  );
  // While More options is closed the footer sends the owner there; open, the crew row says why.
  await expect(start.getByText("Choose an available crew in More options.")).toBeVisible({
    timeout: 12000,
  });
  await start
    .locator("summary")
    .filter({ hasText: /^More options/ })
    .click();
  await expect(
    start.getByText("Connect an updated host and choose an available crew."),
  ).toBeVisible();
  await expect(start.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await start.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByLabel("Started work")).toHaveText("0");
});

test("deleted crew edits can be preserved under a new identity", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  await editCrew(page);
  const edit = editor(page);
  await edit
    .getByRole("textbox", { name: "Crew name", exact: true })
    .fill("Website Crew local edits");
  await page.evaluate(() =>
    (window as unknown as { simulateCrewDelete: () => void }).simulateCrewDelete(),
  );
  await expect(edit.getByText("This crew is no longer available.")).toBeVisible({ timeout: 12000 });
  await edit.getByRole("button", { name: "Keep edits as new crew", exact: true }).click();
  await expect(edit.getByRole("textbox", { name: "Crew name", exact: true })).toHaveValue(
    "Website Crew local edits",
  );
  await edit.getByRole("button", { name: "Create crew", exact: true }).click();
  // The new crew is stored under a new identity; the deleted one stays gone.
  await expect.poll(async () => (await groupSnapshot(page)).definitions.length).toBe(1);
  await expect(edit.getByText("All changes saved", { exact: true })).toBeVisible();
  await expect(edit.getByRole("button", { name: "Create crew", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Started work")).toHaveText("0");
});

test("a slow autosave shows its progress in the footer and offers no Save or Discard", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?slowOperation=crews.save");
  await editCrew(page);
  const edit = editor(page);
  await edit.getByRole("textbox", { name: "Crew name", exact: true }).fill("Website Crew revised");
  // There is no Save button for a stored crew: it saves itself.
  await expect(edit.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(edit.getByRole("button", { name: "Discard", exact: true })).toHaveCount(0);
  await expect(edit.getByText("Saving…", { exact: true })).toBeVisible();
  await expect(edit.getByRole("button", { name: "Close", exact: true })).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.evaluate(() =>
    (
      window as unknown as { crewFixtureReleaseOperation: () => void }
    ).crewFixtureReleaseOperation(),
  );
  await expect(edit.getByText("All changes saved", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Started work")).toHaveText("0");
});
for (const theme of ["light", "dark"]) {
  test(`paused planning work explains its idle state in ${theme}`, async ({ page }, testInfo) => {
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/crews/crews.html?pausedPlanning&theme=${theme}`);
      const management = await openWork(page);
      const work = management.locator('[data-crew-run="run"]');
      await expect(work.getByRole("status")).toHaveCount(0);
      await expect(work.getByRole("button", { name: "Stop work", exact: true })).toHaveCount(0);
      await expect(work.getByRole("button", { name: "Resume work" })).toBeEnabled();
      await expect(work.getByRole("button", { name: "Resume work" })).toHaveAttribute(
        "data-button-hierarchy",
        "primary",
      );
      await expect(work.getByRole("button", { name: "Delete work", exact: true })).toBeEnabled();
      await expect(work.getByText("Planning", { exact: true })).toHaveCount(0);
      await expect(work).toContainText("No assignments yet");
      await expect(work.getByText(/Keep current drafts and provider selections\./)).toBeVisible();
      expect(await management.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({
        path: `temp/verification/2026-10-26-crew-stop/paused-${theme}-${width}-${testInfo.project.name}.png`,
      });
    }
  });
}

test("paused work keeps cancellation available while its coordinator is running", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/crews/crews.html?pausedPlanning&running&slowOperation=crews.stop",
  );
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  await work.getByRole("button", { name: "Stop work", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Stop work", exact: true })
    .getByRole("button", { name: "Stop work", exact: true })
    .click();
  // The pressed button carries its own pending name.
  await expect(work.getByRole("button", { name: "Stopping…", exact: true })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.evaluate(() =>
    (
      window as unknown as { crewFixtureReleaseOperation: () => void }
    ).crewFixtureReleaseOperation(),
  );
  // The pending "Stopping…" status can remain briefly beside the paused state.
  await expect(work.getByRole("status")).toHaveCount(0);
  await expect(work.getByRole("button", { name: "Stop work", exact: true })).toHaveCount(0);
});
for (const theme of ["light", "dark"] as const) {
  test(`crew work shows only the initiating operation pending in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/crews/crews.html?theme=${theme}&slowOperation=crews.pause`);
    const management = await openWork(page);
    const pauseAction = management.getByRole("button", {
      name: "Pause new assignments",
      exact: true,
    });
    await pauseAction.focus();
    await pauseAction.press("Enter");
    // The pressed button carries its own pending name instead of a separate status line.
    const pause = management.getByRole("button", { name: "Pausing…", exact: true });
    await expect(pause).toHaveAttribute("aria-busy", "true");
    await expect(pause).toBeFocused();
    await expect(
      management.getByRole("button", { name: "Stop work", exact: true }),
    ).not.toHaveAttribute("aria-busy", "true");
    await expect(management.getByRole("status").filter({ hasText: "Pausing…" })).toHaveCount(0);
    await pause.evaluate((node: HTMLButtonElement) => node.click());
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { crewFixtureOperations: string[] }).crewFixtureOperations.filter(
            (method) => method === "crews.pause",
          ).length,
      ),
    ).toBe(1);
    await page.screenshot({
      path: `temp/verification/2026-10-25-full-ui/tasks-crews/pending-crew-390-${theme}.png`,
      fullPage: true,
    });
    await page.evaluate(() =>
      (
        window as unknown as { crewFixtureReleaseOperation: () => void }
      ).crewFixtureReleaseOperation(),
    );
    await expect(
      management.getByRole("button", { name: "Resume work", exact: true }),
    ).toBeEnabled();
  });
}
/** Opens the Work tab with one run selected; a crew with a single run has no list to choose from. */
async function openWork(page: Page, runId = "run") {
  const content = await openCrewsTab(page, "Work");
  const choice = content.locator(`[data-crew-work-choice="${runId}"]`);
  const run = content.locator(`[data-crew-run="${runId}"]`);
  await expect(choice.or(run).first()).toBeVisible();
  if (await choice.count()) await choice.click();
  await expect(run).toBeVisible();
  return content;
}
async function deleteSelectedWork(_page: Page, work: ReturnType<Page["locator"]>) {
  await work.getByRole("button", { name: "Delete work", exact: true }).click();
}
const editor = crewEditor;
for (const theme of ["light", "dark"] as const) {
  test(`bycoda defaults stay editable with independent library profiles in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({
      width: theme === "light" ? 390 : 1100,
      height: 844,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/crews/crews.html?defaults&theme=${theme}`);
    const content = await openCrewsTab(page, "Members");
    await expect(content.getByRole("button", { name: /^Edit / })).toHaveCount(17);
    await content.getByRole("tab", { name: "Teams", exact: true }).click();
    await openCrewEditorFromTeam(page, "bycoda Product Team");
    const team = crewEditor(page);
    await expect(team.locator("[data-member-row]")).toHaveCount(17);
    await expect(team).not.toContainText("Responsibilities");
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 995 });
      await team.screenshot({
        path: `temp/verification/2026-11-04-crew-roster/team-${theme}-${width}-${testInfo.project.name}.png`,
      });
    }
    await expect(team.getByRole("region", { name: "Coordinator", exact: true })).toContainText(
      "Team Lead",
    );
    await expect(team.getByRole("region", { name: "Specialists", exact: true })).toContainText(
      "Mobile Engineer",
    );
    await expect(team.getByRole("region", { name: "Advisors", exact: true })).toContainText(
      "Project Manager",
    );
    await expect(team.getByRole("region", { name: "Specialists", exact: true })).toContainText(
      "Database Administrator (DBA)",
    );
    await expect(team.getByRole("region", { name: "Specialists", exact: true })).toContainText(
      "Data Engineer",
    );
    await team.getByRole("button", { name: /^Database Administrator \(DBA\) / }).click();
    await expect(team.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(
      /measured query performance/,
    );
    // Rows open in place: opening another member closes the first and nothing navigates away.
    await expect(team.getByRole("button", { name: "Back to team" })).toHaveCount(0);
    await team.getByRole("button", { name: /^Mobile Engineer / }).click();
    await expect(team.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(
      /lifecycle and connectivity behavior/,
    );
    await team
      .getByRole("textbox", { name: "Member name", exact: true })
      .fill("Our mobile engineer");
    // The stored crew saves itself; there is no Save button to press.
    await expect(team.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await expect(team.getByText("All changes saved", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(team).not.toBeVisible();
    // Team edits leave the reusable library profile independent.
    await content.getByRole("tab", { name: "Members", exact: true }).click();
    const mobile = content.getByText("Mobile Engineer", { exact: true });
    await expect(mobile).toBeVisible();
    await page.screenshot({
      path: `${shots}/defaults-${theme}-${testInfo.project.name}.png`,
    });
    await content.getByRole("tab", { name: "Teams", exact: true }).click();
    await openCrewEditorFromTeam(page, "bycoda Product Team");
    const saved = crewEditor(page);
    await expect(saved.getByRole("region", { name: "Specialists", exact: true })).toContainText(
      "Our mobile engineer",
    );
    await expect(page.getByLabel("Started work")).toHaveText("0");
  });
}
test("creates a crew from the rail with chosen members without starting work", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews/crews.html");
  await page.getByRole("button", { name: "New crew", exact: true }).click();
  const dialog = editor(page);
  await expect(dialog.getByRole("textbox", { name: "Crew name" })).toBeFocused();
  // An empty crew explains what it needs and cannot be saved yet.
  await dialog.getByRole("button", { name: "Create crew" }).click();
  await expect(dialog.getByText("Name the crew.").first()).toBeVisible();
  await dialog.getByRole("textbox", { name: "Crew name" }).fill("Mobile");
  await dialog.getByRole("button", { name: "Use starter roster" }).click();
  await expect(dialog.getByRole("region", { name: "Specialists" })).toContainText("Codex fixture");
  await page.screenshot({
    path: `${shots}/create-${testInfo.project.name}.png`,
  });
  // Several library members are added in one step. A short library needs no search.
  await dialog.getByRole("button", { name: "Add members", exact: true }).click();
  await expect(dialog.getByRole("tab", { name: "Library (2)" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    dialog.getByRole("textbox", { name: "Search name, role, model or group" }),
  ).toHaveCount(0);
  await dialog.getByLabel("UI designer").check();
  await dialog.getByLabel("API engineer").check();
  await page.screenshot({
    path: `${shots}/add-members-${testInfo.project.name}.png`,
  });
  await page.getByRole("button", { name: "Add 2 members" }).click();
  const specialists = dialog.getByRole("region", { name: "Specialists" });
  await expect(specialists.getByRole("button", { name: /^UI designer/ })).toBeVisible();
  await expect(specialists.getByRole("button", { name: /^API engineer/ })).toBeVisible();
  await page.getByRole("button", { name: "Create crew" }).click();
  // The crew is stored with the chosen members; the footer confirms it instead of a notice.
  await expect(dialog.getByText("All changes saved", { exact: true })).toBeVisible();
  await expect.poll(async () => (await groupSnapshot(page)).definitions.length).toBe(2);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(
    page.locator("aside").first().getByRole("listitem").filter({ hasText: "Mobile" }),
  ).toBeVisible();
  await expect(page.getByLabel("Started work")).toHaveText("0");
});
test("adds a new member when the library is empty and shows role problems in place", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?library=empty");
  await page.getByRole("button", { name: "New crew", exact: true }).click();
  const dialog = editor(page);
  await dialog.getByRole("button", { name: "Add members", exact: true }).click();
  await expect(dialog.getByRole("tab", { name: "New member" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dialog.getByRole("tab", { name: "Library (0)" }).click();
  await expect(dialog.getByText("Your member library is empty")).toBeVisible();
  await dialog.getByRole("tab", { name: "New member" }).click();
  await page.getByRole("button", { name: "Add to crew" }).click();
  await expect(dialog.getByText("Add a name").first()).toBeVisible();
  // The role is chosen on the member itself; suggestions follow the chosen role.
  const coordinator = dialog
    .getByRole("group", { name: "Role" })
    .getByRole("radio", { name: "Coordinator" });
  await coordinator.focus();
  await coordinator.press("Space");
  await expect(coordinator).toBeChecked();
  await dialog
    .getByRole("group", { name: "Suggested roles" })
    .getByRole("button", { name: "Project lead" })
    .click();
  await expect(dialog.getByRole("textbox", { name: "Member name" })).toHaveValue("Project lead");
  await dialog.getByRole("textbox", { name: "Member name" }).fill("Mobile release lead");
  await page.getByRole("button", { name: "Add to crew" }).click();
  await expect(dialog.getByRole("region", { name: "Coordinator" })).toContainText(
    "Mobile release lead",
  );
  await expect(dialog.getByText("Add a reviewer.").first()).toBeVisible();
  await expect(dialog.getByText("Add at least one specialist.").first()).toBeVisible();
  // Adding to a crew does not save the member to the library.
  await dialog.getByRole("button", { name: "Add members", exact: true }).click();
  await expect(dialog.getByRole("tab", { name: "Library (0)" })).toBeVisible();
});
test("opens ongoing work from the rail and starts new work once from the same crew row", async ({
  page,
}, testInfo) => {
  // Wide enough for the work list and the selected work to share the page.
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/tests/browser/crews/crews.html?taskStart");
  const row = page
    .locator("aside")
    .first()
    .getByRole("listitem")
    .filter({ hasText: "Website Crew" });
  // A rail row opens the Work tab with that crew's work.
  await row.getByRole("button", { name: /Website Crew, Needs decision/ }).click();
  const workTab = page.locator("[data-app-crews]");
  await expect(workTab.getByRole("tab", { name: "Work", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(workTab.locator('[data-crew-run="run"]')).toBeVisible();
  await workTab
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /Coordinator/ })
    .click();
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
  await row.hover();
  await row.getByRole("button", { name: "New work with Website Crew" }).click();
  const start = page.getByRole("dialog", { name: "New task" });
  // The crew is known, so the form names it in its context and offers no crew or Access row; the roster lives in the crew editor.
  await start
    .locator("summary")
    .filter({ hasText: /^More options/ })
    .click();
  await expect(start).toContainText("Website Crew");
  await expect(start.getByRole("button", { name: /^Crew:/ })).toHaveCount(0);
  const originalClass = await page.evaluate(() => document.documentElement.className);
  const originalViewport = page.viewportSize();
  try {
    for (const theme of ["light", "dark"])
      for (const width of [1280, 800]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(
          (theme) => document.documentElement.classList.toggle("theme-light", theme === "light"),
          theme,
        );
        await expect(start).toBeVisible();
        expect(await start.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
        await start.screenshot({
          path: `temp/verification/release-0.7.1/crew-start-roster-${testInfo.project.name}-${theme}-${width}.png`,
          animations: "disabled",
        });
      }
  } finally {
    await page.evaluate((value) => {
      document.documentElement.className = value;
    }, originalClass);
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  await start.getByRole("textbox", { name: "Task title", exact: true }).fill("Mobile sign-in");
  await start
    .getByRole("combobox", { name: "Description", exact: true })
    .fill("Build mobile sign-in.");
  await start.getByRole("button", { name: "Start", exact: true }).dblclick();
  await expect(start).toHaveCount(0);
  await expect(page.getByLabel("Started work")).toHaveText("1");
});
test("the crew menu offers the coordinator, edit, copy and delete, and no work controls", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html");
  const row = page
    .locator("aside")
    .first()
    .getByRole("listitem")
    .filter({ hasText: "Website Crew" });
  await row.hover();
  await row.getByRole("button", { name: "Website Crew options" }).click();
  const menu = page.getByRole("menu", { name: "Website Crew options" });
  for (const name of [
    "Open coordinator",
    "Edit crew",
    "Duplicate",
    "Copy to all projects",
    "Delete crew",
  ])
    await expect(menu.getByRole("menuitem", { name: new RegExp(name) })).toBeVisible();
  // Starting work is the play icon; the other work controls live in the Work tab.
  await expect(
    menu.getByRole("menuitem", {
      name: /New work|Add members|Crew work|Stop work|Pause new assignments/,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  await work.getByRole("button", { name: "Pause new assignments" }).click();
  await expect(work.getByRole("button", { name: "Resume work" })).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "Website Crew options" }).click();
  await page.getByRole("menuitem", { name: /Delete crew/ }).click();
  await expect(page.getByRole("dialog", { name: "Delete Website Crew?" })).toContainText(
    "Library members are kept",
  );
});
test("work detail opens selected work with visible conversations", async ({ page }, testInfo) => {
  await page.goto("/tests/browser/crews/crews.html");
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  await expect(work).toContainText("Build settings page");
  // The decision is stated once, by its alert; the header repeats no attention badge.
  await expect(work.getByText("Needs decision: Need image generation for the hero")).toBeVisible();
  await expect(work).toContainText("0/1 tasks");
  await expect(
    work
      .getByRole("list", { name: "Sessions", exact: true })
      .getByRole("button", { name: /Coordinator/ }),
  ).toBeVisible();
  await expect(work.getByRole("button", { name: /UI.*Awaiting acceptance/ })).toBeVisible();
  await expect(work.getByRole("button", { name: /Reviewer.*Build settings/ })).toBeVisible();
  await page.screenshot({
    path: `${shots}/management-${testInfo.project.name}.png`,
  });
  await work.getByRole("button", { name: /UI.*Awaiting acceptance/ }).click();
  await expect(page.getByLabel("Opened session")).toHaveText("ui-session");
  // The Work tab stays where it is; another conversation opens from the same place.
  await expect(work).toBeVisible();
  await work.getByRole("button", { name: /Reviewer.*Build settings/ }).click();
  await expect(page.getByLabel("Opened session")).toHaveText("review-session");
});
test("work management exposes long decisions and blockers without extra disclosure", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/crews/crews.html?blocked");
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  const decision = work.locator("p").filter({ hasText: /confirm the next provider and budget\./ });
  const blocker = work
    .locator("p")
    .filter({ hasText: /select a replacement before retrying this task\./ });
  await expect(decision).toBeVisible();
  await expect(blocker).toBeVisible();
  for (const detail of [decision, blocker]) {
    expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `${shots}/blocked-narrow-${testInfo.project.name}.png`,
  });
  await work
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /Coordinator/ })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
});
test("one manager selects ongoing and finished work without mixing conversations", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/tests/browser/crews/crews.html?multiple");
  const management = await openWork(page);
  await expect(management.locator('[data-crew-run="run"]')).toBeVisible();
  await management.getByRole("button", { name: /^Improve mobile navigation/ }).click();
  await expect(management.locator('[data-crew-run="run"]')).toHaveCount(0);
  const second = management.locator('[data-crew-run="second-run"]');
  await expect(second).toContainText("Improve mobile navigation");
  await expect(
    second
      .getByRole("list", { name: "Sessions", exact: true })
      .getByRole("button", { name: /Reviewer/ }),
  ).toHaveCount(0);
  await management.getByRole("radio", { name: "Finished", exact: true }).click();
  await management.getByRole("button", { name: /^Audit landing page/ }).click();
  await expect(management.locator('[data-crew-run="old-run"]')).toContainText("Audit landing page");
  await page.screenshot({
    path: `${shots}/finished-${testInfo.project.name}.png`,
  });
  await management.getByRole("radio", { name: /Ongoing/ }).click();
  await management.getByRole("button", { name: /^Improve mobile navigation/ }).click();
  await management
    .locator('[data-crew-run="second-run"]')
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /Coordinator/ })
    .click();
  await expect(page.getByLabel("Opened session")).toHaveText("second-lead");
});
test("editing is one page: roster first, more options one disclosure away, and fits narrow windows", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews/crews.html?theme=light");
  await editCrew(page);
  const dialog = crewEditor(page);
  await expect(dialog.getByRole("region", { name: "Coordinator" })).toBeVisible();
  await dialog.getByRole("button", { name: "UI", exact: true }).click();
  // The expanded member uses the same provider/model picker as the roster.
  const editedMember = dialog.getByRole("listitem").filter({
    has: page.getByRole("textbox", { name: "Member name", exact: true }),
  });
  await expect(
    editedMember.getByRole("button", { name: "Codex Codex fixture", exact: true }).last(),
  ).toBeVisible();
  await expect(dialog.getByText("Owner quality estimate")).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Member name" }).fill("Frontend");
  // Handle, groups, tools, look and reviews sit behind the member's own More options.
  await dialog
    .locator("summary")
    .filter({ hasText: /^More options/ })
    .first()
    .click();
  await dialog.getByRole("textbox", { name: "Groups" }).fill("Web");
  await dialog.getByRole("textbox", { name: "Groups" }).press("Enter");
  await dialog.getByRole("button", { name: "Save to library" }).click();
  await expect
    .poll(async () =>
      (await groupSnapshot(page)).agents.some((agent) => agent.groups?.includes("Web")),
    )
    .toBe(true);
  // Members open in place on the same page: there is no member page to return from.
  await expect(dialog.getByRole("button", { name: "Back to team" })).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "Working settings" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^Frontend/ })).toBeVisible();
  await dialog
    .locator("summary")
    .filter({ hasText: /^More options/ })
    .last()
    .click();
  await dialog.getByRole("spinbutton", { name: "Members working at once" }).fill("9");
  await expect(dialog.getByText("Use a whole number from 1 to 4.").first()).toBeVisible();
  await dialog.getByRole("spinbutton", { name: "Members working at once" }).fill("2");
  await page.screenshot({
    path: `${shots}/settings-${testInfo.project.name}.png`,
  });
  // The stored crew saves itself shortly after the last valid edit.
  await expect(dialog.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  await page.screenshot({
    path: `${shots}/narrow-${testInfo.project.name}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // The library keeps the saved profile with its group.
  await page.locator("[data-app-crews]").getByRole("tab", { name: "Members", exact: true }).click();
  await expect(page.getByText("Frontend").first()).toBeVisible();
});
test("conflicting edits can be preserved as a new crew or replaced by the latest", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html");
  await editCrew(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Crew name" }).fill("My local edits");
  await page.evaluate(() =>
    (window as unknown as { simulateCrewUpdate: () => void }).simulateCrewUpdate(),
  );
  // The autosave against the newer revision fails (or polling notices) and reveals the conflict.
  await expect(dialog.getByRole("button", { name: "Keep edits as new crew" })).toBeVisible({
    timeout: 10000,
  });
  await expect(dialog.getByText("All changes saved", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Discard edits and load latest" }).click();
  await expect(dialog.getByRole("textbox", { name: "Crew name" })).toHaveValue(
    "Updated by another session",
  );
});
test("task creation can pick a saved crew", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  await page.getByRole("button", { name: "Task crew selection" }).click();
  await page.getByRole("button", { name: /^Crew:/ }).click();
  await page.getByRole("option", { name: /Website Crew/ }).click();
  await expect(page.getByLabel("Selected crew")).toHaveText("crew");
});
for (const theme of ["dark", "light"]) {
  test(`stops and deletes only selected work in ${theme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/crews/crews.html?theme=${theme}&multiple`);
    const management = await openWork(page);
    const work = management.locator('[data-crew-run="run"]');
    await expect(work.getByRole("button", { name: "Delete work", exact: true })).toBeDisabled();
    await work.getByRole("button", { name: "Stop work", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Stop work", exact: true })
      .getByRole("button", { name: "Stop work", exact: true })
      .click();
    await expect(work.getByRole("button", { name: "Resume work" })).toBeVisible();
    await page.screenshot({
      path: `${shots}/work-${theme}-${testInfo.project.name}.png`,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await deleteSelectedWork(page, work);
    const confirmation = page.getByRole("dialog", {
      name: "Delete work",
      exact: true,
    });
    await expect(confirmation).toContainText("The crew, tasks and conversations are kept.");
    await confirmation.getByRole("button", { name: "Delete work", exact: true }).click();
    await expect(work).toHaveCount(0);
    await expect(
      management.getByRole("button", { name: /^Improve mobile navigation/ }),
    ).toBeVisible();
    const snapshot = await page.evaluate(() =>
      (
        window as unknown as {
          crewFixtureSnapshot: () => {
            definitions: string[];
            runs: { id: string; status: string }[];
          };
        }
      ).crewFixtureSnapshot(),
    );
    expect(snapshot.definitions).toContain("crew");
    expect(snapshot.runs).toEqual(
      expect.arrayContaining([
        { id: "second-run", status: "active" },
        { id: "old-run", status: "finished" },
      ]),
    );
    expect(snapshot.runs.some((run) => run.id === "run")).toBe(false);
  });
}
test("legacy hosts hide unsupported work deletion", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?legacy=1");
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  await expect(work.getByRole("button", { name: "Delete work", exact: true })).toHaveCount(0);
});

test("deleted crew definitions retain accessible work history", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/tests/browser/crews/crews.html?deletedDefinition");
  const management = await openWork(page);
  await expect(management.locator('[data-crew-run="run"]')).toContainText("Build settings page");
  await management.getByRole("radio", { name: "Finished", exact: true }).click();
  await expect(management.locator('[data-crew-run="old-run"]')).toContainText("Audit landing page");
  await management
    .locator('[data-crew-run="old-run"]')
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /Coordinator/ })
    .click();
  await expect(page.getByLabel("Opened session")).toHaveText("old-lead");
});

test("polling keeps the selected work when another delivery becomes newest", async ({ page }) => {
  // Wide enough that the list and the selected work sit side by side.
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/tests/browser/crews/crews.html?multiple");
  const management = await openCrewsTab(page, "Work");
  await expect(management.locator('[data-crew-run="second-run"]')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { simulateRunUpdate: (id: string) => void }).simulateRunUpdate("run"),
  );
  await expect(
    management.getByRole("list", { name: "Work list", exact: true }).getByRole("button").first(),
  ).toContainText("Build settings page", { timeout: 12000 });
  await expect(management.locator('[data-crew-run="second-run"]')).toBeVisible();
  await expect(management.locator('[data-crew-run="run"]')).toHaveCount(0);
});

test("the crew card menu opens the coordinator of its only work", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  const content = await openCrewsTab(page, "Teams");
  await content.getByRole("button", { name: "Website Crew options", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Open coordinator/ }).click();
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
});

test("a single piece of work needs no list column", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?singleRun");
  const management = await openWork(page);
  await expect(management.locator('[data-crew-run="run"]')).toBeVisible();
  await expect(management.getByRole("list", { name: "Work list", exact: true })).toHaveCount(0);
  await expect(management.getByRole("button", { name: "Back to work list" })).toHaveCount(0);
});

test("narrow windows show the work list or one work at a time", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/crews/crews.html?manyRuns");
  const management = await openCrewsTab(page, "Work");
  const list = management.getByRole("list", { name: "Work list", exact: true });
  // Opened without a chosen work: the list leads and no detail column is squeezed beside it.
  await expect(list).toBeVisible();
  await expect(management.locator("[data-crew-run]")).toBeHidden();
  await list.getByRole("button", { name: /^Work item 3/ }).click();
  await expect(management.locator('[data-crew-run="many-2"]')).toBeVisible();
  await expect(list).toBeHidden();
  // Back returns to the list with the same selection and view.
  await management.getByRole("button", { name: "Back to work list" }).click();
  await expect(list).toBeVisible();
  await expect(list.getByRole("button", { name: /^Work item 3/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("wide windows keep the work list beside the selected work", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/tests/browser/crews/crews.html?manyRuns");
  const management = await openWork(page);
  await expect(management.getByRole("list", { name: "Work list", exact: true })).toBeVisible();
  await expect(management.locator('[data-crew-run="run"]')).toBeVisible();
  await expect(management.getByRole("button", { name: "Back to work list" })).toBeHidden();
  // The work chosen in the list is the selected row even when it sits far down the list.
  await expect(management.locator('[data-crew-work-choice="run"]')).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("access is set once for every member, model rules open on demand, and edits autosave", async ({
  page,
}) => {
  // A long roster shows the bulk model bar, which links to the shared model order.
  await page.goto("/tests/browser/crews/crews.html?taskStart&longRoster");
  await editCrew(page);
  const dialog = crewEditor(page);
  // Access for the whole crew is one chip beside the crew name; the two grants sit under More options.
  const access = dialog.getByRole("button", { name: "Supervised", exact: true });
  await expect(access).toBeVisible();
  await access.click();
  await page.getByRole("option", { name: /Auto-accept edits/ }).click();
  await expect(
    dialog.getByRole("button", { name: "Auto-accept edits", exact: true }),
  ).toBeVisible();
  await dialog
    .locator("summary")
    .filter({ hasText: /^More options/ })
    .last()
    .click();
  await dialog.getByRole("switch", { name: "Coordinator answers permission requests" }).click();
  await expect(dialog.getByText("All changes saved", { exact: true })).toBeVisible();
  // Shared model rules live in Models; the crew keeps its execution limits here.
  await page.evaluate(() => {
    const tabs: string[] = [];
    (window as Window & { crewModelsTabs?: string[] }).crewModelsTabs = tabs;
    window.addEventListener("bycoda:open-models-settings", (event) => {
      tabs.push((event as CustomEvent<string>).detail);
    });
  });
  // The default model choice offers the link to the shared model order.
  await dialog.getByRole("radio", { name: "Use settings", exact: true }).check();
  await dialog.getByRole("button", { name: "Manage models", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { crewModelsTabs?: string[] }).crewModelsTabs),
    )
    .toEqual(["order"]);
  await expect(dialog.getByRole("button", { name: "Edit model rules" })).toHaveCount(0);
  // There is nothing to save or discard: reopening the crew shows the stored policy.
  await expect(dialog.getByRole("button", { name: "Discard", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await openCrewEditorFromTeam(page, "Website Crew");
  const reopened = crewEditor(page);
  await expect(
    reopened.getByRole("button", { name: "Auto-accept edits", exact: true }),
  ).toBeVisible();
  await reopened
    .locator("summary")
    .filter({ hasText: /^More options/ })
    .last()
    .click();
  await expect(
    reopened.getByRole("switch", {
      name: "Coordinator answers permission requests",
    }),
  ).toBeChecked();
});

test("an unsupported Host hides the access picker but keeps the grants", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?noAccess");
  await editCrew(page);
  const dialog = crewEditor(page);
  await expect(dialog.getByRole("button", { name: "Supervised", exact: true })).toHaveCount(0);
  await dialog
    .locator("summary")
    .filter({ hasText: /^More options/ })
    .last()
    .click();
  await expect(
    dialog.getByRole("switch", {
      name: "Coordinator answers permission requests",
    }),
  ).toBeVisible();
});

test("one model with its options can be applied to chosen members at once", async ({ page }) => {
  // The selection column and the bulk bar appear with a long roster (more than six members).
  await page.goto("/tests/browser/crews/crews.html?longRoster");
  await editCrew(page);
  const dialog = crewEditor(page);
  const apply = dialog.getByRole("button", { name: /^Apply to / });
  const stored = () =>
    page.evaluate(() =>
      (window as Window & { crewFixtureStoredMembers: () => unknown[] }).crewFixtureStoredMembers(),
    );
  await expect
    .poll(stored)
    .toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "ui", selection: "automatic" })]),
    );
  // The bar offers a real model from the start; Apply waits for at least one selected member.
  await expect(apply).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "Select UI" }).check();
  await expect(apply).toBeEnabled();
  await expect(apply).toHaveText("Apply to 1 member");
  await dialog.getByRole("checkbox", { name: "Select all" }).check();
  await expect(apply).toHaveText(/^Apply to \d+ members$/);
  await apply.click();
  // A model choice applies at once to the selection and says nothing more; the stored members show it.
  const everyone = ((await stored()) as { id: string }[]).map((member) => member.id);
  expect(everyone).toHaveLength(15);
  const assigned = everyone.map((id) =>
    expect.objectContaining({
      id,
      selection: "fixed",
      modelChoice: { kind: "fixed" },
      candidates: [
        {
          id: "codex/codex:fixture",
          harness: "codex",
          model: "codex:fixture",
          modelSettings: {},
          capabilities: {},
        },
      ],
    }),
  );
  await expect.poll(stored).toEqual(assigned);
  await expect(dialog.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await editCrew(page);
  await expect.poll(stored).toEqual(assigned);
});

test("a failed save stays visible, keeps the draft and starts nothing", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?saveError&longRoster");
  await editCrew(page);
  const dialog = crewEditor(page);
  await dialog.getByRole("textbox", { name: "Crew name", exact: true }).fill("Website Crew v2");
  // The autosave fails: the error and Retry stay in the footer, the draft stays as typed.
  await expect(dialog.getByText("Could not save the crew.")).toBeInViewport();
  // The Host's reason sits behind the failure's Details control.
  await dialog.getByRole("button", { name: /^Details/ }).click();
  await expect(
    page.getByText("The Host rejected this crew: storage is read-only right now."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Crew name", exact: true })).toHaveValue(
    "Website Crew v2",
  );
  await expect(dialog.getByText("All changes saved", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Started work")).toHaveText("0");
});

test("a long roster scrolls under an opaque header and keeps the footer actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto("/tests/browser/crews/crews.html?longRoster");
  await editCrew(page);
  const dialog = crewEditor(page);
  await expect(dialog.locator("[data-member-row]")).toHaveCount(15);
  await dialog.getByRole("textbox", { name: "Crew name", exact: true }).fill("Website Crew v2");
  await dialog.getByRole("region", { name: "Advisors" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  await expect(dialog.getByText("All changes saved", { exact: true })).toBeInViewport();
  await dialog.getByRole("button", { name: "UI", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Instructions", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  await expect(dialog.getByText("All changes saved", { exact: true })).toBeInViewport();
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`crews page tabs, filter and layout (${theme}, ${width}px)`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      // The filter and the cards/list switch appear only for a long list of crews.
      await page.goto(`/tests/browser/crews/crews.html?manyCrews&theme=${theme}`);
      await page.getByRole("button", { name: "Crews page", exact: true }).click();
      const content = page.locator("[data-app-crews]");
      await expect(content.getByRole("heading", { name: "Crews", exact: true })).toBeVisible();
      await expect(content.getByRole("tab")).toHaveText(["Teams", "Members", "Work"]);
      await content.getByRole("tab", { name: "Teams", exact: true }).click();
      const teams = content.getByRole("list", { name: "Crews", exact: true });
      await expect(teams.getByRole("listitem").first()).toBeVisible();
      await page.screenshot({
        path: `${"temp/verification/crews-hub"}/crews-page-teams-${theme}-${width}-${testInfo.project.name}.png`,
      });
      await content.getByRole("textbox", { name: "Filter crews" }).fill("no such crew");
      await expect(content.getByText("No matching crews")).toBeVisible();
      await content.getByRole("button", { name: "Reset filters", exact: true }).click();
      await content.getByRole("radio", { name: "List", exact: true }).click();
      await expect(teams.getByRole("listitem").first()).toBeVisible();
      await content.getByRole("tab", { name: "Members", exact: true }).click();
      await expect(content.getByRole("region", { name: "Member library" })).toBeVisible();
      await content.getByRole("tab", { name: "Work", exact: true }).click();
      await expect(content.getByRole("tabpanel")).toBeVisible();
    });
  }
}

test("crews are managed on the Crews page; settings no longer hold a sidebar toggle", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html");
  await page.getByRole("button", { name: "Crews page", exact: true }).click();
  const content = page.locator("[data-app-crews]");
  await expect(content.getByRole("tab")).toHaveText(["Teams", "Members", "Work"]);
  await expect(page.getByRole("switch", { name: "Show crews", exact: true })).toHaveCount(0);
});

test("the Members tab changes a member's teams from its Teams menu", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?rich");
  const content = await openCrewsTab(page, "Members");
  const row = content.locator(".settings-collection-row").filter({ hasText: "Researcher" });
  await expect(row.getByText("Not in a team")).toBeVisible();
  await row.getByRole("button", { name: "Teams of Researcher", exact: true }).click();
  await page.getByRole("menuitem", { name: "Website Crew" }).click();
  await expect(row.getByRole("group", { name: "Teams" })).toContainText("Website Crew");
});

test("the Work tab lists members working in another project and opens their conversation", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?rich&activeElsewhere");
  const content = await openCrewsTab(page, "Work");
  const rows = content.getByRole("region", { name: "Elsewhere" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await rows.filter({ hasText: "API engineer" }).getByRole("button").first().click();
  await expect(page.getByLabel("Opened session")).toHaveText("api-session");
});

test("this project's working members are left to the Work list", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?rich");
  const content = await openCrewsTab(page, "Work");
  await expect(content.getByRole("region", { name: "Fixture" })).toHaveCount(0);
});

const evidence = "temp/verification/crews-hub";
for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`crews hub evidence (${theme}, ${width}px)`, async ({ page }, testInfo) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/crews/crews.html?rich&activeElsewhere&theme=${theme}`);
      const shot = (name: string) =>
        page.screenshot({
          path: `${evidence}/r2-${name}-${theme}-${width}-${testInfo.project.name}.png`,
          animations: "disabled",
        });
      const noOverflow = async () =>
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        ).toBe(true);
      // The crews rail keeps the crew identities; current work is listed by the sidebar's own
      // Crew work section, not by this rail.
      await expect(
        page.locator("aside").first().getByRole("region", { name: "Crew work", exact: true }),
      ).toHaveCount(0);
      await page
        .locator("aside")
        .first()
        .screenshot({
          path: `${evidence}/r2-rail-${theme}-${width}-${testInfo.project.name}.png`,
          animations: "disabled",
        });
      const content = await openCrewsTab(page, "Work");
      await expect(
        content.getByRole("region", { name: "Elsewhere" }).getByRole("listitem"),
      ).toHaveCount(3);
      await shot("work-elsewhere");
      await noOverflow();
      await content.getByRole("tab", { name: "Teams", exact: true }).click();
      await expect(content.getByRole("list", { name: "Crews" }).getByRole("listitem")).toHaveCount(
        2,
      );
      await shot("teams-cards");
      // Two crews need no filter or layout switch.
      await expect(content.getByRole("radio", { name: "List", exact: true })).toHaveCount(0);
      await noOverflow();
      await content.getByRole("tab", { name: "Members", exact: true }).click();
      await expect(content.getByText("Researcher", { exact: true })).toBeVisible();
      await shot("members");
      await content.getByRole("button", { name: "Teams of UI designer", exact: true }).click();
      await expect(page.getByRole("menu", { name: "Teams of UI designer" })).toBeVisible();
      await shot("members-teams-menu");
      await page.keyboard.press("Escape");
      await noOverflow();
      await content.getByRole("tab", { name: "Work", exact: true }).click();
      await content.getByRole("radio", { name: "Finished", exact: true }).click();
      await content.getByRole("button", { name: /^Audit landing page/ }).click();
      const run = content.locator('[data-crew-run="old-run"]');
      await expect(run.getByRole("region", { name: "Work summary" })).toBeVisible();
      const history = run.locator("summary").filter({ hasText: /^History/ });
      await history.evaluate((node) => node.scrollIntoView({ block: "start" }));
      await shot("work-finished");
      await noOverflow();
      await content.getByRole("tab", { name: "Teams", exact: true }).click();
      await openCrewEditorFromTeam(page, "Website Crew");
      const dialog = crewEditor(page);
      // A member that no longer follows its library profile shows a quiet icon, not a badge.
      await expect(
        dialog.getByRole("img", { name: "Not following library profile" }).first(),
      ).toBeVisible();
      await expect(dialog.getByText("Customized", { exact: true })).toHaveCount(0);
      await shot("crew-editor");
      await shot("edit-crew-members");
      await dialog.getByRole("button", { name: /^UI/ }).first().click();
      // The handle sits behind the member's More options.
      await dialog
        .locator("summary")
        .filter({ hasText: /^More options/ })
        .first()
        .click();
      await expect(dialog.getByRole("textbox", { name: /^Handle/ })).toBeVisible();
      await dialog
        .getByRole("textbox", { name: "Instructions", exact: true })
        .scrollIntoViewIfNeeded();
      await shot("member-form");
      await shot("member-detail");
      await dialog.getByRole("textbox", { name: /^Handle/ }).scrollIntoViewIfNeeded();
      await shot("member-form-identity");
      await noOverflow();
      // This Host reports only legacy pools, so there is no model order to open from the crew; the
      // link to it is covered where the Host reports routing (access is set once for every member).
      await shot("models-tab");
      await page.keyboard.press("Escape");
      // Members tab: the whole list is one page scroll, not an inner scroll box.
      await openCrewsTab(page, "Members");
      await expect(content.getByText("Researcher", { exact: true })).toBeVisible();
      await content.getByRole("tabpanel").evaluate((node) => {
        let current: Element | null = node;
        while (current) {
          current.scrollTop = current.scrollHeight;
          current = current.parentElement;
        }
      });
      await shot("members-bottom");
      // This Host reports only legacy pools, so the current shared choice uses its fixed fallback.
      await content
        .locator(".settings-collection-row")
        .filter({ hasText: "Triage engineer" })
        .getByRole("button", { name: /^Edit / })
        .click();
      const profile = page.getByRole("dialog", { name: "Triage engineer", exact: true });
      await expect(profile).toBeVisible();
      await shot("profile-top");
      await expect(
        profile.getByRole("radiogroup", { name: "Model choice", exact: true }),
      ).toHaveCount(0);
      // The saved model is not in the loaded catalog, so the picker shows the catalog default.
      const fallback = profile.getByRole("button", { name: "Codex Codex fixture", exact: true });
      await expect(fallback).toBeVisible();
      await fallback.scrollIntoViewIfNeeded();
      await shot("profile-model-pool");
      await profile
        .locator("summary")
        .filter({ hasText: /^More options/ })
        .click();
      await profile.getByText("Tools", { exact: true }).first().scrollIntoViewIfNeeded();
      const tools = profile.getByRole("group", { name: "Tool profile", exact: true });
      await expect(tools.getByRole("radio", { name: /^Full access/ })).toBeChecked();
      await expect(tools.getByRole("radio")).toHaveCount(5);
      const customTools = tools.getByRole("radio", { name: /^Custom/ });
      await customTools.focus();
      await customTools.press("Space");
      await expect(customTools).toBeChecked();
      await expect(profile.getByRole("button", { name: /^Host tools:/ })).toBeVisible();
      await expect(profile.getByRole("button", { name: /^MCP servers:/ })).toBeVisible();
      await expect(profile.getByRole("button", { name: /^Skills:/ })).toBeVisible();
      await shot("profile-tools");
      const fullTools = tools.getByRole("radio", { name: /^Full access/ });
      await fullTools.focus();
      await fullTools.press("Space");
      await expect(fullTools).toBeChecked();
      await expect(profile.getByRole("button", { name: /^Host tools:/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(content.getByRole("tab", { name: "Models", exact: true })).toHaveCount(0);
      await noOverflow();
      // New work dialog: the task form fits and its project select lists existing projects.
      const start = await openStart(page);
      await expect(start).toBeVisible();
      await shot("new-work");
      await start
        .getByRole("button", { name: /crew-project/ })
        .first()
        .click();
      await expect(page.getByRole("listbox", { name: "Project" })).toBeVisible();
      await shot("new-work-project-select");
      await noOverflow();
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [800, 1280]) {
    test(`visual callers crews ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(90_000);
      page.setDefaultTimeout(10_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const shot = async (state: string) =>
        page.screenshot({
          path: `temp/verification/visual-callers-crews/${state}-${theme}-${width}.png`,
        });
      await page.goto(`/tests/browser/crews/crews.html?rich&theme=${theme}`);
      await openCrewsTab(page, "Members");
      await expect(page.locator(".settings-collection").first()).toBeVisible();
      await shot("library");
      await editCrew(page);
      const dialog = crewEditor(page);
      // A short roster has no selection column or bulk bar.
      await expect(dialog.getByRole("checkbox", { name: "Select all", exact: true })).toHaveCount(
        0,
      );
      await expect(dialog.getByText("All changes saved", { exact: true })).toBeVisible();
      await shot("editor");
      await dialog.getByRole("button", { name: /^UI/ }).click();
      const member = dialog.getByRole("textbox", { name: "Member name", exact: true });
      await expect(member).toBeVisible();
      await member.scrollIntoViewIfNeeded();
      await shot("member-identity");
      await dialog
        .getByRole("textbox", { name: "Instructions", exact: true })
        .scrollIntoViewIfNeeded();
      await shot("member-form");
      // Reviews load when the member's More options first open.
      await dialog
        .locator("summary")
        .filter({ hasText: /^More options/ })
        .first()
        .click();
      await expect(
        dialog.getByText("Unsupported fixture operation remote_request", { exact: true }),
      ).toBeVisible();
      const error = dialog
        .getByRole("alert")
        .filter({ hasText: "Unsupported fixture operation remote_request" });
      await expect(error).toHaveCount(1);
      await expect(error.locator("svg")).toHaveCount(1);
      await error.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(error).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as unknown as { crewFixtureOperations: string[] }
              ).crewFixtureOperations.filter((method) => method === "crews.inspect").length,
          ),
        )
        .toBe(2);
      await shot("performance-error");
      await dialog
        .getByRole("button", { name: "Codex Codex fixture", exact: true })
        .last()
        .scrollIntoViewIfNeeded();
      await shot("member-model");
      await dialog.getByRole("button", { name: "Crew icon and color", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "Crew icon and color", exact: true }),
      ).toBeVisible();
      await shot("appearance");
      await page.keyboard.press("Escape");
      await dialog.getByRole("button", { name: "Add members", exact: true }).click();
      await expect(dialog.getByRole("tablist", { name: "Add from", exact: true })).toBeVisible();
      await shot("member-picker");
      await page.goto(`/tests/browser/crews/crews.html?rich&multiple&theme=${theme}`);
      const work = await openWork(page);
      const composer = work.getByRole("textbox", { name: /Message/ }).first();
      await expect(composer).toBeVisible();
      await composer.scrollIntoViewIfNeeded();
      await shot("owner-actions");
      await page.goto(`/tests/browser/crews/crews.html?rich&multiple&theme=${theme}`);
      const content = await openCrewsTab(page, "Work");
      await content.getByRole("radio", { name: "Finished", exact: true }).click();
      await content.getByRole("button", { name: /^Audit landing page/ }).click();
      const summary = content.getByRole("region", { name: "Work summary", exact: true });
      await expect(summary).toBeVisible();
      await summary.scrollIntoViewIfNeeded();
      await shot("work-summary");
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [800, 1280]) {
    test(`visual callers crews feedback ${theme} ${width}`, async ({ page }) => {
      test.setTimeout(90_000);
      page.setDefaultTimeout(10_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const shot = async (state: string) =>
        page.screenshot({
          path: `temp/verification/visual-callers-crews/${state}-${theme}-${width}.png`,
        });
      await page.goto(`/tests/browser/crews/crews.html?longRoster&saveError&theme=${theme}`);
      await editCrew(page);
      let dialog = crewEditor(page);
      const search = dialog.getByRole("textbox", {
        name: "Search members by name, role, model or group",
        exact: true,
      });
      await search.fill("unmatched-fixture-member");
      await expect(dialog.getByText("No matching members", { exact: true })).toHaveCount(4);
      await expect(dialog.getByText("No matching members", { exact: true }).first()).toBeVisible();
      await shot("roster-empty");
      await dialog
        .getByRole("textbox", { name: "Crew name", exact: true })
        .fill("Fixture draft preserved");
      await expect(dialog.getByText("Could not save the crew.")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
      await shot("footer-error");
      await page.goto(`/tests/browser/crews/crews.html?library=empty&theme=${theme}`);
      await editCrew(page);
      dialog = crewEditor(page);
      await dialog.getByRole("button", { name: "Add members", exact: true }).click();
      await dialog.getByRole("tab", { name: /^Library/ }).click();
      await expect(dialog.getByText("Your member library is empty", { exact: true })).toBeVisible();
      await shot("picker-empty");
      await page.goto(`/tests/browser/crews/crews.html?failOperation=crews.request&theme=${theme}`);
      const work = await openWork(page);
      await work.getByRole("textbox", { name: "Message", exact: true }).fill("Fixture owner note");
      await work.getByRole("button", { name: "Send", exact: true }).click();
      await expect(
        work.getByText("The Host could not complete this action. Try again in a moment."),
      ).toBeVisible();
      await expect(work.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
        "Fixture owner note",
      );
      await shot("owner-error");
    });
  }
}

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`shared static consumers ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/crews/crews.html?shared-static-fixture&theme=${theme}`);
      const faces = page.getByRole("img").first();
      await expect(faces).toBeVisible();
      const dot = page.locator("[data-account-color]");
      await expect(dot).toHaveCSS("width", "8px");
      await page.screenshot({
        path: `temp/verification/2026-10-25-crew-management-v2/shared-static-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`shared settings boundaries ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/crews/crews.html?shared-settings-fixture&theme=${theme}`);
      const first = page.getByText("Fixture agent A", { exact: true });
      const second = page.getByText("Fixture agent B", { exact: true });
      await expect(first).toBeVisible();
      await expect(second).toBeVisible();
      for (const node of [first, second])
        await expect(node.locator("../..")).toHaveCSS("border-bottom-width", "1px");
      // The scan options open in a dialog; its footer carries the scan action.
      await page.getByRole("button", { name: "Scan settings", exact: true }).click();
      const scan = page
        .getByRole("dialog", { name: "Scan settings", exact: true })
        .getByRole("button", { name: "Scan with these settings" });
      await expect(scan).toBeEnabled();
      await expect(scan.locator("xpath=ancestor::footer[1]")).toHaveCSS("border-top-width", "1px");
      await page.screenshot({
        path: `temp/verification/2026-10-25-crew-management-v2/shared-settings-${theme}-${width}.png`,
        animations: "disabled",
      });
      await scan.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/2026-10-25-crew-management-v2/shared-scan-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`current crew work list ground ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/crews/crews.html?manyRuns&theme=${theme}`);
      const dialog = await openCrewsTab(page, "Work");
      const list = dialog.getByRole("list", { name: "Work list", exact: true });
      await expect(list).toBeVisible();
      await expect(dialog.getByRole("navigation", { name: "Crew work", exact: true })).toHaveCount(
        0,
      );
      await expect(list.locator("xpath=..")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      expect(await list.getByRole("listitem").count()).toBeGreaterThan(2);
      await page.screenshot({
        path: `temp/verification/crew-work-current/list-${theme}-${width}.png`,
      });
      const item = list.getByRole("button", { name: /^Work item 3/ });
      await item.click();
      await expect(dialog.locator('[data-crew-run="many-2"]')).toBeVisible();
      if (!(await list.isVisible()))
        await dialog.getByRole("button", { name: "Back to work list", exact: true }).click();
      await expect(item).toHaveAttribute("aria-current", "true");
      await page.screenshot({
        path: `temp/verification/crew-work-current/selected-${theme}-${width}.png`,
      });
    });
  }
