import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`automation redesigned advanced and proposal ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const capture = async (state: string) => {
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await page.screenshot({
          path: `temp/verification/2026-11-14-automations/${state}-${theme}-${width}.png`,
          animations: "disabled",
        });
      };
      const setTheme = () =>
        page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
      await page.goto("/tests/browser/automations/automations.html");
      await setTheme();
      await capture("gallery");
      await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
      await capture("editor");
      await page
        .locator("summary")
        .filter({ hasText: /^Advanced/ })
        .click();
      const limit = page.getByRole("button", { name: /^Runs per day:/ });
      await limit.scrollIntoViewIfNeeded();
      await capture("advanced");
      await page.getByRole("button", { name: "AI assistant", exact: true }).click();
      await capture("assistant");
      await page.keyboard.press("Escape");
      await page.goto("/tests/browser/automations/automations.html?hostWork&proposal");
      await setTheme();
      const proposal = page.getByRole("dialog", { name: "Automation", exact: true });
      await expect(
        proposal.getByRole("textbox", { name: "Instructions", exact: true }),
      ).toHaveValue("Review fixture activity and report findings");
      await capture("proposal");
      await proposal.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(proposal).toBeHidden();
      const calls = await page.evaluate(
        () =>
          (
            window as unknown as {
              automationFixtureCalls: { command: string; args: Record<string, unknown> }[];
            }
          ).automationFixtureCalls,
      );
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
    await page.goto("/tests/browser/automations/automations.html?host=offline");
    const warning = page.getByText(/tailm.*reachable right now/);
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(warning).toBeVisible();
    await expect(page.getByText("Automations unavailable", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Create your first automation", { exact: true })).toHaveCount(0);
    const blank = page.getByRole("button", { name: /Start from scratch/ });
    await expect(blank).toBeVisible();
    const capture = async (state: string) => {
      for (const light of [false, true]) {
        await page.evaluate(
          (enabled) => document.documentElement.classList.toggle("theme-light", enabled),
          light,
        );
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          animations: "disabled",
          path: `temp/verification/2026-11-04-automations-offline/${state}-${width}-${light ? "light" : "dark"}.png`,
        });
      }
    };
    await capture("picker-offline");
    await blank.click();
    const name = page.getByRole("textbox", { name: "Automation name", exact: true });
    const instructions = page.getByRole("textbox", { name: "Instructions", exact: true });
    await name.fill("Preserve offline draft");
    await instructions.fill("Owner instructions survive connection recovery.");
    await retry.click();
    await expect(retry).toBeEnabled();
    await expect(name).toHaveValue("Preserve offline draft");
    await expect(instructions).toHaveValue("Owner instructions survive connection recovery.");
    await capture("draft-offline");
    await page.evaluate(() => {
      (
        window as unknown as { automationFixtureControl: { remoteAvailable: boolean } }
      ).automationFixtureControl.remoteAvailable = true;
    });
    await retry.click();
    await expect(warning).toBeHidden();
    await expect(name).toHaveValue("Preserve offline draft");
    await expect(instructions).toHaveValue("Owner instructions survive connection recovery.");
    await capture("draft-recovered");
    const calls = await page.evaluate(
      () =>
        (
          window as unknown as {
            automationFixtureCalls: { command: string; args: Record<string, unknown> }[];
          }
        ).automationFixtureCalls,
    );
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
  await page.goto("/tests/browser/automations/automations.html");
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
    await page.goto("/tests/browser/automations/automations.html");
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
  await page.goto("/tests/browser/automations/automations.html");
  const templates = page.locator("summary").filter({ hasText: /^Show all/ });
  await templates.focus();
  await templates.press("Enter");
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
  // The assistant is an on-demand dialog: it closes after launching and keeps the open draft.
  await expect(page.getByRole("dialog", { name: "AI assistant", exact: true })).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Automation name", exact: true })).toHaveValue(
    "Triage incoming messages",
  );
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  const generalScope = page.getByRole("radio", { name: "General", exact: true });
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

for (const width of [800, 1280])
  for (const theme of ["light", "dark"]) {
    test(`automation visual caller states ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/automations/automations.html?host=offline");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await expect(page.getByText(/tailm.*reachable right now/)).toBeVisible();
      await mkdir("temp/verification/automations-devices-visual", { recursive: true });
      await page.screenshot({
        path: `temp/verification/automations-devices-visual/${theme}-${width}-automations-offline.png`,
        animations: "disabled",
      });
      await page.getByRole("button", { name: /Start from scratch/ }).click();
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
    test(`automation history feedback visual ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const state of ["slow", "error"]) {
        await page.goto(`/tests/browser/automations/automations.html?runs=${state}`);
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
        await page.getByRole("tab", { name: "Run history", exact: true }).click();
        const message =
          state === "slow"
            ? page.getByRole("status").filter({ hasText: "Loading…" })
            : page.getByText("Fixture: run history is unavailable right now", { exact: true });
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
      await page.goto("/tests/browser/automations/automations.html?triggerDensity");
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
        await page.goto(
          `/tests/browser/automations/automations.html${multiple ? "?multiTriggers" : ""}`,
        );
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        const card = page.getByRole("button", { name: "Open Daily review", exact: true });
        await expect(card).toBeVisible();
        const trigger = card.locator(":scope > span").first();
        await expect(trigger).toHaveCSS("padding-inline-end", multiple ? "96px" : "56px");
        const list = page.locator(".automation-list");
        await expect(list).toHaveCSS("border-inline-end-width", "1px");
        await page.screenshot({
          path: `temp/verification/automation-terminal/automation-${theme}-${width}-${multiple ? "multi" : "single"}.png`,
        });
      }
      const start = page.getByRole("button", { name: /Start from scratch/ });
      await expect(start).toBeVisible();
      const before = await start.boundingBox();
      await expect(start).toHaveCSS("border-top-width", "1px");
      await start.hover();
      await expect(start).toHaveCSS(
        "background-color",
        await start.evaluate((el) => {
          const probe = document.createElement("div");
          probe.style.backgroundColor = "var(--ui-surface-hover)";
          el.append(probe);
          const value = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return value;
        }),
      );
      expect(await start.boundingBox()).toEqual(before);
      await page.screenshot({
        path: `temp/verification/automation-terminal/automation-${theme}-${width}-start-hover.png`,
      });
      await page.setViewportSize({ width: 600, height: 900 });
      await page.getByRole("button", { name: /Show automation list/ }).click();
      await expect(page.locator(".automation-list")).toBeVisible();
      await expect(page.locator(".automation-list")).toHaveCSS("border-inline-end-width", "0px");
      await expect(page.locator(".automation-list")).toHaveCSS("border-block-end-width", "0px");
    });
  }
