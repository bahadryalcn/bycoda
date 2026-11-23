import { expect, test } from "@playwright/test";
import {
  PANE_MATRIX,
  expectFailureShownOnce,
  expectLayoutContracts,
  openPane,
} from "../support/uiLayoutAssertions";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
  await page.goto("/tests/browser/shared-ui/shared-controls.html");
  // Establish a prior focus target consistently across browser engines.
  const trigger = page.getByRole("button", { name: "Open controls" });
  await trigger.focus();
  await trigger.press("Enter");
});

test("modal background dismisses and restores focus while inside controls stay open", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Controlled date and time", exact: true }).click();
  await page.getByRole("button", { name: "Monday, February 21, 2028", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Shared controls" })).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open controls" })).toBeFocused();
});

test("controlled calendar follows dates and fits a narrow viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 460, height: 640 });
  await page.getByRole("button", { name: "Change date externally" }).click();
  const trigger = page.getByRole("button", { name: "Controlled date and time", exact: true });
  await expect(trigger).toHaveAccessibleDescription(await trigger.innerText());
  await trigger.click();
  await expect(page.getByRole("gridcell", { selected: true })).toContainText("4");
  await expect(
    page.getByRole("button", { name: "Sunday, March 4, 2029", exact: true }),
  ).toHaveAttribute("tabindex", "0");
  const dialog = page.getByRole("dialog", { name: "Shared controls" });
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(460);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
  await page.screenshot({ path: testInfo.outputPath("shared-controls-narrow.png") });
});

test("IME Enter and Escape preserve the menu and normal selection still works", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Choice: Alpha" }).click();
  const input = page.getByRole("combobox");
  await input.dispatchEvent("keydown", { key: "ArrowDown", isComposing: true });
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await input.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByTestId("selected-choice")).toHaveText("alpha");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page.getByTestId("selected-choice")).toHaveText("beta");
  await expect(page.getByRole("button", { name: "Choice: Beta" })).toBeFocused();
});

test("color input accepts partial edits and hue works by keyboard", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Hex color" });
  await input.fill("#12");
  await expect(input).toHaveValue("#12");
  await input.fill("#123456");
  await expect(input).toHaveValue("#123456");
  const hue = page.getByRole("slider", { name: "Hue", exact: true });
  await hue.focus();
  await hue.press("Home");
  await expect(hue).toHaveAttribute("aria-valuenow", "0");
  await hue.press("ArrowRight");
  await expect(hue).toHaveAttribute("aria-valuenow", "1");
});

// Runtime layout contracts for the shared controls inside a real 320 px pane. The beforeEach above
// opens the modal fixture; these tests navigate to their own fixture view first.
for (const { theme, width } of PANE_MATRIX) {
  test(`date pickers keep their layout contracts in a 320px pane ${theme} ${width}`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/shared-ui/shared-controls.html?pickers");
    await openPane(page, { theme, width, pane: '[data-pane="pickers"]' });
    await expectLayoutContracts(page, {
      surface: "shared-controls pickers (320px pane)",
      root: '[data-pane="pickers"]',
      checks: ["overflow", "clip", "overlap"],
    });
    // The picker rows are independent controls stacked in a column: 8px between them.
    await expectLayoutContracts(page, {
      surface: "shared-controls pickers column gaps (320px pane)",
      root: '[data-pane="pickers"]',
      checks: ["gap"],
      axis: "both",
    });
    // The invalid picker states its error once (field description), not again elsewhere.
    await expectFailureShownOnce(page, {
      surface: "shared-controls DatePicker error",
      message: "Choose a date.",
    });
  });

  test(`notification mute control keeps its layout contracts in a 320px pane ${theme} ${width}`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/shared-ui/shared-controls.html?mute");
    await openPane(page, { theme, width, pane: '[data-pane="mute"]' });
    await expectLayoutContracts(page, {
      surface: "shared-controls notification mute (320px pane)",
      root: '[data-pane="mute"]',
    });
  });
}
