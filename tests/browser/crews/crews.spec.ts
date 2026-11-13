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
      await expect(collection).toHaveCSS("border-top-width", "0px");
      await expect(collection).toHaveCSS("border-top-left-radius", "7px");
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
      const project = management.getByRole("button", {
        name: "Project: crew-project",
        exact: true,
      });
      await expect(project).toBeVisible();
      const before = await project.boundingBox();
      await project.click();
      const option = page
        .getByRole("option")
        .filter({ hasText: "accessibility-review-and-implementation" });
      await expect(option).toBeVisible();
      const bounds = await option.boundingBox();
      expect(bounds!.height).toBeLessThan(65);
      expect(bounds!.width).toBeGreaterThan(before!.width);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `temp/verification/2026-11-11-crew-pickers/picker-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "New project…", exact: true }).click();
      const create = page.getByRole("dialog", { name: "Create project", exact: true });
      await expect(
        create.getByRole("textbox", { name: "Project name", exact: true }),
      ).toBeFocused();
      await expect(create.getByText("Created in C:/fixture", { exact: true })).toBeVisible();
      await expect(
        create.getByRole("button", { name: "Create project", exact: true }),
      ).toBeDisabled();
      expect(await project.boundingBox()).toEqual(before);
      await page.screenshot({
        path: `temp/verification/2026-11-11-crew-pickers/create-${theme}-${width}.png`,
      });
      await create.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(create).toHaveCount(0);
      await expect(management).toBeVisible();
      await page.keyboard.press("Escape");
      const start = await openStart(page);
      await start.getByRole("button", { name: "Project: crew-project", exact: true }).click();
      await expect(option).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-11-crew-pickers/new-work-picker-${theme}-${width}.png`,
      });
      await page.getByRole("button", { name: "New project…", exact: true }).click();
      await expect(create).toBeVisible();
      await page.screenshot({
        path: `temp/verification/2026-11-11-crew-pickers/new-work-create-${theme}-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(create).toHaveCount(0);
      await expect(start).toBeVisible();
    });
  }
}

test("project creation retains invalid and failed drafts then selects created project", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?failOperation=projects.createDirectory");
  const management = await openWork(page);
  const project = management.getByRole("button", {
    name: "Project: crew-project",
    exact: true,
  });
  await project.click();
  await page.getByRole("button", { name: "New project…", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create project", exact: true });
  const name = create.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("../../invalid");
  await create.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(create.getByRole("alert")).toContainText(
    "Use a folder name without slashes or special characters.",
  );
  await name.fill("new-project");
  await create.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(create.getByRole("alert")).toContainText(
    "The Host could not complete this action. Try again in a moment.",
  );
  await expect(name).toHaveValue("new-project");
  await create.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(management).toBeVisible();
  await page.goto("/tests/browser/crews/crews.html");
  const next = await openWork(page);
  await next.getByRole("button", { name: "Project: crew-project", exact: true }).click();
  await page.getByRole("button", { name: "New project…", exact: true }).click();
  await name.fill("new-project");
  await create.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(create).toHaveCount(0);
  await expect(
    next.getByRole("button", { name: "Project: new-project", exact: true }),
  ).toBeVisible();
});

type CrewsTab = "Active" | "Teams" | "Members" | "Work";

/** Opens the Crews page on a tab; the fixture has no app shell, so a button mounts the page. */
async function openCrewsTab(page: Page, tab: CrewsTab) {
  await page.getByRole("button", { name: "Crews page", exact: true }).click();
  const content = page.locator("[data-app-crews]");
  await content.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
  await expect(content.getByRole("tabpanel")).toBeVisible();
  return content;
}

/** Opens a saved crew's editor from its card on the Teams tab. */
async function editCrew(page: Page, name = "Website Crew") {
  await openCrewsTab(page, "Teams");
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
}

async function openStart(page: Page) {
  const row = page.getByRole("listitem").filter({ hasText: "Website Crew" });
  await row.getByRole("button", { name: "New work with Website Crew" }).click();
  return page.getByRole("dialog", { name: "New work", exact: true });
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

test("partial library group updates retry only the remaining profiles", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?groupRetry");
  await openCrewsTab(page, "Members");
  await page.getByRole("button", { name: /^Member group:/ }).click();
  await page.getByRole("option", { name: "UI", exact: true }).click();
  await page.getByRole("button", { name: "Group options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename group", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Rename group",
    exact: true,
  });
  await dialog.getByRole("textbox", { name: "Group name", exact: true }).fill("Interface");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Second profile unavailable");
  await expect(dialog.getByRole("textbox", { name: "Group name", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const snapshot = await page.evaluate(() =>
    (
      window as unknown as {
        crewFixtureSnapshot: () => {
          agents: { id: string; groups: string[] }[];
          agentSaveCounts: Record<string, number>;
        };
      }
    ).crewFixtureSnapshot(),
  );
  expect(snapshot.agents.every((agent) => agent.groups.includes("Interface"))).toBe(true);
  expect(snapshot.agentSaveCounts["lib-ui"]).toBe(1);
  expect(snapshot.agentSaveCounts["lib-api"]).toBe(2);
});

test("library copy reconciles an uncertain saved profile without a second save", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?copyUnknown");
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
  expect(snapshot.agents).toHaveLength(3);
  expect(Object.values(snapshot.agentSaveCounts)).toEqual([1]);
});

test("model catalog failure leaves existing work controls and sessions usable", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?catalogUnavailable");
  const management = await openWork(page);
  await expect(
    management.getByRole("status").filter({ hasText: "Model catalog temporarily unavailable" }),
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

test("navigation failure retries opening the acknowledged run without starting twice", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?openFailsOnce");
  const start = await openStart(page);
  await start
    .getByRole("textbox", { name: "What should the crew deliver?" })
    .fill("Review mobile navigation");
  await start.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    start.getByText("Conversation temporarily unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Started work")).toHaveText("1");
  await start.getByRole("button", { name: "Open conversation", exact: true }).click();
  await expect(start).toHaveCount(0);
  await expect(page.getByLabel("Opened session")).toHaveText("started-1");
  await expect(page.getByLabel("Started work")).toHaveText("1");
});

test("uncertain start keeps its receipt when closed and reopened", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?startUnknownOnce");
  let start = await openStart(page);
  await start
    .getByRole("textbox", { name: "What should the crew deliver?" })
    .fill("Review mobile navigation");
  await start.getByRole("button", { name: "Start", exact: true }).click();
  await expect(start.getByText("Start response unavailable. Delivery unknown.")).toBeVisible();
  await start.getByRole("button", { name: "Close", exact: true }).click();
  start = await openStart(page);
  await expect(start.getByRole("textbox", { name: "What should the crew deliver?" })).toHaveValue(
    "Review mobile navigation",
  );
  await start.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByLabel("Opened session")).toHaveText("started-1");
  await expect(page.getByLabel("Started work")).toHaveText("1");
  const ids = await page.evaluate(
    () =>
      (window as unknown as { crewFixtureStartRequestIds: string[] }).crewFixtureStartRequestIds,
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

test("work stays selected when a poll moves it to finished history", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?multiple");
  const management = await openWork(page);
  await page.evaluate(() =>
    (window as unknown as { simulateRunFinish: (id: string) => void }).simulateRunFinish("run"),
  );
  await expect(management.getByRole("radio", { name: "Finished", exact: true })).toBeChecked({
    timeout: 12000,
  });
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

test("the start dialog saves a changed crew access before it starts the work", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  const start = await openStart(page);
  await expect(start.getByText("Access for every member", { exact: true })).toBeVisible();
  await start.getByRole("button", { name: "Supervised", exact: true }).click();
  await page.getByRole("option", { name: /Auto-accept edits/ }).click();
  await start
    .getByRole("textbox", { name: "What should the crew deliver?" })
    .fill("Review mobile navigation");
  await start.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByLabel("Started work")).toHaveText("1");
  const calls = await page.evaluate(
    () => (window as unknown as { crewFixtureOperations: string[] }).crewFixtureOperations,
  );
  expect(calls.filter((call) => call === "crews.save" || call === "crews.start")).toEqual([
    "crews.save",
    "crews.start",
  ]);
});

test("an externally deleted crew cannot start new work", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  const start = await openStart(page);
  await start
    .getByRole("textbox", { name: "What should the crew deliver?" })
    .fill("Keep my request");
  await page.evaluate(() =>
    (window as unknown as { simulateCrewDelete: () => void }).simulateCrewDelete(),
  );
  await expect(start.getByText("This crew is no longer available.")).toBeVisible({
    timeout: 12000,
  });
  await expect(start.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await start.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByLabel("Started work")).toHaveText("0");
});

test("deleted crew edits can be preserved under a new identity", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  const start = await openStart(page);
  await start.getByRole("button", { name: "Edit crew", exact: true }).click();
  const edit = editor(page);
  await edit
    .getByRole("textbox", { name: "Crew name", exact: true })
    .fill("Website Crew local edits");
  await page.evaluate(() =>
    (window as unknown as { simulateCrewDelete: () => void }).simulateCrewDelete(),
  );
  await expect(edit.getByText("This crew is no longer available.")).toBeVisible({ timeout: 12000 });
  await expect(edit.getByRole("button", { name: "New work", exact: true })).toBeDisabled();
  await edit.getByRole("button", { name: "Keep edits as new crew", exact: true }).click();
  await expect(edit.getByRole("textbox", { name: "Crew name", exact: true })).toHaveValue(
    "Website Crew local edits",
  );
  await edit.getByRole("button", { name: "Create crew", exact: true }).click();
  await expect(edit.getByText("Crew created", { exact: true })).toBeVisible();
  await expect(edit.getByRole("button", { name: "New work", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Started work")).toHaveText("0");
});

test("start work sends the pending edit first and shows progress only in its own action", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html?slowOperation=crews.save");
  const start = await openStart(page);
  await start.getByRole("button", { name: "Edit crew", exact: true }).click();
  const edit = editor(page);
  await edit.getByRole("textbox", { name: "Crew name", exact: true }).fill("Website Crew revised");
  // There is no Save button for a stored crew: it saves itself, and New work flushes first.
  await expect(edit.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(edit.getByRole("button", { name: "Discard", exact: true })).toHaveCount(0);
  const startWork = edit.getByRole("button", { name: "New work", exact: true });
  await startWork.click();
  await expect(startWork).toHaveAttribute("aria-busy", "true");
  await expect(edit.getByRole("button", { name: "Close", exact: true })).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.evaluate(() =>
    (
      window as unknown as { crewFixtureReleaseOperation: () => void }
    ).crewFixtureReleaseOperation(),
  );
  await expect(page.getByRole("dialog", { name: "New work", exact: true })).toBeVisible();
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
  await expect(work.getByRole("button", { name: "Stop work", exact: true })).toHaveAttribute(
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
    const pause = management.getByRole("button", {
      name: "Pause new assignments",
      exact: true,
    });
    await pause.focus();
    await pause.press("Enter");
    await expect(pause).toHaveAttribute("aria-busy", "true");
    await expect(pause).toBeFocused();
    await expect(
      management.getByRole("button", { name: "Stop work", exact: true }),
    ).not.toHaveAttribute("aria-busy", "true");
    // The running action is named beside its controls, not only by a spinner.
    await expect(management.getByRole("status").filter({ hasText: "Pausing…" })).toBeVisible();
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
async function openWork(page: Page, runId = "run") {
  await page.locator(`[data-crew-work-link="${runId}"]`).click();
  const dialog = page.getByRole("dialog", {
    name: "Website Crew",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function deleteSelectedWork(_page: Page, work: ReturnType<Page["locator"]>) {
  await work.getByRole("button", { name: "Delete work", exact: true }).click();
}
const editor = (page: Page) => page.getByRole("dialog", { name: /New crew|Website Crew|Mobile/ });
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
    await page.getByRole("button", { name: "Edit bycoda Product Team", exact: true }).click();
    const team = page.getByRole("dialog", {
      name: "bycoda Product Team",
      exact: true,
    });
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
      /EXPLAIN ANALYZE executes statements/,
    );
    // Rows open in place: opening another member closes the first and nothing navigates away.
    await expect(team.getByRole("button", { name: "Back to team" })).toHaveCount(0);
    await team.getByRole("button", { name: /^Mobile Engineer / }).click();
    await expect(team.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(
      /intermittent connectivity/,
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
    await page.getByRole("button", { name: "Edit bycoda Product Team", exact: true }).click();
    const saved = page.getByRole("dialog", {
      name: "bycoda Product Team",
      exact: true,
    });
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
  await expect(dialog.getByRole("region", { name: "Specialists" })).toContainText("Fixture");
  await page.screenshot({
    path: `${shots}/create-${testInfo.project.name}.png`,
  });
  // Several library members are added in one step; groups filter the list.
  await dialog.getByRole("button", { name: "Add members", exact: true }).click();
  await expect(dialog.getByRole("tab", { name: "Library (2)" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dialog.getByRole("textbox", { name: "Search name, role, model or group" }).fill("designer");
  await dialog.getByRole("checkbox").first().check();
  await dialog.getByRole("textbox", { name: "Search name, role, model or group" }).fill("");
  await dialog.getByLabel("API engineer").check();
  await page.screenshot({
    path: `${shots}/add-members-${testInfo.project.name}.png`,
  });
  await page.getByRole("button", { name: "Add 2 members" }).click();
  const specialists = dialog.getByRole("region", { name: "Specialists" });
  await expect(specialists.getByRole("button", { name: /^UI designer/ })).toBeVisible();
  await expect(specialists.getByRole("button", { name: /^API engineer/ })).toBeVisible();
  await page.getByRole("button", { name: "Create crew" }).click();
  await expect(page.getByText("Crew created", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Mobile" })).toBeVisible();
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
  // The role name is the owner's own; suggestions follow the chosen responsibility.
  const coordinator = dialog
    .getByRole("group", { name: "Responsibility in the crew" })
    .getByRole("radio", { name: "Coordinator" });
  await coordinator.focus();
  await coordinator.press("Space");
  await expect(coordinator).toBeChecked();
  await expect(
    dialog.getByText("Plans the work and hands out assignments. A crew has one."),
  ).toHaveCount(0);
  await dialog
    .getByRole("group", { name: "Suggested roles" })
    .getByRole("button", { name: "Project lead" })
    .click();
  await expect(dialog.getByRole("textbox", { name: "Member name" })).toHaveValue("Project lead");
  await dialog.getByRole("textbox", { name: "Member name" }).fill("Mobile release lead");
  await dialog.getByLabel("Also save to member library").check();
  const allProjects = dialog
    .getByRole("group", { name: "Library availability" })
    .getByRole("radio", { name: "All projects" });
  await allProjects.focus();
  await allProjects.press("Space");
  await expect(allProjects).toBeChecked();
  await page.getByRole("button", { name: "Add to crew" }).click();
  await expect(dialog.getByRole("region", { name: "Coordinator" })).toContainText(
    "Mobile release lead",
  );
  await expect(dialog.getByText("Add a reviewer.").first()).toBeVisible();
  await expect(dialog.getByText("Add at least one specialist.").first()).toBeVisible();
  // The saved profile is now in the library for every project on this host.
  await dialog.getByRole("button", { name: "Add reviewer" }).click();
  await expect(dialog.getByRole("tab", { name: "Library (1)" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByText("Added members join as Reviewer.")).toBeVisible();
});
test("opens ongoing work from the rail and keeps the delivery while editing the crew", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews/crews.html");
  const row = page.getByRole("listitem").filter({ hasText: "Website Crew" });
  await row.getByRole("button", { name: /Website Crew, Needs decision/ }).click();
  const workDialog = page.getByRole("dialog", { name: "Website Crew" });
  await expect(workDialog).toBeVisible();
  await workDialog
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /Coordinator/ })
    .click();
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
  await row.hover();
  await row.getByRole("button", { name: "New work with Website Crew" }).click();
  const start = page.getByRole("dialog", { name: "New work" });
  // Check the exposed roster, not BadgeList's inert, aria-hidden measurement probes.
  const roster = start.locator("dl");
  await expect(roster.locator("dt")).toHaveText(["Coordinator:", "Specialist:", "Reviewer:"]);
  await expect(roster.locator("dd")).toHaveCount(3);
  // Every member is listed with its face, also one named like its responsibility.
  await expect(
    roster.getByRole("list", { name: "Coordinator", exact: true }).getByRole("listitem"),
  ).toHaveText(["Coordinator"]);
  await expect(
    roster.getByRole("list", { name: "Reviewer", exact: true }).getByRole("listitem"),
  ).toHaveText(["Reviewer"]);
  const specialists = roster.getByRole("list", {
    name: "Specialist",
    exact: true,
  });
  await expect(specialists.getByRole("listitem")).toHaveText(["UI"]);
  await expect(specialists.getByRole("button")).toHaveCount(0);
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
        await expect(specialists.getByRole("listitem")).toHaveText(["UI"]);
        await expect(specialists.getByRole("button")).toHaveCount(0);
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
  await start
    .getByRole("textbox", { name: "What should the crew deliver?" })
    .fill("Mobile sign-in");
  await start.getByRole("button", { name: "Edit crew" }).click();
  await expect(page.getByRole("dialog", { name: "Website Crew" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(start.getByRole("textbox", { name: "What should the crew deliver?" })).toHaveValue(
    "Mobile sign-in",
  );
  await start.getByRole("button", { name: "Start", exact: true }).dblclick();
  await expect(page.getByLabel("Opened session")).toHaveText("started-1");
  await expect(page.getByLabel("Started work")).toHaveText("1");
});
test("the crew menu offers start, edit, copy and explicit work controls", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  const row = page.getByRole("listitem").filter({ hasText: "Website Crew" });
  await row.hover();
  await row.getByRole("button", { name: "Website Crew options" }).click();
  const menu = page.getByRole("menu", { name: "Website Crew options" });
  for (const name of [
    "New work",
    "Edit crew",
    "Add members",
    "Duplicate",
    "Copy to all projects",
    "Delete crew",
  ])
    await expect(menu.getByRole("menuitem", { name: new RegExp(name) })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Stop work|Pause new assignments/ })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  await work.getByRole("button", { name: "Pause new assignments" }).click();
  await expect(work.getByRole("button", { name: "Resume work" })).toBeVisible();
  await management.getByRole("button", { name: "Close", exact: true }).click();
  await row.hover();
  await row.getByRole("button", { name: "Website Crew options" }).click();
  await page.getByRole("menuitem", { name: /Delete crew/ }).click();
  await expect(page.getByRole("dialog", { name: "Delete Website Crew?" })).toContainText(
    "Library members are kept",
  );
});
test("compact work list opens selected work with visible conversations", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews/crews.html");
  const compact = page.locator('[data-crew-work-link="run"]');
  await expect(compact).toContainText("Build settings page");
  await expect(compact.getByRole("button", { name: "Stop work" })).toHaveCount(0);
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  await expect(work).toContainText("Build settings page");
  await expect(work.getByText("Needs decision", { exact: true })).toBeVisible();
  await expect(work).toContainText("0/1 tasks");
  await expect(work).toContainText("Need image generation for the hero");
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
  await expect(management).not.toBeVisible();
  const reopened = await openWork(page);
  await reopened
    .locator('[data-crew-run="run"]')
    .getByRole("button", { name: /Reviewer.*Build settings/ })
    .click();
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
test("work management returns from crew editing without starting another delivery", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html");
  const management = await openWork(page);
  await management.getByRole("button", { name: "Edit crew", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Website Crew", exact: true });
  await expect(form.getByRole("textbox", { name: "Crew name" })).toBeVisible();
  await form.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Website Crew", exact: true })
      .locator('[data-crew-run="run"]'),
  ).toBeVisible();
  await expect(page.getByLabel("Started work")).toHaveText("0");
});

test("one manager selects ongoing and finished work without mixing conversations", async ({
  page,
}, testInfo) => {
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
test("editing is one page: roster first, advanced settings one disclosure away, and fits narrow windows", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews/crews.html?theme=light");
  await editCrew(page);
  const dialog = page.getByRole("dialog", { name: "Website Crew" });
  await expect(dialog.getByRole("region", { name: "Coordinator" })).toBeVisible();
  await dialog.getByRole("button", { name: "UI", exact: true }).click();
  // The expanded member uses the same provider/model picker as the roster.
  const editedMember = dialog.getByRole("listitem").filter({
    has: page.getByRole("textbox", { name: "Member name", exact: true }),
  });
  await expect(
    editedMember.getByRole("button", { name: "Codex Fixture", exact: true }).last(),
  ).toBeVisible();
  await expect(dialog.getByText("Owner quality estimate")).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Member name" }).fill("Frontend");
  await dialog.getByRole("textbox", { name: "Groups" }).fill("Web");
  await dialog.getByRole("textbox", { name: "Groups" }).press("Enter");
  await dialog.getByRole("button", { name: "Save to library" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to member library" }),
  ).toBeVisible();
  // Members open in place on the same page: there is no member page to return from.
  await expect(dialog.getByRole("button", { name: "Back to team" })).toHaveCount(0);
  await expect(dialog.getByRole("radio", { name: "Working settings" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^Frontend/ })).toBeVisible();
  await dialog
    .locator("summary")
    .filter({ hasText: /^Advanced$/ })
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
  await page.getByRole("button", { name: /Run with:/ }).click();
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
  await page.goto("/tests/browser/crews/crews.html?multiple");
  await page
    .getByRole("region", { name: "Crew work", exact: true })
    .getByRole("button", { name: "Manage", exact: true })
    .click();
  const management = page.getByRole("dialog", {
    name: "Website Crew",
    exact: true,
  });
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

test("the crew card menu opens the selected work's conversation", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  const content = await openCrewsTab(page, "Teams");
  // Crew work sits in the crew card's overflow menu beside the direct Edit action.
  await content.getByRole("button", { name: "Website Crew options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Crew work", exact: true }).click();
  const management = page.getByRole("dialog", {
    name: "Website Crew",
    exact: true,
  });
  await management
    .locator('[data-crew-run="run"]')
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /Coordinator/ })
    .click();
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
  await expect(management).toHaveCount(0);
});

test("a single piece of work needs no list column", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?singleRun");
  const management = await openWork(page);
  await expect(management.locator('[data-crew-run="run"]')).toBeVisible();
  await expect(management.getByRole("list", { name: "Work list", exact: true })).toHaveCount(0);
  await expect(management.getByRole("button", { name: "Back to work list" })).toHaveCount(0);
  await expect(management.getByRole("button", { name: "Edit crew", exact: true })).toBeVisible();
});

test("narrow windows show the work list or one work at a time", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/crews/crews.html?manyRuns");
  await page
    .getByRole("region", { name: "Crew work", exact: true })
    .getByRole("button", { name: "Manage", exact: true })
    .click();
  const management = page.getByRole("dialog", {
    name: "Website Crew",
    exact: true,
  });
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
    "aria-pressed",
    "true",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("wide windows keep the work list beside the selected work", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?manyRuns");
  const management = await openWork(page);
  await expect(management.getByRole("list", { name: "Work list", exact: true })).toBeVisible();
  await expect(management.locator('[data-crew-run="run"]')).toBeVisible();
  await expect(management.getByRole("button", { name: "Back to work list" })).toBeHidden();
  // The work opened from the sidebar is the selected row even when it sits far down the list.
  await expect(management.locator('[data-crew-work-choice="run"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("access is set once for every member, model rules open on demand, and edits autosave", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/crews.html");
  await editCrew(page);
  const dialog = page.getByRole("dialog", { name: "Website Crew" });
  // Access for the whole crew is one row at the top of the page, not inside Advanced.
  const access = dialog.getByRole("region", {
    name: "Access for every member",
  });
  await expect(access.getByRole("button", { name: "Supervised", exact: true })).toBeVisible();
  await access.getByRole("button", { name: "Supervised", exact: true }).click();
  await page.getByRole("option", { name: /Auto-accept edits/ }).click();
  await expect(
    access.getByRole("button", { name: "Auto-accept edits", exact: true }),
  ).toBeVisible();
  await access.getByRole("switch", { name: "Coordinator answers permission requests" }).click();
  await expect(dialog.getByText("All changes saved", { exact: true })).toBeVisible();
  await dialog
    .locator("summary")
    .filter({ hasText: /^Advanced$/ })
    .last()
    .click();
  // Shared model rules live in Models; the crew keeps its execution limits here.
  await page.evaluate(() => {
    const tabs: string[] = [];
    (window as Window & { crewModelsTabs?: string[] }).crewModelsTabs = tabs;
    window.addEventListener("bycoda:open-models-settings", (event) => {
      tabs.push((event as CustomEvent<string>).detail);
    });
  });
  await dialog
    .getByRole("region", { name: "Models", exact: true })
    .getByRole("button", { name: "Manage in Models", exact: true })
    .click();
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
  await page.getByRole("button", { name: "Edit Website Crew", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "Website Crew" });
  await expect(
    reopened
      .getByRole("region", { name: "Access for every member" })
      .getByRole("button", { name: "Auto-accept edits", exact: true }),
  ).toBeVisible();
  await expect(
    reopened.getByRole("switch", {
      name: "Coordinator answers permission requests",
    }),
  ).toBeChecked();
});

test("an unsupported Host hides the access picker but keeps the grants", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?noAccess");
  await editCrew(page);
  const access = page
    .getByRole("dialog", { name: "Website Crew" })
    .getByRole("region", { name: "Access for every member" });
  await expect(access.getByRole("button", { name: "Supervised", exact: true })).toHaveCount(0);
  await expect(
    access.getByRole("switch", {
      name: "Coordinator answers permission requests",
    }),
  ).toBeVisible();
});

test("one model with its options can be applied to chosen members at once", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  await editCrew(page);
  const dialog = page.getByRole("dialog", { name: "Website Crew" });
  const apply = dialog.getByRole("button", { name: /^Apply to / });
  // The bar offers a real model from the start, so Apply is ready.
  await expect(apply).toBeEnabled();
  await dialog.getByRole("checkbox", { name: "Select UI" }).check();
  await expect(apply).toHaveText("Apply to 1 member");
  await dialog.getByRole("checkbox", { name: "Select all" }).check();
  await expect(apply).toHaveText(/^Apply to \d+ members$/);
  await apply.click();
  await expect(dialog.getByText(/^Applied .* to \d+ members\.$/)).toBeVisible();
});

test("a failed save stays visible, keeps the draft and starts nothing", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?saveError&longRoster");
  await editCrew(page);
  const dialog = page.getByRole("dialog", { name: "Website Crew" });
  await dialog.getByRole("textbox", { name: "Crew name", exact: true }).fill("Website Crew v2");
  // The autosave fails: the error and Retry stay in the footer, the draft stays as typed.
  await expect(
    dialog.getByText("The Host rejected this crew: storage is read-only right now."),
  ).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
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
  const dialog = page.getByRole("dialog", { name: "Website Crew" });
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
      await page.goto(`/tests/browser/crews/crews.html?theme=${theme}`);
      await page.getByRole("button", { name: "Crews page", exact: true }).click();
      const content = page.locator("[data-app-crews]");
      await expect(content.getByRole("heading", { name: "Crews", exact: true })).toBeVisible();
      await expect(content.getByRole("tab")).toHaveText(["Teams", "Members", "Work"]);
      const teams = content.getByRole("list", { name: "Crews", exact: true });
      await expect(teams.getByRole("listitem").first()).toBeVisible();
      await page.screenshot({
        path: `${"temp/verification/crews-hub"}/crews-page-teams-${theme}-${width}-${testInfo.project.name}.png`,
      });
      await content.getByRole("textbox", { name: "Filter crews" }).fill("no such crew");
      await expect(content.getByText("No crews match your filter.")).toBeVisible();
      await content.getByRole("button", { name: "Reset filters", exact: true }).click();
      await content.getByRole("radio", { name: "List", exact: true }).click();
      await expect(teams.getByRole("listitem").first()).toBeVisible();
      await content.getByRole("tab", { name: "Members", exact: true }).click();
      await expect(content.getByRole("tabpanel")).toContainText("Member library");
      await content.getByRole("tab", { name: "Work", exact: true }).click();
      await expect(content.getByRole("tabpanel")).toBeVisible();
    });
  }
}

test("settings only hold the sidebar toggle and a link to the Crews page", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html");
  await page.getByRole("button", { name: "Crew settings page", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Show crews", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Crews", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit /, exact: false })).toHaveCount(0);
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

test("the Active tab lists working members and opens their conversation", async ({ page }) => {
  await page.goto("/tests/browser/crews/crews.html?rich");
  await page.getByRole("button", { name: "Crews page", exact: true }).click();
  const content = page.locator("[data-app-crews]");
  await expect(content.getByRole("tab", { name: /^Active/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const rows = content.getByRole("region", { name: "Fixture" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await rows.filter({ hasText: "API engineer" }).getByRole("button").first().click();
  await expect(page.getByLabel("Opened session")).toHaveText("api-session");
});

const evidence = "temp/verification/crews-hub";
for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`crews hub evidence (${theme}, ${width}px)`, async ({ page }, testInfo) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/crews/crews.html?rich&theme=${theme}`);
      const shot = (name: string) =>
        page.screenshot({
          path: `${evidence}/r2-${name}-${theme}-${width}-${testInfo.project.name}.png`,
          animations: "disabled",
        });
      const noOverflow = async () =>
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        ).toBe(true);
      // The rail's crew identities and the separate current-work region remain visible.
      const crewWork = page.getByRole("region", { name: "Crew work", exact: true });
      await expect(crewWork).toBeVisible();
      await crewWork.screenshot({
        path: `${evidence}/r2-current-work-${theme}-${width}-${testInfo.project.name}.png`,
        animations: "disabled",
      });
      await page
        .locator("aside")
        .first()
        .screenshot({
          path: `${evidence}/r2-rail-${theme}-${width}-${testInfo.project.name}.png`,
          animations: "disabled",
        });
      const content = await openCrewsTab(page, "Active");
      await expect(content.getByRole("listitem")).toHaveCount(3);
      await shot("active");
      await noOverflow();
      await content.getByRole("tab", { name: "Teams", exact: true }).click();
      await expect(content.getByRole("list", { name: "Crews" }).getByRole("listitem")).toHaveCount(
        2,
      );
      await shot("teams-cards");
      await content.getByRole("radio", { name: "List", exact: true }).click();
      await shot("teams-list");
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
      const timeline = run.getByText("Timeline", { exact: true });
      await timeline.evaluate((node) => node.scrollIntoView({ block: "start" }));
      await shot("work-finished");
      await noOverflow();
      await content.getByRole("tab", { name: "Teams", exact: true }).click();
      await page.getByRole("button", { name: "Edit Website Crew", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "Website Crew",
        exact: true,
      });
      // A member that no longer follows its library profile shows a quiet icon, not a badge.
      await expect(
        dialog.getByRole("img", { name: "Not following library profile" }).first(),
      ).toBeVisible();
      await expect(dialog.getByText("Customized", { exact: true })).toHaveCount(0);
      await shot("crew-editor");
      await shot("edit-crew-members");
      await dialog.getByRole("button", { name: /^UI/ }).first().click();
      await expect(dialog.getByRole("textbox", { name: /^Handle/ })).toBeVisible();
      await dialog
        .getByRole("textbox", { name: "Instructions", exact: true })
        .scrollIntoViewIfNeeded();
      await shot("member-form");
      await shot("member-detail");
      await dialog.getByRole("textbox", { name: /^Handle/ }).scrollIntoViewIfNeeded();
      await shot("member-form-identity");
      await noOverflow();
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
      // Library profile dialog: member form with a model pool.
      await content
        .locator(".settings-collection-row")
        .filter({ hasText: "Triage engineer" })
        .getByRole("button", { name: /^Edit / })
        .click();
      const profile = page.getByRole("dialog", { name: "Triage engineer", exact: true });
      await expect(profile).toBeVisible();
      await shot("profile-top");
      await expect(profile.getByRole("radio", { name: "Automatic" })).toBeChecked();
      await profile.getByRole("heading", { name: "Model", exact: true }).scrollIntoViewIfNeeded();
      await profile.getByText("Available in", { exact: true }).scrollIntoViewIfNeeded();
      await shot("profile-model-pool");
      await profile.getByText("Tools", { exact: true }).first().scrollIntoViewIfNeeded();
      const tools = profile.getByRole("group", { name: "Tool profile", exact: true });
      await expect(tools.getByRole("radio", { name: /^Full access/ })).toBeChecked();
      await expect(tools.getByRole("radio")).toHaveCount(5);
      await tools.getByRole("radio", { name: /^Custom/ }).check();
      await expect(profile.getByRole("button", { name: /^Host tools:/ })).toBeVisible();
      await expect(profile.getByRole("button", { name: /^MCP servers:/ })).toBeVisible();
      await expect(profile.getByRole("button", { name: /^Skills:/ })).toBeVisible();
      await shot("profile-tools");
      await tools.getByRole("radio", { name: /^Full access/ }).check();
      await expect(profile.getByRole("button", { name: /^Host tools:/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
      // Models tab: Host model pools.
      await content.getByRole("tab", { name: "Models", exact: true }).click();
      await expect(content.getByText("Fast and cheap", { exact: true })).toBeVisible();
      await expect(content.getByText("Deep reasoning", { exact: true })).toBeVisible();
      await shot("models-tab");
      await noOverflow();
      // New work dialog: role chips wrap and the project select pins "New project…".
      const start = await openStart(page);
      await expect(start).toBeVisible();
      await shot("new-work");
      await start
        .getByRole("button", { name: /crew-project/ })
        .first()
        .click();
      await expect(page.getByRole("button", { name: "New project…" })).toBeVisible();
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
      const dialog = page.getByRole("dialog", { name: "Website Crew", exact: true });
      await expect(dialog.getByRole("checkbox", { name: "Select all", exact: true })).toBeVisible();
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
      const performance = dialog.locator("summary").filter({ hasText: /^Performance$/ });
      await performance.click();
      await expect(dialog.getByText("Could not load performance", { exact: true })).toBeVisible();
      const error = dialog.getByRole("alert").filter({ hasText: "Could not load performance" });
      await expect(error).toHaveCount(1);
      await expect(error.locator("svg")).toHaveCount(1);
      await error.getByRole("button", { name: "Retry", exact: true }).click();
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
        .getByRole("button", { name: /^Codex GPT/ })
        .last()
        .scrollIntoViewIfNeeded();
      await shot("member-model");
      const advanced = dialog
        .locator("summary")
        .filter({ hasText: /^Advanced$/ })
        .last();
      if (!(await advanced.evaluate((node) => node.closest("details")?.open)))
        await advanced.click();
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
      let dialog = page.getByRole("dialog", { name: "Website Crew", exact: true });
      const search = dialog.getByRole("textbox", {
        name: "Search members by name, role, model or group",
        exact: true,
      });
      await search.fill("unmatched-fixture-member");
      await expect(dialog.getByText("No matching members.", { exact: true })).toHaveCount(4);
      await expect(dialog.getByText("No matching members.", { exact: true }).first()).toBeVisible();
      await shot("roster-empty");
      await dialog
        .getByRole("textbox", { name: "Crew name", exact: true })
        .fill("Fixture draft preserved");
      await expect(
        dialog.getByText("The Host rejected this crew: storage is read-only right now."),
      ).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      await shot("footer-error");
      await page.goto(`/tests/browser/crews/crews.html?library=empty&theme=${theme}`);
      await editCrew(page);
      dialog = page.getByRole("dialog", { name: "Website Crew", exact: true });
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
      const scan = page.getByRole("button", { name: "Scan with these settings" });
      await expect(scan).toBeEnabled();
      await expect(scan.locator("../..")).toHaveCSS("border-top-width", "1px");
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
      await page
        .getByRole("region", { name: "Crew work", exact: true })
        .getByRole("button", { name: "Manage", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Website Crew", exact: true });
      const nav = dialog.getByRole("navigation", { name: "Crew work", exact: true });
      const list = nav.getByRole("list", { name: "Work list", exact: true });
      await expect(list).toBeVisible();
      await expect(nav).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      expect(await list.getByRole("listitem").count()).toBeGreaterThan(2);
      await page.screenshot({
        path: `temp/verification/crew-work-current/list-${theme}-${width}.png`,
      });
      const item = list.getByRole("button", { name: /^Work item 3/ });
      await item.click();
      await expect(dialog.locator('[data-crew-run="many-2"]')).toBeVisible();
      if (!(await list.isVisible()))
        await dialog.getByRole("button", { name: "Back to work list", exact: true }).click();
      await expect(item).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({
        path: `temp/verification/crew-work-current/selected-${theme}-${width}.png`,
      });
    });
  }
