import { expect, test } from "@playwright/test";

test("automation save keeps its label and focus while fields lock and failures preserve the draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/automations.html");
  await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Automation name", exact: true });
  await name.fill("Keep this edited automation");
  await page.evaluate(() => {
    (
      window as unknown as { automationFixtureControl: { holdSave: boolean } }
    ).automationFixtureControl.holdSave = true;
  });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(save).toBeFocused();
  await expect(save).toHaveText("Save");
  await expect(name).toBeDisabled();
  expect(await save.evaluate((node) => node.closest("[inert]") === null)).toBe(true);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { automationFixtureCalls: { command: string }[] }
        ).automationFixtureCalls.filter((entry) => entry.command === "automations_upsert").length,
    ),
  ).toBe(1);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) {
      await expect
        .poll(() =>
          page
            .getByRole("textbox", { name: "Instructions", exact: true, includeHidden: true })
            .evaluate((node) => node.getBoundingClientRect().height),
        )
        .toBeLessThan(220);
      expect((await name.boundingBox())!.width).toBeGreaterThan(300);
    }
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await expect(save).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `temp/verification/2026-10-25-full-ui/automation-save-${width}-${light ? "light" : "dark"}.png`,
      });
    }
  }
  await page.evaluate(() => {
    const control = (
      window as unknown as {
        automationFixtureControl: { holdSave: boolean; finishSave: (error?: string) => void };
      }
    ).automationFixtureControl;
    control.holdSave = false;
    control.finishSave("Save unavailable; retry your changes");
  });
  await expect(save).not.toHaveAttribute("aria-busy", "true");
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue("Keep this edited automation");
  await expect(
    page.getByText("Save unavailable; retry your changes", { exact: true }),
  ).toBeVisible();
  await save.click();
  await expect(
    page.getByText("Save unavailable; retry your changes", { exact: true }),
  ).toBeHidden();
  await expect(name).toHaveValue("Keep this edited automation");
});

for (const width of [390, 1440]) {
  test(`automation drafts, filters and menu cancellation at ${width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tests/browser/automations.html");
    if (width === 390) await page.getByRole("button", { name: /^Show automation list/ }).click();
    await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
    const name = page.getByRole("textbox", {
      name: "Automation name",
      exact: true,
      includeHidden: true,
    });
    await name.fill("Edited fixture review");
    if (width === 390) await page.getByRole("button", { name: /^Show automation list/ }).click();
    const filters = page.getByRole("button", { name: "Filter automations", exact: true });
    await filters.click();
    const filter = page.getByRole("searchbox", { name: "Filter automations", exact: true });
    await filter.fill("no matching fixture");
    await expect(name).toHaveValue("Edited fixture review");
    await page
      .getByRole("dialog", { name: "Filter automations", exact: true })
      .getByRole("button", { name: "Reset", exact: true })
      .click();
    await expect(filter).toHaveValue("");
    await page.keyboard.press("Escape");
    if (width === 390) await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(name).toBeVisible();
    await expect(name).toHaveValue("Edited fixture review");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    if (width === 390) await page.getByRole("button", { name: /^Show automation list/ }).click();
    await expect(
      page.getByRole("button", { name: "Open Edited fixture review", exact: true }),
    ).toBeVisible();
    if (width === 390) await page.getByRole("button", { name: "Back", exact: true }).click();
    const actions = page.getByRole("button", { name: "Automation actions", exact: true });
    await actions.click();
    await expect(
      page.getByRole("menuitem", { name: "Delete automation", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();
    await actions.click();
    await page.getByRole("menuitem", { name: "Delete automation", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete automation", exact: true });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as { automationFixtureCalls: { command: string }[] }
          ).automationFixtureCalls.filter((entry) => entry.command === "automations_delete").length,
      ),
    ).toBe(0);
    for (const light of [false, true]) {
      await page.evaluate(
        (enabled) => document.documentElement.classList.toggle("theme-light", enabled),
        light,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`automations-${light ? "light" : "dark"}.png`),
      });
    }
    expect(errors).toEqual([]);
  });
}

test("automation gallery, event picker, focus mode and scoped AI", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/tests/browser/automations.html");
  await page.getByRole("button", { name: /^Show all/ }).click();
  await expect(page.getByText("Plan social content", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search templates", exact: true })
    .fill("incoming messages");
  await expect(page.getByText("Triage incoming messages", { exact: true })).toBeVisible();
  await expect(page.getByText("Generate docs", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Focus mode", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Daily review", exact: true })).toBeHidden();
  await page.getByText("Triage incoming messages", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Automation name", exact: true })).toHaveValue(
    "Triage incoming messages",
  );
  await page.getByRole("button", { name: "Add Trigger: Add Trigger", exact: true }).click();
  await page.getByRole("combobox", { name: "Search triggers", exact: true }).fill("tasks");
  const option = page.getByRole("option", { name: /^Task blocked/ });
  await expect(option).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("automation-trigger-picker.png") });
  await expect
    .poll(async () => (await option.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(36);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Task created", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await page
    .getByRole("textbox", { name: "AI assistant", exact: true })
    .fill("Explain the failed runs");
  await page.getByRole("button", { name: "Open assistant", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { assistantLaunch?: { cwd: string } }).assistantLaunch?.cwd,
      ),
    )
    .toBe("C:/fixture/project");
  await page.getByRole("radio", { name: "General", exact: true }).click();
  await page
    .getByRole("textbox", { name: "AI assistant", exact: true })
    .fill("Plan a general automation");
  await page.getByRole("button", { name: "Open assistant", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { assistantLaunch?: { cwd: string } }).assistantLaunch?.cwd,
      ),
    )
    .toBe("C:/fixture/home");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`automation-workspace-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
});
