import { expect, test, type Page } from "@playwright/test";

test("usage surfaces stay compact in both themes and show hour context on hover", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 960 });
      await page.goto(
        `/tests/browser/usage/usage-budgets.html?page=1&analytics=1&stress=1&theme=${theme}`,
      );
      await expect(page.locator(".usage-analytics")).toHaveAttribute("aria-busy", "false");
      for (const view of ["Overview", "Projects", "Time analysis", "Limits"]) {
        await page.getByRole("tab", { name: view, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `temp/verification/usage-polish-20261110/${view.replaceAll(" ", "-")}-${theme}-${width}.png`,
          fullPage: true,
          animations: "disabled",
          style:
            "html, body, #root, [data-settings-scroller] { block-size: auto !important; max-block-size: none !important; overflow: visible !important; }",
        });
        if (view === "Limits") {
          await page.locator('.usage-account[aria-label="Grok"]').screenshot({
            path: `temp/verification/usage-polish-20261110/Grok-row-${theme}-${width}.png`,
            animations: "disabled",
          });
        }
        if (view === "Time analysis") {
          const hour = page.locator('.usage-hour-cell:not([data-level="0"])').first();
          await hour.hover();
          const tooltip = page.getByRole("tooltip");
          await expect(tooltip).toContainText("GPT-5.5");
          await expect(tooltip).toContainText("Claude Sonnet 4.6");
          await expect(tooltip).toContainText(/app|portal/);
          await page.screenshot({
            path: `temp/verification/usage-polish-20261110/Hour-tooltip-${theme}-${width}.png`,
            animations: "disabled",
          });
          await hour.click();
          await expect(page.locator(".usage-hour-cell")).toHaveCount(24);
          const grid = page.locator(".usage-week-grid");
          expect(
            await grid
              .locator('[role="row"]')
              .evaluateAll((rows) => rows.every((row) => row.children.length === 2)),
          ).toBe(true);
        }
      }
      await page.goto(`/tests/browser/usage/usage-budgets.html?footer=1&theme=${theme}`);
      const chip = page.getByRole("button", { name: "Grok Build usage details", exact: true });
      await expect(chip).toBeVisible();
      await page.screenshot({
        path: `temp/verification/usage-polish-20261110/Footer-${theme}-${width}.png`,
        animations: "disabled",
      });
      await chip.click();
      await expect(
        page.getByRole("dialog", { name: "Grok Build usage details", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `temp/verification/usage-polish-20261110/Footer-details-${theme}-${width}.png`,
        animations: "disabled",
      });
    }
  }
  expect(errors).toEqual([]);
});
async function select(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
async function openFilters(page: Page) {
  await page.getByRole("button", { name: /^Filters(?: \(\d+\))?$/, exact: true }).click();
}

test("usage values and chart table follow the selected language", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/usage/usage-budgets.html?page=1&analytics=1&lang=tr");
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
    await page.goto(`/tests/browser/usage/usage-budgets.html?page=1&analytics=1&theme=${theme}`);
    await expect(page.locator(".usage-analytics")).toHaveAttribute("aria-busy", "false");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".usage-metrics > div")).toHaveCount(3);
      const trend = page.locator('[data-usage-chart="trend"]');
      // The trend starts within two thirds of a screen below the analytics header, under the KPI
      // stack; the account's Active time card above the analytics is not part of this budget.
      const analytics = (await page.locator(".usage-analytics").boundingBox())!;
      expect((await trend.boundingBox())!.y - analytics.y).toBeLessThan(600);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `temp/verification/2026-10-22-design-audit/usage/overview-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
    const usageDetails = page.locator(".usage-details-disclosure");
    await usageDetails.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(usageDetails).toHaveAttribute("open", "");
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
    await page.goto(`/tests/browser/usage/usage-budgets.html?page=1&analytics=1&theme=${theme}`);
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
    await expect(dialog.getByRole("grid")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Filters", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Date and time range", exact: true }).click();
    await expect(dialog).toBeVisible();
    const date = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    await dialog.getByLabel("Start date and time", { exact: true }).fill(`${date}T14:00`);
    await dialog.getByLabel("Start date and time", { exact: true }).press("Enter");
    await dialog.getByLabel("End date and time", { exact: true }).fill(`${date}T13:00`);
    await dialog.getByLabel("End date and time", { exact: true }).press("Enter");
    const applyRange = dialog.getByRole("button", { name: "Apply", exact: true });
    await expect(applyRange).toHaveAccessibleName("Apply");
    await expect(applyRange).toBeDisabled();
    await dialog.getByLabel("End date and time", { exact: true }).fill(`${date}T18:00`);
    await dialog.getByLabel("End date and time", { exact: true }).press("Enter");
    await expect(applyRange).toBeEnabled();
    await applyRange.click();
    await expect(dialog).toBeHidden();
    await select(page, "Resolution", "Hourly");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-usage-chart="trend"] details table tbody tr')).toHaveCount(4);
    await page.getByRole("tab", { name: "Time analysis", exact: true }).click();
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
    await page.getByRole("option", { name: "Codex", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Filters (1)", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Projects", exact: true }).click();
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
    await page.getByRole("button", { name: /Fixture session$/ }).click();
    await expect(page.getByText("turns with duration", { exact: false }).first()).toBeVisible();
    await openFilters(page);
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Limits", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Limit history", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
test("usage analytics and exact date/time controls are localized in Turkish", async ({ page }) => {
  await page.goto("/tests/browser/usage/usage-budgets.html?page=1&analytics=1&lang=tr");
  await expect(page.getByRole("tab", { name: "Genel bakış", exact: true })).toBeVisible();
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
  await page.goto("/tests/browser/usage/usage-budgets.html?page=1&analytics=1");
  await expect(page.locator(".usage-analytics")).toHaveAttribute("aria-busy", "false");
  // Usage uses the shared 80rem Settings column (1280px including its inline padding).
  const analyticsWidth = (await page.locator(".usage-analytics").boundingBox())!.width;
  expect(analyticsWidth).toBeGreaterThan(900);
  expect(analyticsWidth).toBeLessThanOrEqual(1280);
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
  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await expect(page.locator('[data-usage-chart="trend"]')).toHaveCount(0);
  await openFilters(page);
  await expect(page.getByRole("button", { name: "Group by: Project", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /portal$/ })).toBeVisible();
  await page.screenshot({
    path: "temp/verification/2026-10-22-design-audit/usage/projects-wide.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Time analysis", exact: true }).click();
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

for (const theme of ["light", "dark"])
  for (const width of [800, 1280]) {
    test(`shared usage quota hover and account dividers ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/usage/usage-budgets.html?page=1&analytics=1&theme=${theme}`);
      await page.getByRole("tab", { name: "Limits", exact: true }).click();
      const row = page.locator('[data-setting-id="show-remaining-usage"]');
      const toggle = row.getByRole("switch", { name: "Show remaining usage", exact: true });
      const initial = await toggle.getAttribute("aria-checked");
      await expect(row).toHaveAttribute("data-press-feedback", "false");
      await expect(row).toHaveCSS("border-top-left-radius", "0px");
      const accounts = page.locator(".usage-accounts > .usage-account");
      await expect(accounts).toHaveCount(4);
      await expect(accounts.first()).toHaveCSS("border-bottom-width", "1px");
      await expect(accounts.last()).toHaveCSS("border-bottom-width", "0px");
      const colors = await accounts.first().evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.borderTop = "1px solid var(--ui-settings-group-border)";
        node.append(probe);
        const expected = getComputedStyle(probe).borderTopColor;
        probe.remove();
        return { expected, actual: getComputedStyle(node).borderBottomColor };
      });
      expect(colors.actual).toBe(colors.expected);
      await page.mouse.move(width - 2, 2);
      await page.screenshot({
        path: `temp/verification/usage-surfaces/limits-${theme}-${width}.png`,
        fullPage: true,
      });
      await row.locator("span").first().hover();
      const hover = await row.evaluate((node) => getComputedStyle(node).backgroundImage);
      expect(hover).toContain("linear-gradient");
      await page.mouse.down();
      expect(await row.evaluate((node) => getComputedStyle(node).backgroundImage)).toBe(hover);
      await expect(toggle).toHaveAttribute("aria-checked", initial!);
      await page.screenshot({
        path: `temp/verification/usage-surfaces/inert-press-${theme}-${width}.png`,
      });
      await page.mouse.up();
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", initial === "true" ? "false" : "true");
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await page.screenshot({
        path: `temp/verification/usage-surfaces/toggled-focus-${theme}-${width}.png`,
      });
      await page.reload();
      await page.getByRole("tab", { name: "Limits", exact: true }).click();
      await expect(
        page.getByRole("switch", { name: "Show remaining usage", exact: true }),
      ).toHaveAttribute("aria-checked", initial === "true" ? "false" : "true");
    });
  }

for (const theme of ["light", "dark"]) {
  for (const width of [800, 1280]) {
    test(`usage paint geometry ${theme} ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/usage/usage-budgets.html?page=1&analytics=1&stress=1&theme=${theme}`,
      );
      await expect(page.locator(".usage-analytics")).toHaveAttribute("aria-busy", "false");
      await page.getByRole("tab", { name: "Projects", exact: true }).click();
      const bars = page.locator(".usage-rank-track > span");
      await expect(bars.first()).toBeVisible();
      expect(
        await bars.evaluateAll((nodes) =>
          nodes.every((node) => {
            const width = node.getBoundingClientRect().width;
            return width > 0 && width <= node.parentElement!.getBoundingClientRect().width;
          }),
        ),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("rank.png"), animations: "disabled" });
      await page.getByRole("tab", { name: "Time analysis", exact: true }).click();
      await expect(page.locator(".usage-hour-cell")).toHaveCount(168);
      const grid = page.getByRole("grid", { name: "Day and hour activity", exact: true });
      await grid.getByRole("gridcell").first().focus();
      await page.keyboard.press("ArrowDown");
      await expect(grid.getByRole("gridcell").nth(7)).toBeFocused();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath("time.png"), animations: "disabled" });
      await grid.getByRole("gridcell").nth(7).click();
      await expect(page.locator(".usage-hour-cell")).toHaveCount(24);
      expect(
        await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length),
      ).toBe(2);
      // Hour drilldown narrows the shared window; reset it before testing the seeded quota history.
      await page.goto(
        `/tests/browser/usage/usage-budgets.html?page=1&analytics=1&stress=1&theme=${theme}`,
      );
      await page.getByRole("tab", { name: "Limits", exact: true }).click();
      const plot = page.locator(".usage-quota-plot");
      await expect(plot).toBeVisible();
      await plot.scrollIntoViewIfNeeded();
      await expect(plot).toHaveCSS("margin-left", "36px");
      await expect(page.locator(".usage-quota-point").first()).toBeVisible();
      const points = await page.locator(".usage-quota-point").evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node);
          return [style.backgroundColor, style.left, style.bottom];
        }),
      );
      expect(
        points.every(
          ([color, left, bottom]) =>
            color !== "rgba(0, 0, 0, 0)" && parseFloat(left) >= 0 && parseFloat(bottom) >= 0,
        ),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("quota.png"), animations: "disabled" });
      await page.getByRole("button", { name: "Account actions", exact: true }).first().click();
      await expect(page.getByRole("menu", { name: "Account color", exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("account-colors.png"),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}
