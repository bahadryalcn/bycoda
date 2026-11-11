import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`group menu exposes hover, keyboard and expanded states in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/tests/browser/group-menu.html", {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.evaluate((value) => {
      document.documentElement.classList.toggle("theme-light", value === "light");
      document.documentElement.dataset.canvasBackground = "pure";
    }, theme);
    await page.getByRole("button", { name: "Open left", exact: true }).click();
    const root = page.getByRole("menu", { name: "Project group actions", exact: true });
    const hoverRow = root.getByRole("menuitem", { name: "Lock group", exact: true });
    const lock = root.getByRole("menuitem", { name: "Lock group", exact: true });
    const fill = (row: typeof hoverRow) =>
      row.evaluate((element) => getComputedStyle(element).backgroundColor);
    const resting = await fill(lock);
    await hoverRow.hover();
    await expect.poll(() => fill(hoverRow)).not.toBe(resting);
    await expect(hoverRow).not.toHaveCSS("box-shadow", "none");
    await page.screenshot({ path: `temp/verification/2026-11-11-group-menu/hover-${theme}.png` });
    await page.mouse.move(700, 500);
    await hoverRow.focus();
    await page.keyboard.press("ArrowUp");
    const reorder = root.getByRole("menuitem", { name: "Reorder group", exact: true });
    await expect(reorder).toBeFocused();
    await expect.poll(() => fill(reorder)).not.toBe(resting);
    const selected = await reorder.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--ui-surface-selected)";
      element.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    await expect.poll(() => fill(reorder)).toBe(selected);
    await page.keyboard.press("ArrowRight");
    const submenu = page.getByRole("menu", { name: "Reorder group", exact: true });
    await expect(submenu).toBeVisible();
    await expect(reorder).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => fill(reorder)).not.toBe(resting);
    await page.screenshot({
      path: `temp/verification/2026-11-11-group-menu/expanded-${theme}.png`,
    });
  });
}

for (const width of [390, 768, 1440]) {
  test(`keeps grouped flyouts inside a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/tests/browser/group-menu.html", {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
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
  await page.goto("/tests/browser/group-menu.html", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
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
  await expect(root.getByRole("menuitem", { name: "Move to group", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(root.getByRole("menuitem", { name: "Pin group", exact: true })).toHaveCount(0);
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

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`compact group appearance ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/group-menu.html", {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      await page.evaluate((value) => {
        document.documentElement.classList.toggle("theme-light", value === "light");
        document.documentElement.dataset.canvasBackground = "pure";
      }, theme);
      await page.getByRole("button", { name: "Open left", exact: true }).click();
      const root = page.getByRole("menu", { name: "Project group actions", exact: true });
      await expect(root.getByLabel("Group name", { exact: true })).toBeVisible();
      await expect(root.getByRole("menuitem", { name: "Pin group", exact: true })).toHaveCount(0);
      await page.screenshot({
        path: `temp/verification/2026-11-11-sidebar/group-menu-${theme}-${width}.png`,
        animations: "disabled",
      });
      await root.getByRole("menuitem", { name: "Appearance", exact: true }).click();
      const appearance = page.getByRole("dialog", { name: "Appearance", exact: true });
      await expect(appearance).toBeVisible();
      await expect(appearance.getByText("Background colors", { exact: true })).toBeVisible();
      await appearance.getByRole("checkbox", { name: "Group header", exact: true }).check();
      await appearance.getByRole("checkbox", { name: "Expanded contents", exact: true }).check();
      await expect(
        appearance.getByRole("slider", { name: "Group header: Opacity", exact: true }),
      ).toBeVisible();
      await expect(
        appearance.getByRole("slider", { name: "Expanded contents: Opacity", exact: true }),
      ).toBeVisible();
      const palette = await appearance
        .getByRole("button", { name: /^Color [1-5]$/ })
        .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().y));
      expect(palette).toHaveLength(5);
      expect(Math.max(...palette) - Math.min(...palette)).toBeLessThan(1);
      const bounds = await appearance.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
      await page.screenshot({
        path: `temp/verification/2026-11-11-sidebar/appearance-${theme}-${width}.png`,
        animations: "disabled",
      });
    });
  }
}
