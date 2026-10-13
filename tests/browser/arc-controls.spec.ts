import { expect, test } from "@playwright/test";

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
  const lightBackground = await page
    .getByRole("button", { name: "Dark theme", exact: true })
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(lightBackground).not.toBe(darkBackground);
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
