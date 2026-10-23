import { test, expect, type Page } from "@playwright/test";

const shots = "temp/verification/2026-10-21-crew-ux";
const editor = (page: Page) => page.getByRole("dialog", { name: /New crew|Website Crew|Mobile/ });

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
  await menu.getByRole("menuitem", { name: /Pause new assignments/ }).click();
  const work = page.locator('[data-crew-run="run"]');
  await expect(work.getByRole("button", { name: "Resume work" })).toBeVisible();
  await row.hover();
  await row.getByRole("button", { name: "Website Crew options" }).click();
  await page.getByRole("menuitem", { name: /Delete crew/ }).click();
  await expect(page.getByRole("dialog", { name: "Delete Website Crew?" })).toContainText(
    "Library members are kept",
  );
});

test("crew work lists deliveries with status, progress and conversations", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews.html");
  const work = page.locator('[data-crew-run="run"]');
  await expect(work).toContainText("Build settings page");
  await expect(work).toContainText("Website Crew");
  await expect(work.getByText("Needs decision", { exact: true })).toBeVisible();
  await expect(work.getByText("0/1 tasks", { exact: true })).toBeVisible();
  await expect(work.getByRole("progressbar")).toHaveCount(1);
  await expect(work).toContainText("Needs decision: Need image generation for the hero");
  await work.getByRole("button", { name: "Show details" }).click();
  await work.getByRole("button", { name: /UI.*Awaiting acceptance/ }).click();
  await expect(page.getByLabel("Opened session")).toHaveText("ui-session");
  await work.getByRole("button", { name: /Reviewer · Build settings/ }).click();
  await expect(page.getByLabel("Opened session")).toHaveText("review-session");
  await page.screenshot({ path: `${shots}/work-${testInfo.project.name}.png` });
  await page.getByRole("radio", { name: "Finished" }).click();
  await expect(page.locator('[data-crew-run="old-run"]')).toContainText("Audit landing page");
});

test("crew work details expose long decisions and blockers by keyboard in a narrow pane", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/crews.html?blocked");
  const work = page.locator('[data-crew-run="run"]');
  const details = work.getByRole("button", { name: "Show details", exact: true });
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(work.getByRole("button", { name: "Hide details", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const decision = work.locator("p").filter({ hasText: /^Needs decision:/ });
  const blocker = work.locator("p").filter({ hasText: /^Blocked:/ });
  await expect(decision).toContainText("confirm the next provider and budget.");
  await expect(blocker).toContainText("select a replacement before retrying this task.");
  for (const detail of [decision, blocker]) {
    expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await detail.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe("pre-wrap");
  }
  await expect(page.getByLabel("Opened session")).toBeEmpty();
  await page.screenshot({ path: testInfo.outputPath("crew-work-details-narrow.png") });
  await page.keyboard.press("Enter");
  await expect(work.getByRole("button", { name: "Show details", exact: true })).toBeFocused();
  await expect(decision).toHaveCount(0);
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
