import { test, expect } from "@playwright/test";

test("duplicates a reusable crew and selects it for a task", async ({ page }) => {
  await page.goto("/tests/browser/crews.html");
  await page.getByRole("button", { name: "Manage crews" }).click();
  await page.getByRole("button", { name: "Duplicate crew", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Website Crew copy", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save crew", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Task crew selection" }).click();
  await page.getByRole("button", { name: /Run with:/ }).click();
  await page.getByRole("option", { name: /Website Crew copy/ }).click();
  await expect(
    page.getByText("This task starts its own crew run. The team can also work on other tasks."),
  ).toBeVisible();
  await expect(page.getByLabel("Selected crew")).not.toHaveText("Single agent");
  await page.getByRole("button", { name: /Run with:/ }).click();
  await page.getByRole("option", { name: "Single agent", exact: true }).click();
  await expect(page.getByLabel("Selected crew")).toHaveText("Single agent");
});
test("crew groups keep conversations visible and support keyboard navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews.html");
  const group = page.locator('[data-crew-run="run"]');
  await expect(group).toBeVisible();
  await page.screenshot({
    path: `temp/verification/2026-10-20-crews-fixes/sessions-${testInfo.project.name}.png`,
  });
  await group.getByRole("button", { name: "Coordinator Conversation" }).click();
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
  await group.getByRole("button", { name: /UI.*Awaiting acceptance/ }).click();
  await expect(page.getByLabel("Opened session")).toHaveText("ui-session");
  await group.getByRole("button", { name: /Reviewer.*Build settings/ }).click();
  await expect(page.getByLabel("Opened session")).toHaveText("review-session");
  await group.getByRole("button", { name: "Pause new crew work" }).click();
  await expect(group.getByRole("button", { name: "Resume crew" })).toBeVisible();
  await expect(group.locator("[aria-expanded]")).toHaveCount(0);
  const coordinator = group.getByRole("button", { name: "Coordinator Conversation" });
  await coordinator.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened session")).toHaveText("lead-session");
  await expect(coordinator).toBeVisible();
});
test("crew settings save project policies and remain usable at narrow widths", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews.html?theme=light");
  await page.getByRole("button", { name: "Manage crews" }).click();
  await expect(page.getByRole("heading", { name: "Website Crew", exact: true })).toBeVisible();
  await page.screenshot({
    path: `temp/verification/2026-10-20-crews-fixes/settings-${testInfo.project.name}.png`,
  });
  await page
    .getByRole("radiogroup", { name: "Crew view" })
    .getByRole("radio", { name: "Crew settings", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Crew name", exact: true }).fill("Product Crew");
  await page.getByRole("button", { name: "Save crew", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Product Crew", exact: true })).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "Crew view" })
    .getByRole("radio", { name: "Team", exact: true })
    .click();
  await page.getByRole("button", { name: /UI Delivers assigned work/ }).click();
  await expect(page.getByRole("region", { name: "Edit member" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Team members" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Member name", exact: true }).fill("Frontend");
  await page.getByRole("radio", { name: "Models and capabilities", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Inspect saved capabilities", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Owner quality estimate", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Role and instructions", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Member name", exact: true })).toHaveValue(
    "Frontend",
  );
  await page.screenshot({
    path: `temp/verification/2026-10-20-crews-fixes/member-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to team" }).click();
  await expect(page.getByRole("button", { name: /Frontend Delivers assigned work/ })).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "Crew view" })
    .getByRole("radio", { name: "Working style", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Assignment limit", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "Native subagents", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Balanced", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "Economy", exact: true })).toBeChecked();
  await page
    .getByRole("radiogroup", { name: "Crew view" })
    .getByRole("radio", { name: "Team", exact: true })
    .click();
  await expect(page.locator("details")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const rosterWidth = await page.getByRole("region", { name: "Team members" }).boundingBox();
  expect(rosterWidth?.width).toBeGreaterThan(340);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole("button", { name: "Add member", exact: true })).toBeVisible();
  await page.screenshot({
    path: `temp/verification/2026-10-20-crews-fixes/narrow-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("presets replace custom weights and drafts survive leaving settings", async ({ page }) => {
  await page.goto("/tests/browser/crews.html");
  await page.getByRole("button", { name: "Manage crews" }).click();
  await page.getByRole("radio", { name: "Working style", exact: true }).click();
  const cost = page.getByRole("spinbutton", { name: "Cost preference weight", exact: true });
  const quality = page.getByRole("spinbutton", { name: "Quality preference weight", exact: true });
  await cost.fill("0.8");
  await quality.fill("0.2");
  await expect(
    page.getByText("Custom weights are active. Choose a preset to reset them."),
  ).toBeVisible();
  // Selecting even the previously chosen preset resets custom overrides.
  await page.getByRole("radio", { name: "Balanced", exact: true }).click();
  await expect(cost).toHaveValue("");
  await expect(quality).toHaveValue("");
  await page.getByRole("radio", { name: "Quality", exact: true }).click();
  await page.getByRole("radio", { name: "Crew settings", exact: true }).click();
  await page.getByRole("textbox", { name: "Crew name", exact: true }).fill("Retained draft");
  await page.getByRole("button", { name: "Leave settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Retained draft", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Manage crews" }).click();
  await expect(page.getByRole("heading", { name: "Retained draft", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Working style", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Quality", exact: true })).toBeChecked();
  await expect(cost).toHaveValue("");
  await expect(quality).toHaveValue("");
  await page.getByRole("button", { name: "Save crew", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
});

test("conflicting edits can be preserved as a new crew or replaced by the latest", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews.html?theme=light");
  await page.getByRole("button", { name: "Manage crews" }).click();
  await page.getByRole("radio", { name: "Crew settings", exact: true }).click();
  await page.getByRole("textbox", { name: "Crew name", exact: true }).fill("My local edits");
  await page.getByRole("button", { name: "Simulate external crew update" }).click();
  // Force a save before polling has observed the conflicting revision.
  const save = page.getByRole("button", { name: "Save crew", exact: true });
  if (await save.isEnabled()) await save.click();
  await expect(page.getByRole("button", { name: "Keep edits as new crew" })).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Keep edits as new crew" }).click();
  await save.click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My local edits", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Your crews:/ }).click();
  await page.getByRole("option", { name: /Updated by another session/ }).click();
  await page.getByRole("radio", { name: "Crew settings", exact: true }).click();
  await page.getByRole("textbox", { name: "Crew name", exact: true }).fill("Discard this draft");
  await page.getByRole("button", { name: "Simulate external crew update" }).click();
  if (await save.isEnabled()) await save.click();
  await page.getByRole("button", { name: "Discard edits and load latest" }).click();
  await expect(page.getByRole("textbox", { name: "Crew name", exact: true })).toHaveValue(
    "Updated by another session",
  );
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
});
test("new teams start with available models and retain unsaved edits when switching", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews.html");
  await page.getByRole("button", { name: "Manage crews" }).click();
  await page
    .getByRole("radiogroup", { name: "Crew view" })
    .getByRole("radio", { name: "Crew settings", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Crew name", exact: true }).fill("Unsaved website team");
  await page.getByRole("button", { name: "New crew", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New crew", exact: true })).toBeVisible();
  const roster = page.getByRole("region", { name: "Team members" });
  await expect(roster.getByRole("button", { name: /Codex fixture/ })).toHaveCount(4);
  await page.getByRole("button", { name: "Save crew", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Your crews:/ }).click();
  await page.getByRole("option", { name: /Unsaved website team/ }).click();
  await expect(
    page.getByRole("heading", { name: "Unsaved website team", exact: true }),
  ).toBeVisible();
});
