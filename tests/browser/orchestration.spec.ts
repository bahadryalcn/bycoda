import { test, expect } from "@playwright/test";
for (const width of [390, 1000])
  test(`proposal editing and explicit confirmation preserve settings at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tests/browser/orchestration.html");
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
    const search = page.getByRole("textbox", { name: "Search assignment models", exact: true });
    await expect(search).toBeFocused();
    await search.press("Enter");
    await page.getByRole("menuitemradio", { name: "Extra High", exact: true }).click();
    await expect(page.getByTestId("proposal")).toContainText('"serviceTier":"fast"');
    await expect(page.getByTestId("proposal")).toContainText('"reasoningEffort":"xhigh"');
    await page.getByRole("button", { name: "Model for UI task", exact: true }).click();
    await search.fill("Claude");
    await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(page.getByRole("menuitemradio")).toHaveCount(0);
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
    if (dimensions.overscroll !== undefined) expect(dimensions.overscroll).toBe("none");
    expect(
      await instruction.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        const wheel = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
        el.dispatchEvent(wheel);
        return wheel.defaultPrevented;
      }),
    ).toBe(true);
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
