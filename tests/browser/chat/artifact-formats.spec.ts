import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`browser annotation disclosure surface ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/chat/artifact-formats.html?annotation-chip");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const disclosure = page.locator(".browser-annotation-chip");
      await expect(disclosure).toBeVisible();
      const actual = await disclosure.evaluate((node) => {
        const s = getComputedStyle(node);
        const probe = document.createElement("span");
        probe.style.border = "1px solid var(--ui-card-border)";
        probe.style.borderRadius = "var(--ui-radius-card)";
        node.appendChild(probe);
        const p = getComputedStyle(probe);
        const result = {
          width: s.borderTopWidth,
          color: s.borderTopColor,
          expectedColor: p.borderTopColor,
          radius: s.borderTopLeftRadius,
          expectedRadius: p.borderTopLeftRadius,
        };
        probe.remove();
        return result;
      });
      expect(actual.width).toBe("1px");
      expect(actual.color).toBe(actual.expectedColor);
      expect(actual.radius).toBe(actual.expectedRadius);
      const summary = disclosure.locator(":scope > summary");
      await summary.hover();
      const hover = await summary.evaluate((node) => {
        const s = getComputedStyle(node);
        const probe = document.createElement("span");
        probe.style.color = "var(--ui-tone-accent-fg)";
        node.appendChild(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        return { color: s.color, accent };
      });
      expect(hover.color).toBe(hover.accent);
      await page.keyboard.press("Tab");
      await summary.focus();
      await expect(summary).toHaveCSS("outline-style", "solid");
      await summary.click();
      await expect(disclosure).toHaveAttribute("open", "");
      await expect(disclosure).toContainText("Review spacing");
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/annotation-chip-${theme}-${width}.png`,
      });
    });
import { writeFile } from "node:fs/promises";

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`work item avatar surface ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/tests/browser/chat/artifact-formats.html?work-item-avatar");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const chip = page.locator('[data-github-work-item-chip="pr"]');
      await chip.focus();
      const card = page.locator("[data-hover-card]");
      await expect(card.getByText("Fixture review")).toBeVisible();
      const avatar = card.locator("img").first();
      await expect(avatar).toBeVisible();
      const actual = await avatar.evaluate((node) => {
        const s = getComputedStyle(node);
        const probe = document.createElement("span");
        probe.style.border = "1px solid var(--ui-tone-neutral-border)";
        probe.style.background = "var(--ui-surface-raised)";
        node.parentElement!.appendChild(probe);
        const p = getComputedStyle(probe);
        const result = {
          width: s.borderTopWidth,
          radius: s.borderTopLeftRadius,
          border: s.borderTopColor,
          background: s.backgroundColor,
          expectedBorder: p.borderTopColor,
          expectedBackground: p.backgroundColor,
        };
        probe.remove();
        return result;
      });
      expect(actual.width).toBe("1px");
      expect(actual.radius === "50%" || parseFloat(actual.radius) >= 9).toBe(true);
      expect(actual.border).toBe(actual.expectedBorder);
      expect(actual.background).toBe(actual.expectedBackground);
      const branch = card.getByText("main ← feature").locator("..");
      const footer = card.getByText("Click the chip to open on GitHub");
      const paints = await branch.evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.background =
          "color-mix(in oklab, var(--ui-tone-neutral-solid) 4.5%, transparent)";
        node.appendChild(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { actual: getComputedStyle(node).backgroundColor, expected };
      });
      expect(paints.actual).toBe(paints.expected);
      const footerPaint = await footer.evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.borderTop =
          "1px solid color-mix(in oklab, var(--ui-tone-neutral-border) 7%, transparent)";
        node.appendChild(probe);
        const expected = getComputedStyle(probe).borderTopColor;
        probe.remove();
        const style = getComputedStyle(node);
        return { actual: style.borderTopColor, width: style.borderTopWidth, expected };
      });
      expect(footerPaint.width).toBe("1px");
      expect(footerPaint.actual).toBe(footerPaint.expected);
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/work-item-avatar-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`generated image caller visual ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/chat/artifact-formats.html?generated-images&shape=wide");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const trigger = page.getByRole("button", { name: "Open wide.png full screen", exact: true });
      await expect(trigger.locator("img")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/sessions-callers/generated-image-${theme}-${width}.png`,
      });
      await trigger.click();
      await expect(page.getByRole("dialog").locator("img")).toBeVisible();
      await page.screenshot({
        path: `temp/verification/sessions-callers/generated-image-open-${theme}-${width}.png`,
      });
    });

test("attachment opening, reference and removal stay distinct at narrow widths", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/chat/artifact-formats.html?attachment-actions");
  const open = page.getByRole("button", { name: /^Open 15-terminus/ });
  const insert = page.getByRole("button", { name: "Insert [file1] into the message", exact: true });
  for (const light of [false, true]) {
    await page.evaluate(
      (value) => document.documentElement.classList.toggle("theme-light", value),
      light,
    );
    for (const width of [320, 390, 1000]) {
      await page.setViewportSize({ width, height: 700 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(open).toBeInViewport();
      await expect(insert).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await open.focus();
      await open.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator("pre")).toContainText("Attachment contents");
      await expect(page.getByLabel("Draft", { exact: true })).toHaveText("");
      await page.keyboard.press("Escape");
      await expect(open).toBeFocused();
    }
  }
  await insert.focus();
  await insert.press("Space");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Draft", { exact: true })).toHaveText("[file1]");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.screenshot({ path: info.outputPath("attachment-actions.png") });
  await page.getByRole("button", { name: /^Remove 15-terminus/ }).click();
  await expect(open).toHaveCount(0);
});

test("chat file changes and long content fit a narrow column", async ({ page }, info) => {
  await page.goto("/tests/browser/chat/artifact-formats.html?chat-overflow");
  const row = page.getByRole("region", { name: "File change" });
  const trigger = row.getByRole("button");
  await expect(trigger).toBeVisible();
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 800 });
        const box = (await trigger.boundingBox())!;
        const label = (await trigger.locator("[data-file-label]").boundingBox())!;
        expect(label.x + label.width).toBeLessThanOrEqual(box.x + box.width + 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        await page.getByRole("button", { name: "Collapse code block", exact: true }).click();
        const summary = page.locator(".markdown-code-summary");
        const count = summary.locator(".markdown-code-summary-count");
        const summaryBox = (await summary.boundingBox())!;
        const countBox = (await count.boundingBox())!;
        const shell = page.locator(".markdown-code-shell");
        const shellBox = (await shell.boundingBox())!;
        const frameBox = (await shell.locator('[data-streamdown="code-block"]').boundingBox())!;
        for (const control of [
          summary,
          shell.locator(".markdown-code-toggle"),
          shell.locator('[aria-label="Copy code"]'),
        ]) {
          const controlBox = (await control.boundingBox())!;
          expect(controlBox.x).toBeGreaterThanOrEqual(frameBox.x);
          expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(
            frameBox.x + frameBox.width + 1,
          );
          expect(controlBox.y).toBeGreaterThanOrEqual(frameBox.y);
          expect(controlBox.y + controlBox.height).toBeLessThanOrEqual(
            frameBox.y + frameBox.height + 1,
          );
        }
        expect(summaryBox.x).toBeLessThan(shellBox.x + 40);
        expect(countBox.x + countBox.width).toBeLessThanOrEqual(
          summaryBox.x + summaryBox.width + 1,
        );
        await summary.focus();
        await page.keyboard.press("Enter");
        await expect(shell).toHaveAttribute("data-collapsed", "false");
        const headerBox = (await shell
          .locator('[data-streamdown="code-block-header"]')
          .boundingBox())!;
        const toggleBox = (await shell.locator(".markdown-code-toggle").boundingBox())!;
        expect(toggleBox.y).toBeGreaterThanOrEqual(headerBox.y);
        expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(
          headerBox.y + headerBox.height + 1,
        );
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await trigger.focus();
  const preview = page.getByRole("dialog");
  await expect(preview).toBeVisible();
  const previewBox = (await preview.boundingBox())!;
  expect(previewBox.x).toBeGreaterThanOrEqual(0);
  expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(320);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Show full long text", exact: true }).click();
  await expect(preview.locator("pre")).toHaveText("unbroken".repeat(200));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened file", { exact: true })).toHaveText("opened");
  await page.screenshot({ path: info.outputPath("chat-overflow.png"), fullPage: true });
});

test("a Markdown local image fits its preview frame without clipping or stretching the message", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/chat/artifact-formats.html?local-image");
  const frame = page.locator("[data-local-media]");
  const image = frame.locator("img");
  await expect(image).toBeVisible();
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        const outer = (await frame.boundingBox())!;
        const inner = (await image.boundingBox())!;
        expect(outer.height).toBeLessThanOrEqual(181);
        expect(inner.x).toBeGreaterThanOrEqual(outer.x);
        expect(inner.y).toBeGreaterThanOrEqual(outer.y);
        expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
        expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 1);
        await expect(image).toHaveCSS("object-fit", "contain");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(page.getByText("The complete message after the image.")).toBeInViewport();
      }
    }
  }
  const button = frame.getByRole("button", { name: "Chat preview", exact: true });
  await button.focus();
  await button.press("Enter");
  await expect(page.getByLabel("Opened image")).toHaveText("/fixture/chat-preview.png");
  await page.screenshot({ path: info.outputPath("local-image-fitted.png") });
});

for (const [shape, ratio] of [
  ["wide", 1440 / 900],
  ["tall", 900 / 2400],
  ["small", 160 / 100],
] as const) {
  test(`generated image ${shape} fits the chat column and opens fully in the lightbox`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/chat/artifact-formats.html?generated-images&shape=${shape}`);
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
  await page.goto("/tests/browser/chat/artifact-formats.html", { waitUntil: "domcontentloaded" });
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
  await page.goto("/tests/browser/chat/artifact-formats.html", { waitUntil: "domcontentloaded" });
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

for (const dpr of [1, 2, 3]) {
  test.describe(`PDF raster budget at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });
    test("retains CSS and selectable text geometry at 25 and 500 percent", async ({
      page,
    }, info) => {
      // Software-composited WebKit repaints the high-DPR raster on every press.
      test.setTimeout(90_000);
      await page.goto("/tests/browser/chat/artifact-formats.html", {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: "Open proof.pdf full screen", exact: true }).click();
      const dialog = page.getByRole("dialog");
      const layer = dialog.locator(".pdf-text-layer");
      await expect(layer).toContainText("PDF preview verified");
      const metrics = [];
      for (const zoom of [0.25, 5]) {
        const button = dialog.getByRole("button", {
          name: zoom === 0.25 ? "Zoom out" : "Zoom in",
          exact: true,
        });
        const reached = dialog.getByText(zoom === 0.25 ? "25%" : "500%", { exact: true });
        // Each press repaints a large raster; stop at the clamp instead of
        // spending the test budget on presses that cannot change the zoom.
        for (let step = 0; step < 20 && !(await reached.isVisible()); step++) await button.click();
        await expect(reached).toBeVisible();
        await expect(layer).toContainText("PDF preview verified");
        const frame = dialog.locator('[data-page="1"]');
        await expect
          .poll(() =>
            frame
              .locator("canvas")
              .evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height),
          )
          .toBeGreaterThan(0);
        const metric = await frame.evaluate((element) => {
          const canvas = element.querySelector("canvas")!;
          const span = element.querySelector(".pdf-text-layer span")!;
          const box = element.getBoundingClientRect();
          const text = span.getBoundingClientRect();
          return {
            dpr: window.devicePixelRatio,
            width: canvas.width,
            height: canvas.height,
            cssWidth: box.width,
            cssHeight: box.height,
            textWidth: text.width,
            textOffset: text.left - box.left,
          };
        });
        expect(metric.width * metric.height).toBeLessThanOrEqual(2_000_000);
        expect(metric.cssWidth).toBeCloseTo(420 * zoom, 0);
        expect(metric.cssHeight).toBeCloseTo(300 * zoom, 0);
        expect(metric.textOffset).toBeCloseTo(50 * zoom, 0);
        metrics.push({ zoom, ...metric });
        if (zoom === 5) {
          // Zooming keeps the viewport centre, which scrolls the page's first line
          // out of view; bring its start into the viewport before dragging over it.
          await layer
            .locator("span")
            .first()
            .evaluate((span) => span.scrollIntoView({ block: "center", inline: "start" }));
          const rangeBox = await layer
            .locator("span")
            .first()
            .evaluate((span) => {
              const range = document.createRange();
              range.setStart(span.firstChild!, 0);
              range.setEnd(span.firstChild!, 3);
              const box = range.getBoundingClientRect();
              return { x: box.x, y: box.y, width: box.width, height: box.height };
            });
          await page.mouse.move(rangeBox.x + 1, rangeBox.y + rangeBox.height / 2);
          await page.mouse.down();
          await page.mouse.move(rangeBox.x + rangeBox.width - 1, rangeBox.y + rangeBox.height / 2, {
            steps: 6,
          });
          await page.mouse.up();
          expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("PDF");
        }
      }
      expect(metrics[1].textWidth / metrics[0].textWidth).toBeCloseTo(20, 1);
      const metricPath = info.outputPath(`pdf-raster-dpr-${dpr}.json`);
      await writeFile(metricPath, JSON.stringify(metrics, null, 2));
      await info.attach(`pdf-raster-dpr-${dpr}.json`, {
        path: metricPath,
        contentType: "application/json",
      });
    });
  });
}

test("owned video reaches metadata and plays with native controls", async ({
  page,
  browserName,
}, info) => {
  await page.goto("/tests/browser/chat/artifact-formats.html", { waitUntil: "domcontentloaded" });
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

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`user text expanded surface ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/chat/artifact-formats.html?chat-overflow");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      await page.getByRole("button", { name: "Show full long text", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("pre")).toContainText("unbroken");
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/user-text-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`attachment preview floating surface ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/tests/browser/chat/artifact-formats.html?attachment-surfaces");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const chip = page.getByRole("button", { name: "Open report.txt full screen" });
      await chip.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const colors = await dialog.evaluate((node) => {
        const probe = document.createElement("span");
        node.appendChild(probe);
        probe.style.background = "var(--ui-surface-floating)";
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { actual: getComputedStyle(node).backgroundColor, expected };
      });
      expect(colors.actual).toBe(colors.expected);
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/attachment-preview-${theme}-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(chip).toBeFocused();
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`attachment kind surface ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/chat/artifact-formats.html?attachment-surfaces&theme=${theme}`,
      );
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const chips = page.locator("[data-attachment-chip]");
      await expect(chips.first()).toBeVisible();
      const colors = await chips.evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node);
          const probe = document.createElement("span");
          node.appendChild(probe);
          probe.style.background =
            "color-mix(in srgb, var(--ui-attachment-ink, var(--ui-tone-accent-fg)) 14%, transparent)";
          const expected = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return {
            kind: node.getAttribute("data-attachment-kind"),
            actual: style.backgroundColor,
            expected,
          };
        }),
      );
      expect(new Set(colors.map((color) => color.kind)).size).toBeGreaterThan(1);
      expect(colors.every((color) => color.actual === color.expected)).toBe(true);
      console.log("ATTACHMENT_SURFACES", theme, JSON.stringify(colors));
      await page.screenshot({
        animations: "disabled",
        path: `temp/verification/feature-controls/attachment-surface-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`shared work item chip interaction ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/chat/artifact-formats.html?work-item-avatar");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const attachment = page.locator("[data-inline-attachment] button [data-name]");
      await expect(attachment).toHaveCSS("text-decoration-line", "none");
      await attachment.hover();
      await expect(attachment).toHaveCSS("text-decoration-line", "underline");
      await expect(attachment).toHaveCSS("text-underline-offset", "2px");
      await page.locator("[data-inline-attachment]").screenshot({
        path: `temp/verification/session-interactions/attachment-${theme}-${width}.png`,
      });
      const chip = page.locator('[data-github-work-item-chip="pr"]');
      await expect(chip).toHaveAttribute("href", "https://github.com/acme/widgets/pull/73");
      await expect(chip).toHaveCSS("border-top-width", "0px");
      await chip.focus();
      await expect(chip).not.toHaveCSS("box-shadow", "none");
      await expect(page.locator("[data-hover-card]")).toContainText("Fixture review");
      await chip.hover();
      await page.mouse.down();
      await expect(chip).toHaveCSS("scale", "0.98");
      await page.mouse.move(0, 0);
      await page.mouse.up();
      await expect(chip).toHaveCSS("scale", "none");
      await page.screenshot({
        path: `temp/verification/session-interactions/link-${theme}-${width}.png`,
      });
    });

for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`shared attachment action reveal ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/tests/browser/chat/artifact-formats.html?attachment-actions");
      await page.evaluate(
        (light) => document.documentElement.classList.toggle("theme-light", light),
        theme === "light",
      );
      const card = page.locator("[data-attachment-chip]");
      const insert = card.getByRole("button", { name: /Insert .* into the message/ });
      const remove = card.getByRole("button", { name: /Remove 15-/ });
      await page.mouse.move(0, 0);
      await expect(insert).toHaveCSS("opacity", "0");
      const before = await insert.boundingBox();
      await card.hover();
      await expect(insert).toHaveCSS("opacity", "1");
      expect(await insert.boundingBox()).toEqual(before);
      await insert.click();
      await expect(page.getByLabel("Draft", { exact: true })).toHaveText("[file1]");
      await page.mouse.move(0, 0);
      await remove.focus();
      await expect(insert).toHaveCSS("opacity", "1");
      await expect(remove).toHaveCSS("opacity", "1");
      await page.screenshot({
        path: `temp/verification/session-last-interactions/attachment-${theme}-${width}.png`,
      });
      await remove.click();
      await expect(card).toHaveCount(0);
    });

test.describe("coarse attachment actions", () => {
  test.use({ hasTouch: true });
  test("shared attachment actions stay visible on coarse pointer", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/tests/browser/chat/artifact-formats.html?attachment-actions");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const card = page.locator("[data-attachment-chip]");
    const insert = card.getByRole("button", { name: /Insert .* into the message/ });
    await expect(insert).toHaveCSS("opacity", "1");
    await insert.tap();
    await expect(page.getByLabel("Draft", { exact: true })).toHaveText("[file1]");
    await page.screenshot({
      path: "temp/verification/session-last-interactions/attachment-touch-dark-800.png",
    });
  });
});
