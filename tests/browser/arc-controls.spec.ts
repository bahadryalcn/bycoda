import { expect, test } from "@playwright/test";

test("additional Arc controls preserve data, keyboard actions and inline recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/arc-controls.html");
  const additions = page.getByRole("region", { name: "Additional Arc controls" });
  await additions.getByRole("searchbox", { name: "Search JSON" }).fill("59");
  await expect(additions.getByRole("treeitem").filter({ hasText: /59/ }).first()).toBeVisible();
  await additions.getByRole("button", { name: "Remove filter: Project: bycoda" }).click();
  await expect(
    additions.getByRole("button", { name: "Remove filter: Project: bycoda" }),
  ).toHaveCount(0);
  await additions.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(additions.getByText("No filters applied", { exact: true })).toBeVisible();
  const table = additions.getByRole("table", { name: "Project usage" });
  await table.getByRole("button", { name: "Sort by Cost", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toContainText("Beta");
  await table.getByRole("button", { name: "Sort by Cost", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toContainText("Alpha");
  const title = additions.getByRole("button", { name: /^Note title:/ });
  await title.click();
  await additions.getByRole("textbox", { name: "Note title", exact: true }).fill("Renamed note");
  await page.keyboard.press("Enter");
  await expect(title).toContainText("Renamed note");
  await additions.getByLabel("Reject next rename").check();
  await title.click();
  await additions.getByRole("textbox", { name: "Note title", exact: true }).fill("Rejected name");
  await page.keyboard.press("Enter");
  await expect(title).toContainText("Renamed note");
  await expect(additions.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  const recorder = additions.getByRole("button", { name: "Change fixture shortcut", exact: true });
  await recorder.click();
  await page.keyboard.press("Control+Shift+J");
  await expect(recorder).toContainText("J");
  await recorder.click();
  await page.keyboard.press("Escape");
  await expect(recorder).toContainText("J");
  await additions.getByRole("button", { name: "Reset fixture shortcut", exact: true }).click();
  await expect(recorder).toContainText("Ctrl+K");
  expect(errors).toEqual([]);
});

test("date ranges and destructive confirmation apply only after confirmation", async ({ page }) => {
  await page.goto("/tests/browser/arc-controls.html");
  const additions = page.getByRole("region", { name: "Additional Arc controls" });
  const date = additions.getByRole("button", { name: /^Date range:/ });
  await date.click();
  await expect(page.getByRole("dialog", { name: "Date range", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(date).toBeFocused();
  await expect(additions.getByLabel("Applied range")).toHaveText("No range");
  await date.click();
  const dialog = page.getByRole("dialog", { name: "Date range", exact: true });
  await dialog.getByRole("button", { name: "Last 7 days", exact: true }).click();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(additions.getByLabel("Applied range")).not.toHaveText("No range");
  await additions.getByRole("button", { name: "Delete fixture note", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(additions.getByLabel("Deletion result")).toHaveText("Retained");
  await additions.getByRole("button", { name: "Delete fixture note", exact: true }).click();
  await page.waitForTimeout(300);
  await additions.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(additions.getByLabel("Deletion result")).toHaveText("Deleted");
});

test("image comparison accepts a selected image and retains keyboard and dismissal behavior", async ({
  page,
}) => {
  await page.goto("/tests/browser/arc-controls.html");
  await page.getByRole("button", { name: "Open image comparison", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Image preview: Original fixture" });
  await dialog.getByLabel("Compare with image").setInputFiles({
    name: "after.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="white"/><circle cx="400" cy="300" r="150" fill="gray"/></svg>',
    ),
  });
  const divider = dialog.getByRole("slider", { name: "Compare images", exact: true });
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "49");
  await page.keyboard.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "50");
  expect(await divider.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(30);
  await dialog.getByRole("button", { name: "Stop comparison", exact: true }).click();
  await expect(divider).toHaveCount(0);
  await expect(dialog.getByRole("img", { name: "Original fixture" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("additional surfaces fit narrow and wide windows in both themes and reduced motion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/arc-controls.html");
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const light of [false, true]) {
      await page.evaluate(
        ({ light }) => {
          document.documentElement.classList.toggle("theme-light", light);
          document.documentElement.style.setProperty(
            "--user-accent-color",
            light ? "#4965d0" : "#909090",
          );
        },
        { light },
      );
      await page.getByRole("region", { name: "Additional Arc controls" }).scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const picker = page.getByRole("button", { name: /^Date range:/ });
      await picker.click();
      const panel = page.getByRole("dialog", { name: "Date range", exact: true });
      const bounds = await panel.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: `temp/verification/2026-10-13-arc-additions/${width}-${light ? "light" : "dark"}.png`,
      });
    }
  }
  expect(errors).toEqual([]);
});

test("additional controls localize their actions and accessibility labels", async ({ page }) => {
  await page.goto("/tests/browser/arc-controls.html");
  await page.getByRole("button", { name: "Türkçe controls", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "JSON'da ara", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tümünü temizle", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Tarih aralığı:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Tarih aralığı", exact: true });
  await expect(dialog.getByRole("button", { name: "Son 7 gün", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Bu çeyrek", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Uygula", exact: true })).toBeVisible();
});

test("preserves settings interaction, compact geometry and both themes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/arc-controls.html");
  const toggle = page.getByRole("switch", { name: "Enable sounds", exact: true });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  const height = await toggle.evaluate((node) => node.getBoundingClientRect().height);
  expect(height).toBe(28);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(await toggle.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
  await expect(page.getByRole("switch", { name: "Unavailable setting" })).toBeDisabled();

  const slider = page.getByRole("slider", { name: "Opacity", exact: true });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "51");
  await expect(slider).toHaveAttribute("aria-valuetext", "51%");
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");

  const compact = page.getByRole("radio", { name: "Compact", exact: true });
  await compact.focus();
  await page.keyboard.press("ArrowRight");
  const comfortable = page.getByRole("radio", { name: "Comfortable", exact: true });
  await expect(comfortable).toBeFocused();
  await expect(comfortable).toHaveAttribute("aria-checked", "true");
  await page.getByRole("textbox", { name: "Filter notes", exact: true }).fill("launch");
  await expect(page.getByRole("textbox", { name: "Filter notes", exact: true })).toHaveValue(
    "launch",
  );

  const themed = page.getByRole("button", { name: "Light theme", exact: true });
  const darkBackground = await themed.evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.screenshot({ path: "temp/verification/2026-10-13-arc-controls/dark.png" });
  await themed.click();
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: "Dark theme", exact: true })
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .not.toBe(darkBackground);
  await page.screenshot({ path: "temp/verification/2026-10-13-arc-controls/light.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(comfortable).toBeInViewport();
  await page.screenshot({ path: "temp/verification/2026-10-13-arc-controls/narrow.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(
    await toggle.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).getPropertyValue("--duration-fast")),
    ),
  ).toBe(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("selection, expanding details and history keep their interactions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/tests/browser/arc-controls.html");
  const standard = page.getByRole("button", { name: /^Standard choice:/ });
  await standard.click();
  await page.getByRole("option", { name: "Second", exact: true }).click();
  await expect(standard).toContainText("Second");
  const search = page.getByRole("button", { name: /^Search choice:/ });
  await search.click();
  await page.getByRole("combobox", { name: "Search options…" }).fill("First");
  await page.getByRole("option", { name: "First", exact: true }).click();
  await expect(search).toContainText("First");
  const morph = page.getByRole("combobox", { name: "Property choice" });
  await morph.click();
  await expect(page.getByRole("option", { name: "Second", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Second", exact: true }).click();
  await expect(morph).toContainText("Second");
  await morph.click();
  await page.keyboard.press("Escape");
  await expect(morph).toHaveAttribute("aria-expanded", "false");
  await expect(morph).toBeFocused();
  const card = page.getByRole("button", { name: "Draft details" });
  await card.click();
  const draft = page.getByRole("textbox", { name: "Retained draft" });
  await draft.fill("Keep this draft");
  await page.keyboard.press("Escape");
  await expect(card).toHaveAttribute("aria-expanded", "false");
  await expect(card).toBeFocused();
  await card.click();
  await expect(draft).toHaveValue("Keep this draft");
  await expect(page.getByRole("button", { name: "Open attempt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Completed attempt/ }).click();
  await expect(page.getByText("Review summary", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await morph.click();
  const option = page.getByRole("option", { name: "Second", exact: true });
  await expect(option).toBeVisible();
  await expect
    .poll(() =>
      option.evaluate((node) => {
        const shape = node.closest("[data-open]")?.querySelector('[role="listbox"]');
        return shape ? Number.parseFloat(getComputedStyle(shape.parentElement!).opacity) : 0;
      }),
    )
    .toBe(1);
  await expect
    .poll(() =>
      option.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const surface = node.closest("[data-open]")?.querySelector("[data-morph-surface]");
        const bounds = surface?.getBoundingClientRect();
        return (
          !!bounds && rect.bottom <= bounds.bottom + 1 && rect.left >= 0 && rect.right <= innerWidth
        );
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "temp/verification/2026-10-13-arc-controls/selection-narrow.png" });
  expect(errors).toEqual([]);
});
