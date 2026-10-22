import { expect, test, type Page } from "@playwright/test";

for (const [theme, width] of [
  ["dark", 1280],
  ["light", 390],
] as const) {
  test(`usage page keeps quota, analysis choices and privacy usable ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/tests/browser/usage-budgets.html?page=1&theme=${theme}`);
    const accounts = page.locator(".usage-account");
    await expect(accounts).toHaveCount(3);
    await page.getByRole("radio", { name: "Limits", exact: true }).click();
    await expect(accounts.first().getByRole("meter").first()).toHaveAttribute(
      "aria-valuenow",
      "68",
    );
    await expect(accounts.nth(1).getByText("18%", { exact: true })).toBeVisible();
    await expect(accounts.nth(2).getByRole("alert")).toContainText("sign-in expired");
    const cards = await accounts.evaluateAll((nodes) =>
      nodes.map((node) => {
        const b = node.getBoundingClientRect();
        return { top: b.top, height: b.height };
      }),
    );
    for (const card of cards)
      for (const peer of cards)
        if (Math.abs(card.top - peer.top) < 2)
          expect(Math.abs(card.height - peer.height)).toBeLessThan(2);
    expect(await accounts.first().evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(
      290,
    );

    await page.screenshot({
      path: `temp/verification/2026-10-18-usage/usage-overview-${theme}-${width}.png`,
      animations: "disabled",
    });
    const cost = page.getByRole("radio", { name: "Overview", exact: true });
    await cost.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("heading", { name: "Recorded sessions" })).toBeVisible();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await page.keyboard.press("Escape");
    await cost.click();
    await page.getByRole("radio", { name: "Time analysis", exact: true }).click();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("radio", { name: "Limits", exact: true }).click();
    await page.locator(".usage-display-preferences > summary").click();
    await page.getByRole("switch", { name: "Show remaining usage", exact: true }).click();
    await page.getByRole("radio", { name: "Limits", exact: true }).click();
    await expect(accounts.first().getByRole("meter").first()).toHaveAttribute(
      "aria-valuenow",
      "32",
    );
    await expect(accounts.first().getByText("used", { exact: true })).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.locator(".usage-toolbar").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `temp/verification/2026-10-18-usage/usage-${theme}-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  });
}

async function select(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
test("creates, edits, persists and removes a project token allocation", async ({ page }) => {
  await page.goto("/tests/browser/usage-budgets.html");
  await page.getByRole("button", { name: "Add budget", exact: true }).click();
  await select(page, "Budget target", "C:/fixture/app");
  await page.getByLabel("Budget name", { exact: true }).fill("Project allocation");
  await page.getByLabel("Token capacity", { exact: true }).fill("10000");
  await page.getByLabel("Allocation (%)", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  await expect(page.getByText("Budget saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("meter")).toHaveAttribute("aria-valuenow", "1250");
  await expect(page.getByRole("meter")).toHaveAttribute("aria-valuemax", "2500");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Project allocation", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Allocation (%)", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  await expect(page.getByText("Budget reached", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("No usage budgets.", { exact: false })).toBeVisible();
});
test("supports session and workspace scopes and 5-hour account thresholds", async ({ page }) => {
  await page.goto("/tests/browser/usage-budgets.html");
  await page.getByRole("button", { name: "Add budget", exact: true }).click();
  await select(page, "Scope", "Session");
  await select(page, "Budget target", "Fixture session · C:/fixture/app");
  await page.getByLabel("Budget name", { exact: true }).fill("Session allowance");
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Session allowance" })).toBeVisible();
  await page.getByRole("button", { name: "Add budget", exact: true }).click();
  await select(page, "Scope", "Workspace");
  await select(page, "Budget target", "Fixture workspace");
  await page.getByLabel("Budget name", { exact: true }).fill("Account ceiling");
  await select(page, "Measurement", "Provider account threshold (%)");
  await select(page, "Period", "5 hours");
  await select(page, "Provider account", "codex · Fixture account");
  await page.getByLabel("Account usage threshold (%)", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Save budget", exact: true }).click();
  await expect(
    page.getByText("Account-wide threshold, not attributed scope consumption.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("32.0% / 30.0%", { exact: false })).toBeVisible();
  await page.screenshot({
    path: "temp/test-results/usage-budgets/meters-dark.png",
    fullPage: true,
  });
});

test("shows Turkish budget controls", async ({ page }) => {
  await page.goto("/tests/browser/usage-budgets.html?lang=tr");
  await page.getByRole("button", { name: "Bütçe ekle", exact: true }).click();
  await expect(page.getByLabel("Bütçe adı", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Ayrılan pay (%)", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bütçeyi kaydet", exact: true })).toBeVisible();
});
test("keeps the editor usable at narrow width in light theme and reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/usage-budgets.html?theme=light");
  await page.getByRole("button", { name: "Add budget", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Budget name", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save budget", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: "temp/test-results/usage-budgets/editor-light-narrow.png",
    fullPage: true,
  });
});
for (const [theme, width, motion] of [
  ["light", 390, "off"],
  ["dark", 1440, "reduce"],
  ["dark", 1440, "auto"],
] as const) {
  test(`overview KPI ${theme} ${width} ${motion}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: motion === "reduce" ? "reduce" : "no-preference" });
    await page.goto(`/tests/browser/usage-budgets.html?overview=1&theme=${theme}&motion=${motion}`);

    const values = page.locator(".usage-metrics strong > .bycoda-arc");
    await expect(values).toHaveCount(6);
    await expect(values.nth(1)).toHaveText(motion === "auto" ? /1.0K/ : "1.0K");
    if (motion !== "auto") await expect(values.locator('[aria-hidden="true"]')).toHaveCount(0);
    await page.evaluate(() => {
      (window as any).refreshUsageFixture();
      (window as any).refreshUsageFixture();
    });
    await expect
      .poll(() =>
        values
          .nth(1)
          .evaluate((node) =>
            node.querySelector("[aria-hidden]")
              ? node.firstElementChild?.textContent
              : node.textContent,
          ),
      )
      .toBe("3.0K");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('[data-usage-chart="trend"] .bycoda-arc-chart svg')).toBeVisible();
    await page.screenshot({
      path: `temp/verification/2026-10-16-ui-system/W5b-AUX-kpi-${theme}-${motion}.png`,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  });
}
