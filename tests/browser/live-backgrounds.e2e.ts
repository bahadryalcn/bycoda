import { test, expect, type Locator } from "@playwright/test";

const effects = ["neural-tree", "latent-face", "thought-weaver", "ascii-mask"] as const;
const preferenceKey = "bycoda.liveBackground.v1";

/** Compare canvas pixels, not CSS opacity or a particular animation formula. */
function pixels(canvas: Locator, baseline = false) {
  return canvas.evaluate((element: HTMLCanvasElement, remember) => {
    const node = element as HTMLCanvasElement & { previousPixels?: Uint8ClampedArray };
    const data = node.getContext("2d")!.getImageData(0, 0, node.width, node.height).data;
    let visible = 0;
    let changed = 0;
    let hash = 2166136261;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3] > 2) visible++;
      if (
        node.previousPixels &&
        data
          .subarray(offset, offset + 4)
          .some((value, channel) => value !== node.previousPixels![offset + channel])
      ) {
        changed++;
      }
      for (let channel = 0; channel < 4; channel++) {
        hash = Math.imul(hash ^ data[offset + channel], 16777619);
      }
    }
    if (remember) node.previousPixels = data;
    return { visible, changed, hash, area: node.width * node.height };
  }, baseline);
}

for (const theme of ["dark", "light"]) {
  for (const effect of effects) {
    test(`${effect} has calm, visible idle and reply artwork in ${theme}`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`/tests/browser/live-backgrounds.html?effect=${effect}&theme=${theme}`);
      const canvas = page.locator("[data-scene] canvas");
      await expect(canvas).toBeVisible();
      await expect.poll(async () => (await pixels(canvas)).visible).toBeGreaterThan(100);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const idle = await pixels(canvas, true);
      await page
        .locator("[data-scene]")
        .screenshot({ path: testInfo.outputPath(`${effect}-${theme}-idle.png`) });
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await page.getByRole("button", { name: "Start reply", exact: true }).click();
      await expect
        .poll(async () => (await pixels(canvas)).hash, { timeout: 5000 })
        .not.toBe(idle.hash);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const reply = await pixels(canvas);
      expect(reply.visible).toBeGreaterThan(100);
      expect(reply.changed).toBeGreaterThan(0);
      // A reply must not flood the previously empty canvas with a flash/field.
      expect(reply.changed).toBeLessThan(reply.area * 0.35);
      await page
        .locator("[data-scene]")
        .screenshot({ path: testInfo.outputPath(`${effect}-${theme}-reply.png`) });
      expect(errors).toEqual([]);
    });

    test(`${effect} protects text and code across pane widths in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/live-backgrounds.html?effect=${effect}&theme=${theme}`);
      const pane = page.locator("[data-preview-pane]");
      const canvas = pane.locator("[data-live-background-rail] canvas");
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        if (effect === "ascii-mask") {
          // The owner chose this scene to sit centered behind the conversation, very faint, at
          // every width. It is the only scene exempt from the free-margin rule below.
          await expect(canvas).toBeVisible();
          await expect.poll(async () => (await pixels(canvas)).visible).toBeGreaterThan(100);
          const artwork = await canvas.boundingBox();
          const paneBox = await pane.boundingBox();
          expect(artwork).not.toBeNull();
          expect(paneBox).not.toBeNull();
          expect(artwork!.x).toBeLessThanOrEqual(paneBox!.x + 1);
          expect(artwork!.x + artwork!.width).toBeGreaterThanOrEqual(
            paneBox!.x + paneBox!.width - 1,
          );
          // Behind the reading column, never over it.
          const rail = pane.locator("[data-live-background-rail]");
          expect(await rail.evaluate((el) => getComputedStyle(el).zIndex)).toBe("-1");
        } else if (width < 1440) {
          await expect(canvas).toBeHidden();
        } else {
          await expect(canvas).toBeVisible();
          await expect.poll(async () => (await pixels(canvas)).visible).toBeGreaterThan(100);
          const artwork = await canvas.boundingBox();
          const reading = await pane.locator("[data-reading-area]").boundingBox();
          expect(artwork).not.toBeNull();
          expect(reading).not.toBeNull();
          expect(artwork!.x).toBeGreaterThanOrEqual(reading!.x + reading!.width);
          expect(artwork!.x + artwork!.width).toBeLessThanOrEqual(width);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await pane.screenshot({
          path: testInfo.outputPath(`${effect}-${theme}-chat-${width}.png`),
        });
      }
      await page.goto(
        `/tests/browser/live-backgrounds.html?effect=${effect}&theme=${theme}&chatWidth=full`,
      );
      if (effect !== "ascii-mask") await expect(canvas).toBeHidden();
    });
  }
}

test("every scene stays unchanged while replies stream with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const effect of effects) {
    await page.goto(`/tests/browser/live-backgrounds.html?effect=${effect}&theme=dark`);
    const canvas = page.locator("[data-scene] canvas");
    await expect.poll(async () => (await pixels(canvas)).visible).toBeGreaterThan(100);
    const before = await pixels(canvas);
    await page.getByRole("button", { name: "Start reply", exact: true }).click();
    // Observe several stream updates and frame opportunities without permitting motion.
    await page.waitForTimeout(350);
    expect(await pixels(canvas)).toEqual(before);
  }
});

test("none leaves both artwork and chat clear", async ({ page }) => {
  await page.goto("/tests/browser/live-backgrounds.html?effect=none&theme=dark");
  await expect(page.locator("[data-preview-pane]")).toBeVisible();
  await expect(page.locator("[data-scene] canvas")).toHaveCount(0);
  await expect(page.locator("[data-preview-pane] canvas")).toHaveCount(0);
});

test("the five-choice picker persists canonical scenes and supports keyboard selection", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/settings.html?section=appearance&lang=en");
  const picker = page.getByRole("radiogroup", { name: "Live background scene", exact: true });
  const radios = picker.getByRole("radio");
  await expect(radios).toHaveCount(5);
  await expect(picker.getByRole("radio", { name: /prism|scanner|hyperspeed|glitch/i })).toHaveCount(
    0,
  );
  for (const [index, effect] of ["none", ...effects].entries()) {
    await radios.nth(index).click();
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), preferenceKey))
      .toBe(effect);
    await page.reload();
    await expect(radios.nth(index)).toBeChecked();
  }
  await radios.nth(4).focus();
  await radios.nth(4).press("ArrowRight");
  await expect(radios.nth(0)).toBeFocused();
  await expect(radios.nth(0)).toBeChecked();
  await radios.nth(0).press("End");
  await expect(radios.nth(4)).toBeFocused();
  await expect(radios.nth(4)).toBeChecked();
  await radios.nth(4).press("Home");
  await expect(radios.nth(0)).toBeFocused();
  await expect(radios.nth(0)).toBeChecked();
});
