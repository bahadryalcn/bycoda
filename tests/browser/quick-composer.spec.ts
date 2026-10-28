import { test, expect } from "@playwright/test";
for (const [theme, width] of [
  ["light", 390],
  ["dark", 1000],
] as const) {
  test(`quick composer shared controls ${theme} ${width}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/quick-composer.html?theme=${theme}`);
    const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
    await expect(prompt).toBeFocused();
    await prompt.fill("A retained native composer draft");
    await page.getByTitle("Model (⌘.)", { exact: true }).click();
    const search = page.getByRole("combobox", { name: "Search models", exact: true });
    await expect(search).toBeFocused();
    await search.fill("model 37");
    await expect(page.getByRole("option", { name: /Fixture model 37/ })).toBeVisible();
    await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await expect(search).toBeVisible();
    await search.press("Enter");
    await expect(page.getByRole("option", { name: /Fixture model 37/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(prompt).toHaveValue("A retained native composer draft");
    await page.getByRole("slider", { name: "Effort", exact: true }).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("slider", { name: "Effort", exact: true })).toHaveAttribute(
      "aria-valuetext",
      "High",
    );
    await page.keyboard.press("Escape");
    await expect(prompt).toBeFocused();
    await page.getByRole("button", { name: "Permissions", exact: true }).click();
    await page.getByRole("listbox", { name: "Permissions", exact: true }).press("Escape");
    await expect(prompt).toBeFocused();
    await prompt.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    expect(
      await page.evaluate(
        () =>
          (window as any).quickFixtureCalls.filter(
            (call: any) => call.command === "quick_composer_submit_intent",
          ).length,
      ),
    ).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`quick-controls-${theme}-${width}.png`),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Start", exact: true }).dblclick();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).quickFixtureCalls.filter(
              (call: any) => call.command === "quick_composer_submit_intent",
            ).length,
        ),
      )
      .toBe(1);
    await expect(prompt).toHaveValue("");
    expect(errors).toEqual([]);
  });
}

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`quick composer inherits current checkout by default ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/quick-composer.html?theme=${theme}`);
      await page
        .getByRole("textbox", { name: "Prompt", exact: true })
        .fill("Preserve the current checkout draft");
      await expect(
        page.getByRole("button", { name: "Workspace Current checkout", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
      expect(
        await page.evaluate(() =>
          (window as any).quickFixtureCalls.some(
            (call: any) => call.args?.method === "projects.workspacePolicy.get",
          ),
        ),
      ).toBe(false);
      await page.screenshot({
        path: info.outputPath(`quick-current-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }
}

test("quick composer displays inherited worktree policy and an explicit current choice overrides it", async ({
  page,
}) => {
  await page.goto("/tests/browser/quick-composer.html?worktree-policy");
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Keep this policy override draft");
  await expect(
    page.getByRole("button", { name: "Workspace New worktree", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-workspace-creation-status]")).toContainText("Based on main");
  await page.getByRole("button", { name: "Workspace New worktree", exact: true }).click();
  await page.evaluate(() => (window as any).quickFixture.pickWorkspace("current"));
  await expect(
    page.getByRole("button", { name: "Workspace Current checkout", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).quickFixtureCalls.filter(
            (call: any) => call.command === "quick_composer_submit_intent",
          ).length,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).quickFixtureCalls.find(
          (call: any) => call.command === "quick_composer_submit_intent",
        ).args.submission.request.workspaceMode,
    ),
  ).toBe("current");
});

test("quick composer keeps an explicit worktree blocked on a legacy Host and preserves the draft", async ({
  page,
}) => {
  await page.goto("/tests/browser/quick-composer.html");
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Keep this failed worktree draft");
  await page.getByRole("button", { name: "Workspace Current checkout", exact: true }).click();
  await page.evaluate(() => (window as any).quickFixture.pickWorkspace("worktree"));
  await expect(page.locator("[data-workspace-creation-status]")).toContainText(
    "Update bycoda Host",
  );
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await expect(prompt).toHaveValue("Keep this failed worktree draft");
  await page.getByRole("button", { name: "Use current checkout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await expect(prompt).toHaveValue("Keep this failed worktree draft");
});

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`native intent pending, newer draft and unknown status retry ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/quick-composer.html?theme=${theme}`);
      const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
      const count = (command: string) =>
        page.evaluate(
          (name) =>
            (window as any).quickFixtureCalls.filter((call: any) => call.command === name).length,
          command,
        );
      await page.evaluate(() => {
        (window as any).quickFixture.hold = true;
      });
      await prompt.fill("Original accepted prompt");
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect.poll(() => count("quick_composer_submit_intent")).toBe(1);
      await prompt.fill("Newer unsent prompt kept through the old acknowledgment");
      await page.screenshot({
        path: info.outputPath(`quick-pending-${theme}-${width}.png`),
        animations: "disabled",
      });
      await page.evaluate(() => {
        (window as any).quickFixture.hold = false;
        (window as any).quickFixture.finish();
      });
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
      await expect(prompt).toHaveValue("Newer unsent prompt kept through the old acknowledgment");
      expect(
        await page.evaluate(
          () =>
            (window as any).quickFixtureCalls.find(
              (call: any) => call.command === "quick_composer_submit_intent",
            ).args.submission.request.prompt,
        ),
      ).toBe("Original accepted prompt");
      await page.screenshot({
        path: info.outputPath(`quick-newer-${theme}-${width}.png`),
        animations: "disabled",
      });
      await page.evaluate(() => {
        (window as any).quickFixture.fail = true;
      });
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(prompt).toHaveValue("Newer unsent prompt kept through the old acknowledgment");
      await page.screenshot({
        path: info.outputPath(`quick-unknown-${theme}-${width}.png`),
        animations: "disabled",
      });
      await page.evaluate(() => {
        (window as any).quickFixture.fail = false;
      });
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(prompt).toHaveValue("");
      expect(await count("quick_composer_submit_status")).toBe(1);
      expect(await count("quick_composer_submit_intent")).toBe(2);
      expect(await count("quick_composer_submit")).toBe(0);
    });
  }
}
