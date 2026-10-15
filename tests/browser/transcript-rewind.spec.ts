import { expect, test } from "@playwright/test";

for (const width of [390, 1000]) {
  test(`rewind actions identify their message at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tests/browser/transcript.html?rewind", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Stopped by you", { exact: true })).toBeVisible();
    const wrong = page.locator('[data-prompt-anchor="wrong-request"]');
    const prior = page.locator('[data-prompt-anchor="prior-request"]');
    const edit = wrong.getByRole("button", { name: "Edit", exact: true });
    await edit.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => (window as unknown as { lastRewind: unknown }).lastRewind))
      .toEqual({ blockId: "wrong-request", action: "edit" });
    await prior.getByRole("button", { name: "Return before", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { lastRewind: unknown }).lastRewind))
      .toEqual({ blockId: "prior-request", action: "return" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
