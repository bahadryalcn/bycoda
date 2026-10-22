import { test, expect } from "@playwright/test";

test("resizes tool panels from their shared edge in all four placements", async ({ page }) => {
  await page.goto("/tests/browser/host-tools.html");
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
  await page.getByRole("button", { name: "Panel placement", exact: true }).click();
  await page.getByRole("menuitem", { name: "Separate Logs panel", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Tool panels" });
  const separator = page.getByRole("separator", { name: "Tool panels" });
  for (const side of ["right", "left", "bottom", "top"]) {
    await dock.getByRole("button", { name: /^Placement:/ }).click();
    await page
      .getByRole("menuitemradio", {
        name: `Dock ${side[0].toUpperCase()}${side.slice(1)}`,
        exact: true,
      })
      .click();
    const vertical = side === "top" || side === "bottom";
    await expect(separator).toHaveAttribute(
      "aria-orientation",
      vertical ? "horizontal" : "vertical",
    );
    const before = (await dock.boundingBox())!;
    const handle = (await separator.boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    const delta = side === "right" || side === "bottom" ? -70 : 70;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (vertical ? 0 : delta), y + (vertical ? delta : 0), { steps: 8 });
    await page.mouse.up();
    const after = (await dock.boundingBox())!;
    expect(vertical ? after.height : after.width).toBeCloseTo(
      (vertical ? before.height : before.width) + 70,
      0,
    );
    const main = (await page.locator(".tools-workspace-main").boundingBox())!;
    expect(vertical ? main.height : main.width).toBeGreaterThanOrEqual(vertical ? 180 : 320);
    await separator.focus();
    await page.keyboard.press("Enter");
    await expect(separator).toHaveAttribute("aria-valuenow", vertical ? "300" : "420");
  }
  await page.setViewportSize({ width: 600, height: 500 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await dock.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(separator).toHaveCount(0);
});
