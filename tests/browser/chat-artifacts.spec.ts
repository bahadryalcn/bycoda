import { expect, test } from "@playwright/test";

test("chat messages, attachment references and running work keep a readable hierarchy", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/transcript.html?chat-layout");
  const bubble = page.locator(".user-message-bubble");
  const group = page.locator(".transcript-activity-group").last();
  const dock = page.getByRole("region", { name: "Turn activity", exact: true });
  await expect(bubble).toBeVisible();
  await expect(bubble.locator('[data-attachment-chip="image"]')).toHaveCount(7);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await bubble.scrollIntoViewIfNeeded();
      expect(await bubble.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const image = bubble.locator('[data-attachment-chip="image"] button').first();
      expect((await image.boundingBox())!.width).toBeGreaterThanOrEqual(56);
      const token = bubble.getByRole("button", {
        name: "Open [image1] (screenshot-1.png) full screen",
        exact: true,
      });
      expect((await token.boundingBox())!.height).toBeLessThan(26);
      const track = dock.locator('[data-pacing-track="reserved"]');
      const summary = dock.locator(".activity-dock-summary");
      const trackBox = (await track.boundingBox())!;
      const summaryBox = (await summary.boundingBox())!;
      expect(trackBox.x).toBeGreaterThanOrEqual(summaryBox.x + summaryBox.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 1440) await page.screenshot({ path: info.outputPath(`chat-${theme}.png`) });
    }
  }
  const preview = group.locator(".zen-phase-summary");
  expect((await preview.boundingBox())!.height).toBeLessThanOrEqual(120);
  await group.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(group.locator(".zen-phase-summary")).toHaveCount(0);
  await expect(group.getByText(/very-long-command-path-0/).first()).toBeVisible();
  await bubble
    .getByRole("button", { name: "Open screenshot-1.png full screen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

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
  await expect
    .poll(() => page.locator(".zen-phase-live").evaluate((node) => node.clientHeight))
    .toBeLessThanOrEqual(120);
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
