import { test, expect, type Page } from "@playwright/test";
const shots = "temp/verification/2026-10-25-crew-management-v2";
for (const theme of ["light", "dark"] as const) {
  test(`crew work shows only the initiating operation pending in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/crews.html?theme=${theme}&slowOperation=crews.pause`);
    const management = await openWork(page);
    const pause = management.getByRole("button", { name: "Pause new assignments", exact: true });
    await pause.focus();
    await pause.press("Enter");
    await expect(pause).toHaveAttribute("aria-busy", "true");
    await expect(pause).toBeFocused();
    await expect(
      management.getByRole("button", { name: "Stop work", exact: true }),
    ).not.toHaveAttribute("aria-busy", "true");
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
  const dialog = page.getByRole("dialog", { name: "Website Crew", exact: true });
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
    await page.setViewportSize({ width: theme === "light" ? 390 : 1100, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/crews.html?defaults&theme=${theme}`);
    await page.getByRole("button", { name: "Crew settings page" }).click();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(18);
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const team = page.getByRole("dialog", { name: "bycoda Product Team", exact: true });
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
    await team.getByRole("button", { name: "Back to team", exact: true }).click();
    await team.getByRole("button", { name: /^Mobile Engineer / }).click();
    await expect(team.getByRole("textbox", { name: "Instructions", exact: true })).toHaveValue(
      /intermittent connectivity/,
    );
    await team.getByRole("textbox", { name: "Role", exact: true }).fill("Our mobile engineer");
    await team.getByRole("button", { name: "Save", exact: true }).click();
    await expect(team.getByRole("status")).toHaveText("Saved");
    await page.keyboard.press("Escape");
    await expect(team).not.toBeVisible();
    // Team edits leave the reusable library profile independent.
    const mobile = page.getByText("Mobile Engineer", { exact: true });
    await expect(mobile).toBeVisible();
    await page.screenshot({
      path: `${shots}/defaults-${theme}-${testInfo.project.name}.png`,
    });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const saved = page.getByRole("dialog", { name: "bycoda Product Team", exact: true });
    await expect(saved.getByRole("region", { name: "Specialists", exact: true })).toContainText(
      "Our mobile engineer",
    );
    await expect(page.getByLabel("Started work")).toHaveText("0");
  });
}
test("creates a crew from the rail with chosen members without starting work", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews.html");
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
  // Several library members are added in one step; groups filter the list.
  await dialog.getByRole("button", { name: "Add members", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Library (2)" })).toBeChecked();
  await dialog.getByRole("textbox", { name: "Search members" }).fill("designer");
  await dialog.getByRole("checkbox").first().check();
  await dialog.getByRole("textbox", { name: "Search members" }).fill("");
  await dialog.getByLabel("API engineer").check();
  await page.screenshot({
    path: `${shots}/add-members-${testInfo.project.name}.png`,
  });
  await page.getByRole("button", { name: "Add 2 members" }).click();
  const specialists = dialog.getByRole("region", { name: "Specialists" });
  await expect(specialists.getByRole("button", { name: /^UI designer/ })).toBeVisible();
  await expect(specialists.getByRole("button", { name: /^API engineer/ })).toBeVisible();
  await page.getByRole("button", { name: "Create crew" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Mobile" })).toBeVisible();
  await expect(page.getByLabel("Started work")).toHaveText("0");
});
test("adds a new member when the library is empty and shows role problems in place", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews.html?library=empty");
  await page.getByRole("button", { name: "New crew", exact: true }).click();
  const dialog = editor(page);
  await dialog.getByRole("button", { name: "Add members", exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "New member" })).toBeChecked();
  await dialog.getByRole("radio", { name: "Library (0)" }).click();
  await expect(dialog.getByText("Your member library is empty")).toBeVisible();
  await dialog.getByRole("radio", { name: "New member" }).click();
  await page.getByRole("button", { name: "Add to crew" }).click();
  await expect(dialog.getByText("Add a name").first()).toBeVisible();
  // The role name is the owner's own; suggestions follow the chosen responsibility.
  await dialog
    .getByRole("radiogroup", { name: "Responsibility in the crew" })
    .getByRole("radio", { name: "Coordinator" })
    .click();
  await expect(
    dialog.getByText("Plans the work and hands out assignments. A crew has one."),
  ).toBeVisible();
  await dialog
    .getByRole("group", { name: "Suggested roles" })
    .getByRole("button", { name: "Project lead" })
    .click();
  await expect(dialog.getByRole("textbox", { name: "Role" })).toHaveValue("Project lead");
  await dialog.getByRole("textbox", { name: "Role" }).fill("Mobile release lead");
  await dialog.getByLabel("Also save to member library").check();
  await dialog
    .getByRole("radiogroup", { name: "Library availability" })
    .getByRole("radio", { name: "All projects" })
    .click();
  await page.getByRole("button", { name: "Add to crew" }).click();
  await expect(dialog.getByRole("region", { name: "Coordinator" })).toContainText(
    "Mobile release lead",
  );
  await expect(dialog.getByText("Add a reviewer.").first()).toBeVisible();
  await expect(dialog.getByText("Add at least one specialist.").first()).toBeVisible();
  // The saved profile is now in the library for every project on this host.
  await dialog.getByRole("button", { name: "Add reviewer" }).click();
  await expect(dialog.getByRole("radio", { name: "Library (1)" })).toBeChecked();
  await expect(dialog.getByText("Added members join as Reviewer.")).toBeVisible();
});
test("opens ongoing work from the rail and keeps the delivery while editing the crew", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews.html");
  const row = page.getByRole("listitem").filter({ hasText: "Website Crew" });
  await row.getByRole("button", { name: /Website Crew, Needs decision/ }).click();
  const workDialog = page.getByRole("dialog", { name: "Website Crew" });
  await expect(workDialog).toBeVisible();
  await workDialog.getByRole("button", { name: /Coordinator/ }).click();
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
  await row.hover();
  await row.getByRole("button", { name: "Start work with Website Crew" }).click();
  const start = page.getByRole("dialog", { name: "Start crew work" });
  // Members named like their responsibility are not repeated.
  await expect(start.locator("dl")).toHaveText("CoordinatorSpecialist:UIReviewer");
  await start
    .getByRole("textbox", { name: "What should the crew deliver?" })
    .fill("Mobile sign-in");
  await start.getByRole("button", { name: "Edit crew" }).click();
  await expect(page.getByRole("dialog", { name: "Website Crew" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(start.getByRole("textbox", { name: "What should the crew deliver?" })).toHaveValue(
    "Mobile sign-in",
  );
  await start.getByRole("button", { name: "Start work" }).dblclick();
  await expect(page.getByLabel("Opened session")).toHaveText("started-1");
  await expect(page.getByLabel("Started work")).toHaveText("1");
});
test("the crew menu offers start, edit, copy and explicit work controls", async ({ page }) => {
  await page.goto("/tests/browser/crews.html");
  const row = page.getByRole("listitem").filter({ hasText: "Website Crew" });
  await row.hover();
  await row.getByRole("button", { name: "Website Crew options" }).click();
  const menu = page.getByRole("menu", { name: "Website Crew options" });
  for (const name of [
    "Start work",
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
  await page.goto("/tests/browser/crews.html");
  const compact = page.locator('[data-crew-work-link="run"]');
  await expect(compact).toContainText("Build settings page");
  await expect(compact.getByRole("button", { name: "Stop work" })).toHaveCount(0);
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  await expect(work).toContainText("Build settings page");
  await expect(work.getByText("Needs decision", { exact: true })).toBeVisible();
  await expect(work).toContainText("0/1 tasks");
  await expect(work).toContainText("Need image generation for the hero");
  await expect(work.getByRole("button", { name: /Coordinator/ })).toBeVisible();
  await expect(work.getByRole("button", { name: /UI.*Awaiting acceptance/ })).toBeVisible();
  await expect(work.getByRole("button", { name: /Reviewer.*Build settings/ })).toBeVisible();
  await page.screenshot({ path: `${shots}/management-${testInfo.project.name}.png` });
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
  await page.goto("/tests/browser/crews.html?blocked");
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
  await page.screenshot({ path: `${shots}/blocked-narrow-${testInfo.project.name}.png` });
  await work.getByRole("button", { name: /Coordinator/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
});
test("work management returns from crew editing without starting another delivery", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews.html");
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
  await page.goto("/tests/browser/crews.html?multiple");
  const management = await openWork(page);
  await expect(management.locator('[data-crew-run="run"]')).toBeVisible();
  await management.getByRole("button", { name: /^Improve mobile navigation/ }).click();
  await expect(management.locator('[data-crew-run="run"]')).toHaveCount(0);
  const second = management.locator('[data-crew-run="second-run"]');
  await expect(second).toContainText("Improve mobile navigation");
  await expect(second.getByRole("button", { name: /Reviewer/ })).toHaveCount(0);
  await management.getByRole("radio", { name: "Finished", exact: true }).click();
  await management.getByRole("button", { name: /^Audit landing page/ }).click();
  await expect(management.locator('[data-crew-run="old-run"]')).toContainText("Audit landing page");
  await page.screenshot({ path: `${shots}/finished-${testInfo.project.name}.png` });
  await management.getByRole("radio", { name: /Ongoing/ }).click();
  await management.getByRole("button", { name: /^Improve mobile navigation/ }).click();
  await management
    .locator('[data-crew-run="second-run"]')
    .getByRole("button", { name: /Coordinator/ })
    .click();
  await expect(page.getByLabel("Opened session")).toHaveText("second-lead");
});
test("editing keeps the roster first, settings one tab away, and fits narrow windows", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews.html?theme=light");
  await page.getByRole("button", { name: "Crew settings page" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Website Crew" });
  await expect(dialog.getByRole("region", { name: "Coordinator" })).toBeVisible();
  await dialog.getByRole("button", { name: /UI Build accessible UI/ }).click();
  // Automatic members rate their models with plain levels instead of raw numbers.
  await expect(dialog.getByRole("list", { name: "Model ratings" })).toBeVisible();
  await expect(dialog.getByText("Owner quality estimate")).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Role" }).fill("Frontend");
  await dialog.getByRole("textbox", { name: "Groups" }).fill("Web");
  await dialog.getByRole("textbox", { name: "Groups" }).press("Enter");
  await dialog.getByRole("button", { name: "Save to library" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to member library" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Back to team" }).click();
  // Returning from a member page restores focus to its row.
  await expect(dialog.getByRole("button", { name: /^Frontend/ })).toBeFocused();
  await dialog.getByRole("radio", { name: "Working settings" }).click();
  await dialog.getByRole("spinbutton", { name: "Members working at once" }).fill("9");
  await expect(dialog.getByText("Use a whole number from 1 to 4.").first()).toBeVisible();
  await dialog.getByRole("spinbutton", { name: "Members working at once" }).fill("2");
  await page.screenshot({
    path: `${shots}/settings-${testInfo.project.name}.png`,
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await dialog.getByRole("radio", { name: /Team/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
  await page.screenshot({
    path: `${shots}/narrow-${testInfo.project.name}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // The library keeps the saved profile with its group.
  await expect(page.getByText("Frontend").first()).toBeVisible();
});
test("conflicting edits can be preserved as a new crew or replaced by the latest", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews.html");
  await page.getByRole("button", { name: "Crew settings page" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Crew name" }).fill("My local edits");
  await page.evaluate(() =>
    (window as unknown as { simulateCrewUpdate: () => void }).simulateCrewUpdate(),
  );
  // Saving against the newer revision fails and reveals the conflict without waiting for polling.
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Keep edits as new crew" })).toBeVisible({
    timeout: 10000,
  });
  await dialog.getByRole("button", { name: "Discard edits and load latest" }).click();
  await expect(dialog.getByRole("textbox", { name: "Crew name" })).toHaveValue(
    "Updated by another session",
  );
});
test("task creation can pick a saved crew", async ({ page }) => {
  await page.goto("/tests/browser/crews.html");
  await page.getByRole("button", { name: "Task crew selection" }).click();
  await page.getByRole("button", { name: /Run with:/ }).click();
  await page.getByRole("option", { name: /Website Crew/ }).click();
  await expect(page.getByLabel("Selected crew")).toHaveText("crew");
});
for (const theme of ["dark", "light"]) {
  test(`stops and deletes only selected work in ${theme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/crews.html?theme=${theme}&multiple`);
    const management = await openWork(page);
    const work = management.locator('[data-crew-run="run"]');
    await expect(work.getByRole("button", { name: "Delete work", exact: true })).toBeDisabled();
    await work.getByRole("button", { name: "Stop work", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Stop work", exact: true })
      .getByRole("button", { name: "Stop work", exact: true })
      .click();
    await expect(work.getByRole("button", { name: "Resume work" })).toBeVisible();
    await page.screenshot({ path: `${shots}/work-${theme}-${testInfo.project.name}.png` });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await deleteSelectedWork(page, work);
    const confirmation = page.getByRole("dialog", { name: "Delete work", exact: true });
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
  await page.goto("/tests/browser/crews.html?legacy=1");
  const management = await openWork(page);
  const work = management.locator('[data-crew-run="run"]');
  await expect(work.getByRole("button", { name: "Delete work", exact: true })).toHaveCount(0);
});

test("deleted crew definitions retain accessible work history", async ({ page }) => {
  await page.goto("/tests/browser/crews.html?deletedDefinition");
  const management = await openWork(page);
  await expect(management.locator('[data-crew-run="run"]')).toContainText("Build settings page");
  await management.getByRole("radio", { name: "Finished", exact: true }).click();
  await expect(management.locator('[data-crew-run="old-run"]')).toContainText("Audit landing page");
  await management
    .locator('[data-crew-run="old-run"]')
    .getByRole("button", { name: /Coordinator/ })
    .click();
  await expect(page.getByLabel("Opened session")).toHaveText("old-lead");
});

test("polling keeps the selected work when another delivery becomes newest", async ({ page }) => {
  await page.goto("/tests/browser/crews.html?multiple");
  await page
    .getByRole("region", { name: "Crew work", exact: true })
    .getByRole("button", { name: "Manage", exact: true })
    .click();
  const management = page.getByRole("dialog", { name: "Website Crew", exact: true });
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

test("crew settings work view opens the selected conversation", async ({ page }) => {
  await page.goto("/tests/browser/crews.html");
  await page.getByRole("button", { name: "Crew settings page", exact: true }).click();
  await page.getByRole("button", { name: "Crew work", exact: true }).click();
  const management = page.getByRole("dialog", { name: "Website Crew", exact: true });
  await management
    .locator('[data-crew-run="run"]')
    .getByRole("button", { name: /Coordinator/ })
    .click();
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
  await expect(management).toHaveCount(0);
});
