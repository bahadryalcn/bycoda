import { test, expect } from "@playwright/test";

test("grouped commit forms retain their height and drafts after disclosure and resize", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/git-workspace.html?repositories");
  const panel = page.locator("[data-git-repository]").first();
  const toggle = panel.locator("header button[aria-expanded]").first();
  const message = panel.getByRole("textbox", { name: "Commit message", exact: true });
  await toggle.click();
  await expect(message).toBeVisible();
  expect((await message.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  const draft =
    "Preserve the worktree commit draft while its panel is reopened\n\nA longer body that wraps differently as the sidebar width changes.";
  await message.fill(draft);
  await toggle.click();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(message).toHaveValue(draft);
  for (const width of [280, 390, 566]) {
    await page.setViewportSize({ width, height: 650 });
    await page.locator("#root > div").evaluate((element, size) => {
      (element as HTMLElement).style.width = `${size}px`;
    }, width);
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await expect.poll(async () => (await message.boundingBox())!.height).toBeGreaterThan(32);
      const input = (await message.boundingBox())!;
      const commit = (await panel
        .getByRole("button", { name: "Commit", exact: true })
        .boundingBox())!;
      expect(commit.y).toBeGreaterThanOrEqual(input.y + input.height);
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await expect(panel.getByRole("button", { name: "Commit options" })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`commit-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
  await toggle.click();
  await toggle.click();
  await expect(message).toHaveValue(draft);
  expect((await message.boundingBox())!.height).toBeGreaterThan(32);
});

test("compact checkout header and branch fetch remain usable across widths and themes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/git-workspace.html?checkouts");
  const header = page.locator("[data-workspace-source-control] > div").first();
  const branch = page.getByRole("button", { name: /^Branch / }).first();
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      await expect(header.getByText("Working copy", { exact: true })).toHaveCount(0);
      await expect(header.getByRole("button", { name: /^Working copy:/ })).toBeVisible();
      expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await expect(branch).toHaveAttribute("title", /Switch branch in this working copy/);
      await branch.focus();
      await page.keyboard.press("Enter");
      const picker = page.locator("[data-branch-picker]");
      await expect(picker.getByRole("button", { name: "Fetch", exact: true })).toBeVisible();
      expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`compact-${width}-${light ? "light" : "dark"}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
    }
  }
  await branch.click();
  await page.getByRole("button", { name: "Fetch", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { gitFixtureCalls: { command: string; args: { cwd?: string } }[] }
          ).gitFixtureCalls.filter((call) => call.command === "git_fetch").length,
      ),
    )
    .toBe(1);
  await expect(page.locator("[data-branch-picker]")).toBeVisible();
});

test("grouped repository files allow wheel scrolling the outer list", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.setViewportSize({ width: 390, height: 450 });
  await page.goto("/tests/browser/git-workspace.html?repositories");
  const panels = page.locator("[data-git-repository]");
  await expect(panels).toHaveCount(3);
  for (const panel of await panels.all()) {
    await panel.locator("header button[aria-expanded]").first().click();
  }
  const outer = page.locator("[data-workspace-source-control] > .overflow-y-auto");
  await outer.evaluate((element) => {
    element.scrollTop = 0;
  });
  expect(await outer.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await panels.first().getByText("workspace.tsx", { exact: true }).hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBe(0);
  await panels.first().getByText("workspace.tsx", { exact: true }).hover();
  await page.mouse.wheel(20, 100);
  await expect.poll(() => outer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("checkout rows preserve identity, keyboard disclosure and searchable selection", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language.git", "en"));
  await page.goto("/tests/browser/git-workspace.html?checkouts");
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    for (const light of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle("theme-light", value),
        light,
      );
      const row = page.locator(
        '[data-git-repository="/trees/audit/very-long-worktree-folder-name"]',
      );
      await expect(row.locator("header")).toContainText(
        "audit/2026-10-14-long-branch-name-for-responsive-review",
      );
      await expect(row.locator('header button[aria-label="Stage All Changes"]')).toHaveCount(0);
      await expect(page.locator("[data-current-checkout]")).toContainText("Current");
      expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`checkouts-${width}-${light ? "light" : "dark"}.png`),
      });
    }
  }
  const detached = page.locator('[data-git-repository="/trees/detached"]');
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(detached.locator("header")).toContainText("fd3caac");
  const toggle = detached.locator("header button[aria-expanded]").first();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(detached.locator('header button[aria-label="Stage All Changes"]')).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Working copy: All checkouts", exact: true }).click();
  await page.getByRole("combobox").fill("detached");
  await page.getByRole("option", { name: "Detached · /trees/detached", exact: true }).click();
  await expect(page.locator("[data-git-repository]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Working copy: Detached · /trees/detached", exact: true }),
  ).toBeVisible();
});
