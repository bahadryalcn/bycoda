import { expect, test, type Page } from "@playwright/test";
async function select(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
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
      path: `temp/verification/2026-10-18-usage-layout/overview-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Date and time range", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Date and time range", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^Date range:/ }).click();
    await expect(page.getByRole("dialog", { name: "Date range", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    const date = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    await dialog.getByLabel("Start date and time", { exact: true }).fill(`${date}T14:00`);
    await dialog.getByLabel("End date and time", { exact: true }).fill(`${date}T13:00`);
    await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
    await dialog.getByLabel("End date and time", { exact: true }).fill(`${date}T18:00`);
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).toBeHidden();
    await select(page, "Resolution", "Hourly");
    await expect(page.locator('[data-usage-chart="trend"] details table tbody tr')).toHaveCount(4);
    await page.getByRole("radio", { name: "Time analysis", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day and hour activity" })).toBeVisible();
    await expect(page.locator('[data-usage-chart="trend"]')).toHaveCount(0);
    await expect(page.locator(".usage-metrics")).toHaveCount(0);
    await expect(page.locator(".usage-hour-cell")).toHaveCount(24);
    await select(page, "Time grouping", "15 minutes");
    await expect(page.locator('[data-usage-chart="hourly"] table tbody tr')).toHaveCount(16);
    await page.screenshot({
      path: `temp/verification/2026-10-18-usage-layout/time-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const filters = page.getByRole("dialog", { name: "Filters", exact: true });
    await filters.getByRole("button", { name: /^Provider:/ }).click();
    await page.getByRole("option", { name: "codex", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.locator(".usage-filter-chips")).toContainText("codex");
    await page.getByRole("radio", { name: "Projects", exact: true }).click();
    await expect(page.locator('[data-usage-chart="trend"]')).toHaveCount(0);
    await expect(page.locator(".usage-metrics")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Group by: Project", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recorded sessions" })).toBeVisible();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe("bycoda-usage.csv");
    await page.getByRole("button", { name: "Fixture session", exact: true }).click();
    await expect(page.getByText("turns with duration", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
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
    path: "temp/verification/2026-10-18-usage-layout/overview-wide.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("radio", { name: "Projects", exact: true }).click();
  await expect(page.locator('[data-usage-chart="trend"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Group by: Project", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "portal", exact: true })).toBeVisible();
  await page.screenshot({
    path: "temp/verification/2026-10-18-usage-layout/projects-wide.png",
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
    path: "temp/verification/2026-10-18-usage-layout/time-wide.png",
    fullPage: true,
    animations: "disabled",
  });
  await select(page, "Date range", "90 days");
  await expect(page.locator('[data-usage-chart="calendar"] [role="grid"]')).toBeVisible();
  await page.screenshot({
    path: "temp/verification/2026-10-18-usage-layout/activity-calendar.png",
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
    path: "temp/verification/2026-10-18-usage-layout/time-narrow.png",
    animations: "disabled",
  });
  await page.locator('[data-usage-chart="calendar"]').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "temp/verification/2026-10-18-usage-layout/calendar-narrow.png",
    animations: "disabled",
  });
});
