import { expect, test, type Page } from "@playwright/test";

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

    const values = page.locator(".tabular-nums > .bycoda-arc");
    await expect(values).toHaveCount(4);
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
    await page.getByRole("radio", { name: "Tokens", exact: true }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("radio", { name: "Cost", exact: true })).toBeChecked();
    await page.screenshot({
      path: `temp/verification/2026-10-16-ui-system/W5b-AUX-kpi-${theme}-${motion}.png`,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  });
}
