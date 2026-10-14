import { expect, test } from "@playwright/test";

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
