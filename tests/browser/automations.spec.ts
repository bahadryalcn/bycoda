import { expect, test } from "@playwright/test";
for (const width of [390, 1440]) {
  test(`automation drafts, filters and menu cancellation at ${width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tests/browser/automations.html");
    await page.getByRole("button", { name: "Open Daily review", exact: true }).click();
    const name = page.getByRole("textbox", { name: "Automation name", exact: true });
    await name.fill("Edited fixture review");
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
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open Edited fixture review", exact: true }),
    ).toBeVisible();
    const actions = page.getByRole("button", { name: "Automation actions", exact: true });
    await actions.click();
    await expect(
      page.getByRole("menuitem", { name: "Delete automation", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();
    page.once("dialog", (dialog) => dialog.dismiss());
    await actions.click();
    await page.getByRole("menuitem", { name: "Delete automation", exact: true }).click();
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
