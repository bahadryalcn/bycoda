import { expect, test } from "@playwright/test";

const shots = "temp/verification/folder-picker-layout";

for (const theme of ["light", "dark"] as const) {
  for (const [width, height] of [
    [1280, 800],
    [800, 800],
    [625, 630],
    [390, 800],
    [625, 450],
  ]) {
    test(`${theme} ${width}x${height}: contained list and reachable actions`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await page.goto("/tests/browser/projects/folder-picker.html");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const list = page.getByRole("listbox", { name: "Folders" });
      await expect(list.getByRole("option").first()).toBeVisible();
      await page.screenshot({ path: `${shots}/after-${theme}-${width}x${height}.png` });
      const bounds = await page.getByRole("dialog").boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      const listBounds = await list.boundingBox();
      const checkbox = await list.getByRole("checkbox").first().boundingBox();
      expect(checkbox!.x - listBounds!.x).toBeGreaterThanOrEqual(8);
      const footer = page.getByRole("button", { name: "New folder", exact: true });
      await expect(footer).toBeInViewport();
      const footerBounds = await footer.boundingBox();
      expect(listBounds!.y + listBounds!.height).toBeLessThanOrEqual(footerBounds!.y);
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const last = list.getByRole("option").last();
      await expect(last).toBeInViewport();
      expect(await last.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await footer.click();
      await expect(page.getByRole("textbox", { name: "New folder name" })).toBeInViewport();
      await expect(page.getByRole("button", { name: "Create", exact: true })).toBeInViewport();
      await page.screenshot({ path: `${shots}/after-create-${theme}-${width}x${height}.png` });
    });
  }
}
