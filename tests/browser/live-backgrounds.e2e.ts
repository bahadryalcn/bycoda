import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  for (const effect of ["orb", "letter-glitch", "world-tree"]) {
    test(`${effect} renders and responds to a reply in ${theme}`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (/live background (shader|program)/.test(m.text())) errors.push(m.text());
      });
      await page.goto(`/tests/browser/live-backgrounds.html?effect=${effect}&theme=${theme}`);
      const canvas = page.locator("[data-scene] canvas");
      await expect(canvas).toBeVisible();
      const pixels = () =>
        canvas.evaluate((node: HTMLCanvasElement) => {
          const data = node.getContext("2d")!.getImageData(0, 0, node.width, node.height).data;
          let visible = 0,
            alpha = 0;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 2) visible++;
            alpha += data[i];
          }
          return { visible, alpha };
        });
      await expect.poll(async () => (await pixels()).visible).toBeGreaterThan(1000);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const idle = await pixels();
      await page
        .locator("[data-scene]")
        .screenshot({ path: testInfo.outputPath(`${effect}-${theme}-idle.png`) });
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await page.getByRole("button", { name: "Start reply", exact: true }).click();
      // Speech presence takes time to rise; it must visibly strengthen the scene.
      await expect
        .poll(async () => (await pixels()).alpha, { timeout: 5000 })
        .toBeGreaterThan(idle.alpha * 1.08);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page
        .locator("[data-scene]")
        .screenshot({ path: testInfo.outputPath(`${effect}-${theme}-reply.png`) });
      expect(errors).toEqual([]);
    });
  }
}

test("new backgrounds persist in settings and remain still with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const effect of ["orb", "letter-glitch", "world-tree"]) {
    await page.goto(`/tests/browser/live-backgrounds.html?effect=${effect}&theme=dark`);
    const canvas = page.locator("[data-scene] canvas");
    const before = await canvas.screenshot();
    await page.getByRole("button", { name: "Start reply", exact: true }).click();
    await page.waitForTimeout(200);
    expect(await canvas.screenshot()).toEqual(before);
  }
  await page.goto("/tests/browser/settings.html?section=appearance&lang=en");
  for (const name of ["Orb", "World tree", "Letter glitch"]) {
    const radio = page.getByRole("radio", { name, exact: true });
    await radio.click();
    await page.reload();
    await expect(radio).toBeChecked();
  }
});
