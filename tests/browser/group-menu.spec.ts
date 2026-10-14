import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1440]) {
  test(`keeps grouped flyouts inside a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/tests/browser/group-menu.html");
    const root = page.getByRole("menu", { name: "Project group actions", exact: true });
    for (const edge of ["left", "right", "bottom"]) {
      await page.getByRole("button", { name: `Open ${edge}`, exact: true }).click();
      await expect(root).toBeVisible();
      const bounds = await root.boundingBox();
      expect(bounds!.height).toBeLessThan(400);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      await root.getByRole("menuitem", { name: "Reorder group" }).hover();
      const flyout = page.getByRole("menu", { name: "Reorder group", exact: true });
      await expect(flyout).toBeVisible();
      await expect(flyout).toHaveAttribute("data-popover-side", edge === "left" ? "right" : "left");
      const branch = await flyout.boundingBox();
      expect(branch!.x).toBeGreaterThanOrEqual(0);
      expect(branch!.x + branch!.width).toBeLessThanOrEqual(width);
      expect(branch!.y + branch!.height).toBeLessThanOrEqual(760);
      await page.keyboard.press("Escape");
      await expect(flyout).not.toBeVisible();
      await expect(root).toBeVisible();
      await root.getByRole("menuitem", { name: "Delete", exact: true }).click();
      const deletion = page.getByRole("menu", { name: "Delete", exact: true });
      await expect(
        deletion.getByRole("menuitem", { name: "Delete group", exact: true }),
      ).toBeVisible();
      await expect(
        deletion.getByRole("menuitem", { name: "Delete group with projects", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(root).not.toBeVisible();
    }
  });
}

test("preserves appearance controls and supports keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 760 });
  await page.goto("/tests/browser/group-menu.html");
  await page.getByRole("button", { name: "Open right", exact: true }).click();
  const root = page.getByRole("menu", { name: "Project group actions", exact: true });
  await root.getByRole("menuitem", { name: "Appearance", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const appearance = page.getByRole("dialog", { name: "Appearance", exact: true });
  await expect(appearance).toBeVisible();
  await expect(appearance.getByRole("searchbox", { name: "Search project icons" })).toBeVisible();
  await expect(appearance).toHaveAttribute("data-popover-side", "left");
  await page.keyboard.press("Escape");
  await expect(appearance).not.toBeVisible();
  await expect(root.getByRole("menuitem", { name: "Appearance", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(root.getByRole("menuitem", { name: "Reorder group", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const flyout = page.getByRole("menu", { name: "Reorder group", exact: true });
  await expect(flyout).toBeVisible();
  await flyout.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
  });
  await page.screenshot({ path: "temp/verification/2026-10-13-group-menu/left-flyout.png" });
  await page.keyboard.press("Escape");
  await root.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const deletion = page.getByRole("menu", { name: "Delete", exact: true });
  await expect(deletion).toBeVisible();
  await deletion.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
  });
  await page.screenshot({ path: "temp/verification/2026-10-13-group-menu/delete-flyout.png" });
});
