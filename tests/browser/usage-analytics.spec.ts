import { expect, test, type Page } from "@playwright/test";
async function select(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
async function openFilters(page: Page) {
  await page.getByRole("button", { name: /^Filters(?: \(\d+\))?$/, exact: true }).click();
}

test("usage values and chart table follow the selected language", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/usage-budgets.html?page=1&analytics=1&lang=tr");
  await expect(page.locator(".usage-analytics")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".usage-metrics strong").first()).toContainText(/,\d{2}/);
  await expect(page.locator(".usage-metrics strong").first()).toContainText("$");
  const trend = page.locator('[data-usage-chart="trend"]');
  await trend.locator("summary").click();
  await expect(trend.locator("details").getByRole("table")).toBeVisible();
  await expect(trend.locator("details").getByRole("table")).toContainText(/%\d+,\d/);
});
test("keeps primary usage visible before optional detail at narrow widths", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"]) {
    await page.goto(`/tests/browser/usage-budgets.html?page=1&analytics=1&theme=${theme}`);
    await expect(page.locator(".usage-analytics")).toHaveAttribute("aria-busy", "false");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".usage-metrics > div")).toHaveCount(3);
      const trend = page.locator('[data-usage-chart="trend"]');
      expect((await trend.boundingBox())!.y).toBeLessThan(500);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `temp/verification/2026-10-22-design-audit/usage/overview-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.getByRole("button", { name: "Usage details", exact: true }).click();
    await expect(page.locator(".usage-metrics > div")).toHaveCount(7);
    await expect(page.locator(".usage-facts")).toBeVisible();
  }
});
for (const [theme, width] of [
  ["dark", 1280],
  ["light", 390],
] as const) {
  test(`usage explores exact same-day time ranges, filters and session coverage ${theme}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/usage-budgets.html?page=1&analytics=1&theme=${theme}`);
    await expect(page.locator(".usage-analytics")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator('[data-usage-chart="trend"] .bycoda-arc-chart svg')).toBeVisible();
    await expect(page.locator('[data-usage-chart="share"] .bycoda-arc-chart svg')).toBeVisible();
    await page.screenshot({
      path: `temp/verification/2026-10-22-design-audit/usage/overview-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await openFilters(page);
    await page.getByRole("button", { name: "Date and time range", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Date and time range", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^Date range:/ }).click();
    await expect(page.getByRole("dialog", { name: "Date range", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Date range", exact: true })).toBeHidden();
    await expect(dialog).toBeVisible();
    const date = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    await dialog.getByLabel("Start date and time", { exact: true }).fill(`${date}T14:00`);
    await dialog.getByLabel("End date and time", { exact: true }).fill(`${date}T13:00`);
    const applyRange = dialog.locator('button[type="submit"]');
    await expect(applyRange).toHaveAccessibleName("Apply");
    await expect(applyRange).toBeDisabled();
    await dialog.getByLabel("End date and time", { exact: true }).fill(`${date}T18:00`);
    await applyRange.click();
    await expect(dialog).toBeHidden();
    await select(page, "Resolution", "Hourly");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-usage-chart="trend"] details table tbody tr')).toHaveCount(4);
    await page.getByRole("radio", { name: "Time analysis", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day and hour activity" })).toBeVisible();
    await expect(page.locator('[data-usage-chart="trend"]')).toHaveCount(0);
    await expect(page.locator(".usage-metrics")).toHaveCount(0);
    await expect(page.locator(".usage-hour-cell")).toHaveCount(24);
    await select(page, "Time grouping", "15 minutes");
    await expect(page.locator('[data-usage-chart="hourly"] table tbody tr')).toHaveCount(16);
    await page.screenshot({
      path: `temp/verification/2026-10-22-design-audit/usage/time-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await openFilters(page);
    const filters = page.getByRole("dialog", { name: "Filters", exact: true });
    await filters.getByRole("button", { name: /^Provider:/ }).click();
    await page.getByRole("option", { name: "codex", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Filters (1)", exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Projects", exact: true }).click();
    await expect(page.locator('[data-usage-chart="trend"]')).toHaveCount(0);
    await expect(page.locator(".usage-metrics")).toHaveCount(0);
    await openFilters(page);
    await expect(
      page.getByRole("button", { name: "Group by: Project", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Recorded sessions" })).toBeVisible();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("bycoda-usage.csv");
    await page.getByRole("button", { name: "Fixture session", exact: true }).click();
    await expect(page.getByText("turns with duration", { exact: false }).first()).toBeVisible();
    await openFilters(page);
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "Limits", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Limit history", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
test("usage analytics and exact date/time controls are localized in Turkish", async ({ page }) => {
  await page.goto("/tests/browser/usage-budgets.html?page=1&analytics=1&lang=tr");
  await expect(page.getByRole("radio", { name: "Genel bakış", exact: true })).toBeVisible();
  const trend = page.locator('[data-usage-chart="trend"]');
  const series = trend.locator('button[aria-pressed="true"]');
  await expect(series.first()).toBeVisible();
  while (await series.count()) await series.first().click();
  await expect(trend.getByText("Gösterilecek seriyi seçin", { exact: true })).toBeVisible();
  await expect(trend.getByText("Choose a series to show", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Filtreler", exact: true }).click();
  await page.getByRole("button", { name: "Tarih ve saat aralığı", exact: true }).click();
  await expect(page.getByLabel("Başlangıç tarihi ve saati", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Bitiş tarihi ve saati", { exact: true })).toBeVisible();
});

test("uses the full settings width, distinguishes views and follows configured account colors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/usage-budgets.html?page=1&analytics=1");
  await expect(page.locator(".usage-analytics")).toHaveAttribute("aria-busy", "false");
  expect((await page.locator(".usage-analytics").boundingBox())!.width).toBeGreaterThan(1800);
  const colors = () =>
    page
      .locator('[data-usage-chart="trend"]')
      .evaluate((root) =>
        Array.from(root.querySelectorAll<HTMLElement>("[style]")).map((node) =>
          node.style.getPropertyValue("--series"),
        ),
      );
  await expect.poll(colors).toContain("hsl(211 92% 62%)");
  await page.evaluate(() =>
    (window as unknown as { recolorUsageFixture: (color: string) => void }).recolorUsageFixture(
      "pink",
    ),
  );
  await expect.poll(colors).toContain("hsl(330 70% 62%)");
  await expect
    .poll(() =>
      page
        .locator('[data-usage-chart="share"] path[data-key="codex"]')
        .evaluate((node) => (node as SVGElement).style.getPropertyValue("--slice")),
    )
    .toBe("hsl(330 70% 62%)");
  await page.screenshot({
    path: "temp/verification/2026-10-22-design-audit/usage/overview-wide.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("radio", { name: "Projects", exact: true }).click();
  await expect(page.locator('[data-usage-chart="trend"]')).toHaveCount(0);
  await openFilters(page);
  await expect(page.getByRole("button", { name: "Group by: Project", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "portal", exact: true })).toBeVisible();
  await page.screenshot({
    path: "temp/verification/2026-10-22-design-audit/usage/projects-wide.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("radio", { name: "Time analysis", exact: true }).click();
  await expect(page.locator(".usage-hour-cell")).toHaveCount(168);
  const grid = page.getByRole("grid", { name: "Day and hour activity", exact: true });
  expect(await grid.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await grid.getByRole("gridcell").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(grid.getByRole("gridcell").nth(7)).toBeFocused();
  await page.screenshot({
    path: "temp/verification/2026-10-22-design-audit/usage/time-wide.png",
    fullPage: true,
    animations: "disabled",
  });
  await select(page, "Date range", "90 days");
  await expect(page.locator('[data-usage-chart="calendar"] [role="grid"]')).toBeVisible();
  await page.screenshot({
    path: "temp/verification/2026-10-22-design-audit/usage/activity-calendar.png",
    fullPage: true,
    animations: "disabled",
  });
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await grid.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({
    path: "temp/verification/2026-10-22-design-audit/usage/time-narrow.png",
    animations: "disabled",
  });
  await page.locator('[data-usage-chart="calendar"]').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "temp/verification/2026-10-22-design-audit/usage/calendar-narrow.png",
    animations: "disabled",
  });
});
