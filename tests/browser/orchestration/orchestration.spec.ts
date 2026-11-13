import { test, expect } from "@playwright/test";
for (const width of [390, 1000])
  test(`proposal editing and explicit confirmation preserve settings at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tests/browser/orchestration/orchestration.html");
    if (width === 390)
      await page.evaluate(() => document.documentElement.classList.add("theme-light"));
    const group = page.getByRole("radiogroup", { name: "Parallel workers", exact: true });
    await group.getByRole("radio", { name: "2", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("radio", { name: "3", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.getByRole("button", { name: "Model for UI task", exact: true }).click();
    const search = page.getByRole("combobox", { name: "Search assignment models", exact: true });
    await expect(search).toBeFocused();
    await search.press("Enter");
    await page.getByRole("menuitemradio", { name: "Extra High", exact: true }).click();
    await expect(page.getByTestId("proposal")).toContainText('"serviceTier":"fast"');
    await expect(page.getByTestId("proposal")).toContainText('"reasoningEffort":"xhigh"');
    await page.getByRole("button", { name: "Model for UI task", exact: true }).click();
    await search.fill("Claude");
    await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    // The filtered model row stays; a composing Enter must not open its effort menu.
    await expect(page.getByRole("menuitemradio", { name: "Fixture Two" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByRole("menuitemradio", { name: "High", exact: true })).toHaveCount(0);
    await search.press("Enter");
    await page.getByRole("menuitemradio", { name: "High", exact: true }).click();
    await page.getByRole("button", { name: "Details for UI task", exact: true }).click();
    const instruction = page.getByRole("textbox", { name: "Instructions for task 1", exact: true });
    const draft = "Retained multiline instruction\n".repeat(20);
    await instruction.fill(draft);
    const dimensions = await instruction.evaluate((el) => ({
      height: el.clientHeight,
      scroll: el.scrollHeight,
      max: parseFloat(getComputedStyle(el).maxHeight),
      resize: getComputedStyle(el).resize,
      overscroll: getComputedStyle(el).overscrollBehavior,
    }));
    expect(dimensions.resize).toBe("none");
    // The shared lock either chains no scroll on the compositor (`contain`, where there is no
    // bounce) or cancels the wheel at the edge (macOS rubber band). An engine without
    // `overscroll-behavior` reports nothing to check.
    const wheelPrevented = await instruction.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      const wheel = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
      el.dispatchEvent(wheel);
      return wheel.defaultPrevented;
    });
    if (dimensions.overscroll !== undefined)
      expect(dimensions.overscroll === "contain" || wheelPrevented).toBe(true);
    expect(dimensions.height).toBeGreaterThan(30);
    expect(dimensions.height).toBeLessThanOrEqual(dimensions.max);
    expect(dimensions.scroll).toBeGreaterThan(dimensions.height);
    const calls = () =>
      page.evaluate(
        () =>
          (window as unknown as { orchestrationFixtureCalls: { kind: string; payload: unknown }[] })
            .orchestrationFixtureCalls,
      );
    expect(await calls()).toEqual([]);
    const confirm = page.getByRole("button", { name: "Confirm & start", exact: true });
    await confirm.evaluate((node) => {
      node.click();
      node.click();
    });
    await expect
      .poll(async () => (await calls()).filter((call) => call.kind === "confirm").length)
      .toBe(1);
    await page.evaluate(() =>
      (window as unknown as { rejectFixtureConfirmation: () => void }).rejectFixtureConfirmation(),
    );
    await expect(page.getByRole("alert")).toContainText("Fixture approval unavailable");
    await expect(instruction).toHaveValue(draft);
    await expect(group.getByRole("radio", { name: "3", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect
      .poll(async () => (await calls()).filter((call) => call.kind === "resume").length)
      .toBe(1);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `temp/verification/2026-10-16-ui-system/W7-ORCHESTRATION-captures/review-${width}-${test.info().project.name}.png`,
    });
  });

for (const light of [true, false])
  for (const width of [800, 1280])
    test(`worker row density ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/orchestration/orchestration.html");
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("theme-light", theme),
        light,
      );
      const row = page.locator('[data-control-min-height="control"]').first();
      await expect(row).toBeVisible();
      const agent = page.getByRole("button", { name: "Agent details: Interrupted worker" });
      await agent.click();
      const expanded = page.locator("[data-orchestration-agent]").filter({ has: agent });
      await expect(expanded).toHaveAttribute("data-surface-variant", "selection");
      await expect(expanded.locator(":scope > div").last()).toHaveCSS(
        "padding-inline-start",
        "26px",
      );
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
      expect(heights[0]).toBeGreaterThanOrEqual(36);
      expect(heights[1]).toBeGreaterThanOrEqual(heights[0]!);
      expect(heights[2]).toBeGreaterThanOrEqual(heights[1]!);
      await page.screenshot({
        path: `temp/verification/feature-controls/worker-${light ? "light" : "dark"}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`final proposal surface ${theme} ${width}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/orchestration/orchestration.html");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await expect(
        page.getByRole("button", { name: "Confirm & start", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Details for UI task", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Instructions for task 1", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `temp/verification/goal-final-callers/proposal-${theme}-${width}.png`,
        animations: "disabled",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
