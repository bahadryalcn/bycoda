import { expect, test } from "@playwright/test";

const shots = "temp/verification/folder-picker-layout";

test("hover and wheel scrolling leave keyboard navigation in control", async ({ page }) => {
  await page.goto("/tests/browser/projects/folder-picker.html");
  const list = page.getByRole("listbox", { name: "Folders" });
  const first = list.getByRole("option").first();
  await expect(first).toBeVisible();
  const active = await list.getAttribute("aria-activedescendant");
  await list.getByRole("option").nth(2).getByRole("button").hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0, { timeout: 1500 });
  await page.waitForTimeout(800);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(list).toHaveAttribute("aria-activedescendant", active!);
  await page.evaluate(() => {
    window.__folderScrollCalls = 0;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      window.__folderScrollCalls++;
      original.call(this, options);
    };
  });
  await page.mouse.wheel(0, 450);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(200);
  await expect(list).toHaveAttribute("aria-activedescendant", active!);
  expect(await page.evaluate(() => window.__folderScrollCalls)).toBe(0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await list.focus();
  await page.keyboard.press("ArrowDown");
  await expect(list).toHaveAttribute("aria-activedescendant", "folder-picker-1");
  await expect(list.getByRole("option").nth(1)).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Folder path" })).toHaveValue(
    "C:/Users/kraba/.agent-device",
  );
});

declare global {
  interface Window {
    __folderScrollCalls: number;
  }
}

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
