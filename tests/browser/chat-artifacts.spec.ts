import { expect, test } from "@playwright/test";

test("chat code and command results remain compact until explicitly opened", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/transcript.html?artifacts", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-tool-inspection]")).toHaveCount(0);
  await page.getByRole("button", { name: /^Show changes for/ }).click();
  const code = page.locator("[data-tool-inspection]").first();
  await expect(code).toContainText("saved-code-marker");
  await expect(code.locator("pre")).toHaveCSS("user-select", "text");
  await page.getByRole("button", { name: /^Show output for/ }).click();
  await expect(page.locator("[data-tool-inspection]").last()).toContainText("output-marker");
  await page.setViewportSize({ width: 420, height: 800 });
  await expect(code).toBeVisible();
  let previousGeometry = "";
  let stableSamples = 0;
  await expect
    .poll(async () => {
      const geometry = await code.evaluate((node) => {
        const panel = node.getBoundingClientRect();
        const header = node.querySelector("button")!.getBoundingClientRect();
        return JSON.stringify([
          panel.x,
          panel.y,
          panel.width,
          panel.height,
          header.y,
          header.height,
        ]);
      });
      stableSamples = geometry === previousGeometry ? stableSamples + 1 : 0;
      previousGeometry = geometry;
      return stableSamples;
    })
    .toBeGreaterThanOrEqual(2);
  const copy = code.getByRole("button", { name: "Copy", exact: true });
  // Visibility alone allows a partly clipped button inside the pinned live phase.
  // Both edges must be hit-testable after the responsive layout has settled.
  await expect
    .poll(() =>
      copy.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return [rect.top + 1, rect.bottom - 1].every((y) =>
          node.contains(document.elementFromPoint(rect.left + rect.width / 2, y)),
        );
      }),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: /^Hide output for/ }).first()).toBeInViewport({
    ratio: 1,
  });
  const box = await code.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(420);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath("chat-code-details.png") });
  await page
    .getByRole("button", { name: /^Hide output for/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^Hide output for/ }).click();
  await expect(page.locator("[data-tool-inspection]")).toHaveCount(0);
  await expect(page.locator(".zen-phase-live")).toHaveCSS("max-height", "280px");
});

test("a chat CSV opens an actual worker-backed table and returns focus after Escape", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/transcript.html?artifacts", { waitUntil: "domcontentloaded" });
  const trigger = page.getByRole("button", { name: "Open results.csv full screen", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("passed", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Build", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("chat-csv-preview.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
