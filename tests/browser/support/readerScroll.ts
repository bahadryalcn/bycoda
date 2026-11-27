import type { Locator, Page } from "@playwright/test";

/**
 * Bring a transcript element into view the way a reader does. The transcript follows its tail and
 * treats a script-driven scroll as not the reader's, so on WebKit it snaps back before the click
 * lands; a real wheel gesture leaves the tail and stays.
 */
export async function scrollToAsReader(page: Page, target: Locator) {
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const box = await target.boundingBox();
    if (box && box.y >= 0 && box.y + box.height <= viewport.height) return;
    const delta = box ? box.y - viewport.height / 2 : -viewport.height;
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(150);
  }
}
