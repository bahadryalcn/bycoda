import { expect, test } from "@playwright/test";

for (const [shape, ratio] of [
  ["wide", 1440 / 900],
  ["tall", 900 / 2400],
  ["small", 160 / 100],
] as const) {
  test(`generated image ${shape} fits the chat column and opens fully in the lightbox`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/artifact-formats.html?generated-images&shape=${shape}`);
    const trigger = page.getByRole("button", { name: "Open wide.png full screen", exact: true });
    const image = trigger.locator("img");
    await expect(image).toBeVisible();
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 714 });
        const buttonBox = (await trigger.boundingBox())!;
        const imageBox = (await image.boundingBox())!;
        expect(buttonBox.width).toBeLessThanOrEqual(Math.min(width, 600));
        expect(imageBox.x).toBeGreaterThanOrEqual(buttonBox.x);
        expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(buttonBox.x + buttonBox.width + 1);
        expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(
          buttonBox.y + buttonBox.height + 1,
        );
        expect(imageBox.width / imageBox.height).toBeCloseTo(ratio, 1);
        expect(imageBox.height).toBeLessThanOrEqual(357);
        await trigger.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const fullImage = dialog.locator("img");
        const fullBox = (await fullImage.boundingBox())!;
        expect(fullBox.x).toBeGreaterThanOrEqual(0);
        expect(fullBox.y).toBeGreaterThanOrEqual(0);
        expect(fullBox.x + fullBox.width).toBeLessThanOrEqual(width);
        expect(fullBox.y + fullBox.height).toBeLessThanOrEqual(714);
        expect(fullBox.width / fullBox.height).toBeCloseTo(ratio, 1);
        if (width === 390 && theme === "dark")
          await page.screenshot({ path: info.outputPath("lightbox-fitted.png") });
        // Zoom remains available after the initial fit; 0 restores the whole image.
        await page.keyboard.press("+");
        await expect(fullImage).not.toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
        await page.keyboard.press("0");
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
    }
    await page.screenshot({ path: info.outputPath("generated-image-fitted.png") });
  });
}

test("PDF attachment uses the real parser, text layer and rendered canvas", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/artifact-formats.html", { waitUntil: "domcontentloaded" });
  const trigger = page.getByRole("button", { name: "Open proof.pdf full screen", exact: true });
  await expect(trigger).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { artifactFormatReads: Record<string, number> }).artifactFormatReads[
          "proof.pdf"
        ],
    ),
  ).toBe(0);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".pdf-text-layer")).toContainText("PDF preview verified");
  await expect
    .poll(() =>
      dialog
        .locator("canvas")
        .first()
        .evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          if (!canvas.width || !canvas.height) return false;
          const data = canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let dark = 0;
          for (let index = 0; index < data.length; index += 4)
            if (data[index + 3] && data[index] < 80) dark++;
          return dark > 100;
        }),
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath("actual-pdf-preview.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("XLSX attachment is parsed by the real worker and switches workbook sheets", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/artifact-formats.html", { waitUntil: "domcontentloaded" });
  const trigger = page.getByRole("button", { name: "Open proof.xlsx full screen", exact: true });
  await expect(trigger).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { artifactFormatReads: Record<string, number> }).artifactFormatReads[
          "proof.xlsx"
        ],
    ),
  ).toBe(0);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Workbook marker", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Verified", { exact: true })).toBeVisible();
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await dialog.getByRole("tab", { name: "Metrics", exact: true }).click();
  await expect(dialog.getByText("Answer", { exact: true })).toBeVisible();
  await expect(dialog.getByText("42", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Metrics", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.screenshot({ path: info.outputPath("actual-xlsx-preview.png") });
});

test("owned video reaches metadata and plays with native controls", async ({
  page,
  browserName,
}, info) => {
  await page.goto("/tests/browser/artifact-formats.html", { waitUntil: "domcontentloaded" });
  const fixture = page.locator("main[data-recorder-support]");
  await expect(fixture).toBeVisible();
  test.skip(
    (await fixture.getAttribute("data-recorder-support")) === "unsupported",
    `${browserName} has no supported canvas MediaRecorder encoder in this environment`,
  );
  await page.getByRole("button", { name: "Create owned test video", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Recording test video…", exact: true }),
  ).toHaveCount(0, { timeout: 15_000 });
  test.skip(
    (await fixture.getAttribute("data-recorder-support")) === "unsupported",
    `${browserName} rejected the available video encoder`,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: /^Open playback\.(webm|mp4) full screen$/ }).click();
  const video = page.getByRole("dialog").locator("video");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).not.toHaveAttribute("autoplay");
  await expect
    .poll(() => video.evaluate((element) => (element as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(1);
  expect(
    await video.evaluate((element) => [
      (element as HTMLVideoElement).videoWidth,
      (element as HTMLVideoElement).videoHeight,
    ]),
  ).toEqual([320, 180]);
  await video.evaluate(async (element) => {
    await (element as HTMLVideoElement).play();
  });
  await expect
    .poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0.15);
  await video.evaluate((element) => (element as HTMLVideoElement).pause());
  expect(await video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
  await page.screenshot({ path: info.outputPath("actual-video-preview.png") });
});
