import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const PAGE = "/tests/browser/automations/automations.html";
const SHOTS = "temp/verification/ui-hardening/simplify/automations";

type Calls = { command: string; args: Record<string, unknown> }[];
const fixtureCalls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { automationFixtureCalls: Calls }).automationFixtureCalls,
  );
const setTheme = (page: Page, light: boolean) =>
  page.evaluate(
    (enabled) => document.documentElement.classList.toggle("theme-light", enabled),
    light,
  );
const fitsWidth = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`automation working copy is a chip with a Worktree choice in ${theme} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(PAGE);
      await setTheme(page, theme === "light");
      await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
      // The working copy is one chip in the target row; its popover holds the Worktree select.
      const chip = page.getByRole("button", { name: /^Workspace Automatic workspace$/ });
      await expect(chip).toBeVisible();
      await chip.click();
      const worktree = page.getByRole("button", { name: /^Worktree:/ });
      await expect(worktree).toBeVisible();
      await worktree.click();
      await page.getByRole("option", { name: "Fresh worktree", exact: true }).click();
      await expect(page.getByRole("button", { name: /^Workspace Fresh worktree$/ })).toBeVisible();
      expect(await fitsWidth(page)).toBe(true);
    });
  }

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`automation redesigned surfaces and proposal ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mkdir(SHOTS, { recursive: true });
      const capture = async (surface: string) => {
        await expect.poll(() => fitsWidth(page)).toBe(true);
        await page.screenshot({
          path: `${SHOTS}/${surface}-${theme}-${width}.png`,
          animations: "disabled",
        });
      };
      const visit = async (search = "") => {
        await page.goto(`${PAGE}${search}`);
        await setTheme(page, theme === "light");
      };
      await visit("?many");
      await expect(page.getByRole("button", { name: "Open Extra review 1" })).toBeVisible();
      await capture("list");
      await visit("?empty");
      await expect(page.getByText("No automations yet", { exact: true }).first()).toBeVisible();
      await capture("empty-first-use");
      await page.getByRole("button", { name: "New automation", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Automation name" })).toBeVisible();
      await capture("editor-new");
      await page
        .locator("summary")
        .filter({ hasText: /^More options/ })
        .click();
      await page.getByRole("button", { name: /^Runs per day:/ }).scrollIntoViewIfNeeded();
      await capture("editor-more-options");
      await page.getByRole("button", { name: /^Add trigger/ }).click();
      await expect(page.getByRole("combobox", { name: "Search triggers" })).toBeVisible();
      await capture("trigger-list");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Template/ }).click();
      await expect(page.getByRole("combobox", { name: "Search templates" })).toBeVisible();
      await capture("template-menu");
      await page.keyboard.press("Escape");
      await visit("?runs=mixed");
      await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Recent runs" })).toBeVisible();
      await page.getByRole("heading", { name: "Recent runs" }).scrollIntoViewIfNeeded();
      await capture("saved-recent-runs");
      await page.getByRole("button", { name: "AI assistant", exact: true }).click();
      await capture("assistant");
      await page.keyboard.press("Escape");
      await page.goto(`${PAGE}?hostWork&proposal`);
      await setTheme(page, theme === "light");
      const proposal = page.getByRole("dialog", {
        name: "Automation",
        exact: true,
      });
      // The proposal is a read-only confirmation: its instructions are a definition, not a field.
      await expect(
        proposal
          .getByRole("definition")
          .filter({ hasText: "Review fixture activity and report findings" }),
      ).toBeVisible();
      await capture("proposal");
      await proposal.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(proposal).toBeHidden();
      const calls = await fixtureCalls(page);
      expect(calls.some(({ args }) => args.method === "automations.save")).toBe(false);
    });
  }

for (const width of [1280, 800]) {
  test(`offline automation Host preserves creation and drafts through recovery at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${PAGE}?host=offline`);
    const warning = page.getByText(/tailm.*reachable right now/);
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(warning).toBeVisible();
    await expect(page.getByText("Automations unavailable", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Create your first automation", { exact: true })).toHaveCount(0);
    // Creation stays available while the Host is away: the first-use page offers New automation.
    const blank = page.getByRole("button", {
      name: "New automation",
      exact: true,
    });
    await expect(blank).toBeVisible();
    await mkdir(SHOTS, { recursive: true });
    const capture = async (state: string) => {
      for (const light of [false, true]) {
        await setTheme(page, light);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        });
        expect(await fitsWidth(page)).toBe(true);
        await page.screenshot({
          animations: "disabled",
          path: `${SHOTS}/offline-${state}-${light ? "light" : "dark"}-${width}.png`,
        });
      }
    };
    await capture("empty");
    await blank.click();
    const name = page.getByRole("textbox", {
      name: "Automation name",
      exact: true,
    });
    const instructions = page.getByRole("combobox", {
      name: "Instructions",
      exact: true,
    });
    await name.fill("Preserve offline draft");
    await instructions.fill("Owner instructions survive connection recovery.");
    await retry.click();
    await expect(retry).toBeEnabled();
    await expect(name).toHaveValue("Preserve offline draft");
    await expect(instructions).toHaveValue("Owner instructions survive connection recovery.");
    await capture("draft");
    await page.evaluate(() => {
      (
        window as unknown as {
          automationFixtureControl: { remoteAvailable: boolean };
        }
      ).automationFixtureControl.remoteAvailable = true;
    });
    await retry.click();
    await expect(warning).toBeHidden();
    await expect(name).toHaveValue("Preserve offline draft");
    await expect(instructions).toHaveValue("Owner instructions survive connection recovery.");
    await capture("recovered");
    const calls = await fixtureCalls(page);
    expect(
      calls.filter(
        ({ command, args }) =>
          command === "remote_request" &&
          args.method === "environment.describe" &&
          args.fresh === true,
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      calls.some(
        ({ command, args }) =>
          command === "automations_upsert" ||
          command === "automation_run" ||
          (command === "remote_request" &&
            ["automations.save", "automations.runNow"].includes(String(args.method))),
      ),
    ).toBe(false);
    expect(errors).toEqual([]);
  });
}

test("automation save keeps its label and focus while fields lock and failures preserve the draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
  const name = page.getByRole("textbox", {
    name: "Automation name",
    exact: true,
  });
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
            .getByRole("combobox", {
              name: "Instructions",
              exact: true,
              includeHidden: true,
            })
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
        automationFixtureControl: {
          holdSave: boolean;
          finishSave: (error?: string) => void;
        };
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
  test(`automation drafts, filters, discard and delete confirmations at ${width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Nine automations are past the filter threshold, so the filter is offered.
    await page.goto(`${PAGE}?many`);
    const showList = page.getByRole("button", {
      name: /^Show automation list/,
    });
    const back = page.getByRole("button", { name: "Back", exact: true });
    if (width === 390) await showList.click();
    await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
    const name = page.getByRole("textbox", {
      name: "Automation name",
      exact: true,
      includeHidden: true,
    });
    await name.fill("Edited fixture review");
    const filters = page.getByRole("button", {
      name: "Filter automations",
      exact: true,
    });
    await filters.click();
    const filter = page.getByRole("searchbox", {
      name: "Filter automations",
      exact: true,
    });
    await filter.fill("no matching fixture");
    await expect(name).toHaveValue("Edited fixture review");
    // The filter trigger owns the one reset.
    if (width === 390) await showList.click();
    await expect(page.getByText("No matching automations", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open Extra review 1", exact: true }),
    ).toBeVisible();
    await expect(filter).toBeHidden();
    if (width === 390) await back.click();
    await expect(name).toHaveValue("Edited fixture review");
    // A new automation never drops the open draft silently.
    await page.getByRole("button", { name: "New automation", exact: true }).click();
    const discard = page.getByRole("dialog", {
      name: "Discard changes",
      exact: true,
    });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(discard).toBeHidden();
    await expect(name).toBeVisible();
    await expect(name).toHaveValue("Edited fixture review");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    if (width === 390) await showList.click();
    await expect(
      page.getByRole("button", {
        name: "Open Edited fixture review",
        exact: true,
      }),
    ).toBeVisible();
    if (width === 390) await back.click();
    // Delete is one direct button; its confirmation can be cancelled.
    await expect(page.getByRole("button", { name: "Automation actions" })).toHaveCount(0);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Delete automation",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).toBeHidden();
    expect(
      (await fixtureCalls(page)).filter((entry) => entry.command === "automations_delete").length,
    ).toBe(0);
    for (const light of [false, true]) {
      await setTheme(page, light);
      expect(await fitsWidth(page)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`automations-${light ? "light" : "dark"}.png`),
      });
    }
    expect(errors).toEqual([]);
  });
}

test("automation templates, trigger list and scoped AI", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${PAGE}?empty`);
  await page.getByRole("button", { name: "New automation", exact: true }).click();
  const name = page.getByRole("textbox", {
    name: "Automation name",
    exact: true,
  });
  await expect(name).toHaveValue("");
  await page.getByRole("button", { name: /^Template/ }).click();
  await page.getByRole("combobox", { name: "Search templates", exact: true }).fill("incoming");
  await expect(page.getByRole("option", { name: /^Triage incoming messages/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^Generate docs/ })).toHaveCount(0);
  await page.getByRole("option", { name: /^Triage incoming messages/ }).click();
  await expect(name).toHaveValue("Triage incoming messages");
  await page.getByRole("button", { name: /^Add trigger/ }).click();
  await page.getByRole("combobox", { name: "Search triggers", exact: true }).fill("tasks");
  const option = page.getByRole("option", { name: /^Task blocked/ });
  await expect(option).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("automation-trigger-picker.png"),
  });
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
  // The assistant is an on-demand dialog: it closes after launching and keeps the open draft.
  await expect(page.getByRole("dialog", { name: "AI assistant", exact: true })).toBeHidden();
  await expect(name).toHaveValue("Triage incoming messages");
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  const generalScope = page.getByRole("radio", {
    name: "General",
    exact: true,
  });
  await generalScope.focus();
  await generalScope.press("Space");
  await expect(generalScope).toBeChecked();
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
      await setTheme(page, light);
      expect(await fitsWidth(page)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`automation-workspace-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
});

test("a background draft holds exactly one time trigger or Host event", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${PAGE}?hostWork`);
  await page.getByRole("button", { name: "New automation", exact: true }).click();
  await page.getByRole("textbox", { name: "Automation name" }).fill("Continuous review");
  await page.getByRole("combobox", { name: "Instructions", exact: true }).fill("Review.");
  await page
    .locator("summary")
    .filter({ hasText: /^More options/ })
    .click();
  await page.getByRole("switch", { name: /^In the background on/ }).click();
  const add = page.getByRole("button", { name: /^Add trigger/ });
  const create = page.getByRole("button", { name: "Create", exact: true });
  // Without a trigger the draft is unsavable, and the reason is visible.
  await expect(create).toBeDisabled();
  await expect(page.getByText("Choose one schedule or event to continue.")).toBeVisible();
  await add.click();
  await page.getByRole("option", { name: /^Continuous/ }).click();
  await expect(add).toHaveCount(0);
  await expect(create).toBeEnabled();
  await page.getByRole("button", { name: "Remove trigger", exact: true }).click();
  await expect(add).toBeVisible();
});

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`automation visual caller states ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${PAGE}?host=offline`);
      await setTheme(page, theme === "light");
      await expect(page.getByText(/tailm.*reachable right now/)).toBeVisible();
      await mkdir("temp/verification/automations-devices-visual", {
        recursive: true,
      });
      await page.screenshot({
        path: `temp/verification/automations-devices-visual/${theme}-${width}-automations-offline.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "New automation", exact: true }).click();
      await page.getByRole("button", { name: "AI assistant", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "AI assistant", exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/automations-devices-visual/${theme}-${width}-automation-assistant.png`,
        animations: "disabled",
      });
    });
  }

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`automation recent runs feedback visual ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const state of ["slow", "error"]) {
        await page.goto(`${PAGE}?runs=${state}`);
        await setTheme(page, theme === "light");
        await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Recent runs" })).toBeVisible();
        const message =
          state === "slow"
            ? page.getByRole("status").filter({ hasText: "Loading…" })
            : page.getByText("Fixture: run history is unavailable right now", {
                exact: true,
              });
        await expect(message).toBeVisible();
        await page.screenshot({
          path: `temp/verification/automations-devices-visual/${theme}-${width}-history-${state}.png`,
          animations: "disabled",
        });
      }
    });
  }

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`trigger row density ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${PAGE}?triggerDensity`);
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("theme-light", theme),
        light,
      );
      const row = page.locator('[data-control-min-height="large"]');
      await expect(row).toBeVisible();
      const heights: number[] = [];
      for (const density of ["compact", "comfortable", "touch"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.controlDensity = value;
        }, density);
        const measured = await row.evaluate((node) => ({
          height: node.getBoundingClientRect().height,
          minimum: parseFloat(getComputedStyle(node).minBlockSize),
          scroll: node.scrollHeight,
          client: node.clientHeight,
        }));
        expect(measured.height).toBeGreaterThanOrEqual(measured.minimum);
        expect(measured.scroll).toBeLessThanOrEqual(measured.client + 1);
        heights.push(measured.height);
      }
      expect(heights[0]).toBeGreaterThanOrEqual(40);
      expect(heights[1]).toBeGreaterThanOrEqual(heights[0]!);
      expect(heights[2]).toBeGreaterThanOrEqual(heights[1]!);
      await page.screenshot({
        path: `temp/verification/feature-controls/trigger-${light ? "light" : "dark"}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`automation surface geometry ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mkdir("temp/verification/automation-terminal", { recursive: true });
      for (const multiple of [false, true]) {
        await page.goto(`${PAGE}${multiple ? "?multiTriggers" : ""}`);
        await setTheme(page, theme === "light");
        const card = page.getByRole("button", {
          name: "Open Daily review",
          exact: true,
        });
        await expect(card).toBeVisible();
        // The enable switch is a sibling control before the row button, never overlapping it.
        const toggle = page.getByRole("switch", { name: "Pause Daily review" });
        await expect(toggle).toBeVisible();
        const toggleBox = (await toggle.boundingBox())!;
        const cardBox = (await card.boundingBox())!;
        expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(cardBox.x + 0.5);
        const list = page.locator(".automation-list");
        await expect(list).toHaveCSS("border-inline-end-width", "1px");
        await page.screenshot({
          path: `temp/verification/automation-terminal/automation-${theme}-${width}-${multiple ? "multi" : "single"}.png`,
        });
      }
      // First use: one New automation action that does not move or resize on hover.
      await page.goto(`${PAGE}?empty`);
      await setTheme(page, theme === "light");
      const start = page.getByRole("button", {
        name: "New automation",
        exact: true,
      });
      await expect(start).toBeVisible();
      const before = await start.boundingBox();
      await start.hover();
      expect(await start.boundingBox()).toEqual(before);
      await page.screenshot({
        path: `temp/verification/automation-terminal/automation-${theme}-${width}-start-hover.png`,
      });
      await page.goto(PAGE);
      await setTheme(page, theme === "light");
      await page.setViewportSize({ width: 600, height: 900 });
      await page.getByRole("button", { name: /Show automation list/ }).click();
      await expect(page.locator(".automation-list")).toBeVisible();
      await expect(page.locator(".automation-list")).toHaveCSS("border-inline-end-width", "0px");
      await expect(page.locator(".automation-list")).toHaveCSS("border-block-end-width", "0px");
    });
  }
