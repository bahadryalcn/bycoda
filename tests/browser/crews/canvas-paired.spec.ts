import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { expectPairedProof } from "./paired-proof-test";
import {
  CLASSIC_SIGN_PIXEL_CAP,
  CLASSIC_SIGN_DELTA_CAP,
  CLASSIC_SIGN_REGION,
} from "./classic-sign-parity";

for (const theme of ["classic", "star-wars", "lotr", "matrix"] as const) {
  for (const dpr of [1, 2]) {
    for (const width of [28, 320]) {
      test(`paired walker ${theme} DPR ${dpr} width ${width}`, async ({ page }, testInfo) => {
        await expectPairedProof(page, testInfo, { kind: "walker", theme, dpr, width });
      });
    }
  }
}
for (const renderer of ["auto", "canvas"] as const) {
  for (const count of [0, 1, 3, 6]) {
    test(`paired classic crew ${renderer} ${count} workers stand and sit`, async ({
      page,
    }, testInfo) => {
      await expectPairedProof(page, testInfo, { kind: "crew", renderer, count });
    });
  }
}
test("paired harness detects an earlier one-channel mismatch after asynchronous ACK", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/canvas-paired.html");
  const result = await page.evaluate(() => window.checkPairedHarness());
  expect(result.frames).toBe(2);
  expect(result.differingPixels).toBe(1);
  expect(result.maxChannelDelta).toBe(1);
  expect(result.firstFailure?.sequence).toBe(0);
  expect(result.regional.differingPixels).toBe(5);
  expect(result.regional.outsideRegionPixels).toBe(2);
  expect(result.regional.maxRegionPixelsPerFrame).toBe(1);
});

test("worker presentation equals main on light and dark backgrounds", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crews/canvas-paired.html");
  for (const theme of ["classic", "star-wars", "lotr", "matrix"] as const) {
    for (const dpr of [1, 2]) {
      for (const width of [28, 320]) {
        await page.evaluate(
          async (options) => {
            const main = await window.createPairedRenderer({ ...options, path: "main" });
            const worker = await window.createPairedRenderer({ ...options, path: "worker" });
            await main.draw({ time: 17 / 12, stand: 0, presence: 0 }, 17);
            await worker.draw({ time: 17 / 12, stand: 0, presence: 0 }, 17);
            if (worker.backend !== "worker")
              throw new Error("Candidate did not ACK through worker");
            (window as any).disposeVisiblePair = () => {
              main.dispose?.();
              worker.dispose?.();
              document.querySelectorAll("canvas").forEach((canvas) => canvas.remove());
            };
          },
          { kind: "walker" as const, theme, dpr, width },
        );
        for (const background of ["white", "black"]) {
          await page.evaluate((color) => {
            document.body.style.background = color;
          }, background);
          const main = await page.locator("#main").screenshot();
          const worker = await page.locator("#worker").screenshot();
          await testInfo.attach(`${theme}-${dpr}-${width}-${background}-worker`, {
            body: worker,
            contentType: "image/png",
          });
          expect(
            worker.equals(main),
            `Visible PNG differs: ${theme} DPR ${dpr} width ${width} ${background}`,
          ).toBe(true);
        }
        await page.evaluate(() => (window as any).disposeVisiblePair());
      }
    }
  }
  const evidence = await page.evaluate(async () => {
    const urls = [...new Set(window.workerTelemetry.urls)];
    return {
      ...window.workerTelemetry,
      assets: await Promise.all(
        urls.map(async (url) => {
          const response = await fetch(url);
          return {
            url,
            status: response.status,
            type: response.headers.get("content-type"),
            bytes: (await response.text()).length,
          };
        }),
      ),
    };
  });
  expect(evidence.ready).toBe(16);
  expect(evidence.drawn).toBe(16);
  expect(evidence.assets.length).toBeGreaterThan(0);
  for (const asset of evidence.assets) {
    expect(asset.status).toBe(200);
    expect(asset.type).toContain("javascript");
    expect(asset.bytes).toBeGreaterThan(1000);
  }
  await testInfo.attach("real-worker-evidence", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
});

for (const mode of ["constructor", "never-ready"] as const) {
  test(`worker failure ${mode} paints identical fresh fallback`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/tests/browser/crews/canvas-paired.html");
    expect(await page.evaluate((mode) => window.walkerFailure(mode), mode)).toEqual({
      fresh: true,
      live: 0,
      differingPixels: 0,
      maxChannelDelta: 0,
    });
    expect(errors).toEqual([]);
  });
}

test("real PacingUncle StrictMode mount unmount remount", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/tests/browser/crews/canvas-paired.html");
  const result = await page.evaluate(() => window.walkerLifecycle());
  expect(result.ready).toBeGreaterThanOrEqual(2);
  expect(result.created, "Development StrictMode runs each effect twice").toBeGreaterThanOrEqual(4);
  expect(result.live).toBe(0);
  expect(errors).toEqual([]);
});

test("informative 300-frame DPR 2 width 320 timing", async ({ page }, testInfo) => {
  await page.goto("/tests/browser/crews/canvas-paired.html");
  const results = [];
  for (const theme of ["classic", "star-wars", "lotr", "matrix"] as const)
    results.push(await page.evaluate((theme) => window.walkerTiming(theme), theme));
  await testInfo.attach("walker-timing", {
    body: JSON.stringify(results),
    contentType: "application/json",
  });
});

test("classic main baseline timing", async ({ page }, testInfo) => {
  await page.goto("/tests/browser/crews/canvas-paired.html");
  const results = await page.evaluate(() => window.classicMainTiming());
  console.log("CLASSIC_BASELINE", JSON.stringify(results));
  await testInfo.attach("classic-baseline", {
    body: JSON.stringify(results),
    contentType: "application/json",
  });
});

for (const renderer of ["auto", "canvas"] as const) {
  for (const scenario of ["growth", "arrivals", "sign-failed"] as const) {
    test(`classic worker ${renderer} ${scenario}`, async ({ page }, testInfo) => {
      await expectPairedProof(page, testInfo, {
        kind: "crew",
        renderer,
        count: scenario === "arrivals" ? 9 : 3,
        ...(scenario === "sign-failed" ? { signFailed: true } : { scenario }),
      });
    });
  }
}
test("classic visible main worker presentation", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.goto("/tests/browser/crews/canvas-paired.html");
  for (const renderer of ["auto", "canvas"] as const) {
    for (const variant of [0, 1, 3, 6, "growth", "arrivals"] as const) {
      for (const signFailed of [true, false]) {
        const options = {
          kind: "crew" as const,
          renderer,
          count: typeof variant === "number" ? variant : variant === "arrivals" ? 9 : 3,
          signFailed,
          ...(typeof variant === "string" ? { scenario: variant } : {}),
        };
        await page.evaluate(async (options) => {
          const main = await window.createPairedRenderer({ ...options, path: "main" });
          const worker = await window.createPairedRenderer({ ...options, path: "worker" });
          await main.draw({ time: 1.25, stand: 1, presence: 0 }, 0);
          await worker.draw({ time: 1.25, stand: 1, presence: 0 }, 0);
          if (worker.backend !== "worker") throw new Error("Worker not used");
          (window as any).disposeClassic = () => {
            main.dispose?.();
            worker.dispose?.();
            document.querySelectorAll("canvas").forEach((c) => c.remove());
          };
        }, options);
        for (const color of ["white", "black"]) {
          await page.evaluate((color) => {
            document.body.style.background = color;
          }, color);
          const main = await page.locator("#main").screenshot();
          const worker = await page.locator("#worker").screenshot();
          const label = `classic-${renderer}-${variant}-${signFailed ? "failed" : "loaded"}-${color}`;
          await testInfo.attach(`${label}-main`, { body: main, contentType: "image/png" });
          await testInfo.attach(`${label}-worker`, { body: worker, contentType: "image/png" });
          if (signFailed) expect(worker.equals(main), label).toBe(true);
          else {
            const result = await page.evaluate(
              async ({ images, region }) => {
                const pixels = await Promise.all(
                  images.map(async (encoded) => {
                    const image = new Image();
                    image.src = `data:image/png;base64,${encoded}`;
                    await image.decode();
                    const canvas = document.createElement("canvas");
                    canvas.width = image.naturalWidth;
                    canvas.height = image.naturalHeight;
                    const context = canvas.getContext("2d")!;
                    context.drawImage(image, 0, 0);
                    return context.getImageData(0, 0, canvas.width, canvas.height);
                  }),
                );
                const [a, b] = pixels;
                if (a.width !== b.width || a.height !== b.height)
                  throw new Error("Capture size mismatch");
                const scaleX = a.width / 2280,
                  scaleY = a.height / 1170;
                let inside = 0,
                  outside = 0,
                  delta = 0;
                for (let offset = 0; offset < a.data.length; offset += 4) {
                  let changed = false;
                  for (let channel = 0; channel < 4; channel++) {
                    const difference = Math.abs(
                      a.data[offset + channel] - b.data[offset + channel],
                    );
                    delta = Math.max(delta, difference);
                    changed ||= difference !== 0;
                  }
                  if (!changed) continue;
                  const x = (offset / 4) % a.width,
                    y = Math.floor(offset / 4 / a.width);
                  if (
                    x >= region.x * scaleX &&
                    x < (region.x + region.width) * scaleX &&
                    y >= region.y * scaleY &&
                    y < (region.y + region.height) * scaleY
                  )
                    inside++;
                  else outside++;
                }
                return { inside, outside, delta };
              },
              {
                images: [main.toString("base64"), worker.toString("base64")],
                region: CLASSIC_SIGN_REGION,
              },
            );
            expect(result.outside, label).toBe(0);
            expect(result.inside, label).toBeLessThanOrEqual(CLASSIC_SIGN_PIXEL_CAP);
            expect(result.delta, label).toBeLessThanOrEqual(CLASSIC_SIGN_DELTA_CAP);
          }
        }
        await page.evaluate(() => (window as any).disposeClassic());
      }
    }
  }
});

test("classic module worker evidence", async ({ page }, testInfo) => {
  await page.goto("/tests/browser/crews/canvas-paired.html");
  for (const renderer of ["auto", "canvas"] as const) {
    await page.evaluate(async (renderer) => {
      const worker = await window.createPairedRenderer({
        kind: "crew",
        count: 3,
        renderer,
        path: "worker",
        signFailed: true,
      });
      await worker.draw({ time: 1.25, stand: 1, presence: 0 }, 0);
      if (worker.backend !== "worker") throw new Error("Worker not acknowledged");
      worker.dispose?.();
    }, renderer);
  }
  await page.waitForTimeout(150);
  const evidence = await page.evaluate(async () => ({
    ...window.workerTelemetry,
    assets: await Promise.all(
      [...new Set(window.workerTelemetry.urls)].map(async (url) => {
        const response = await fetch(url);
        return {
          url,
          status: response.status,
          type: response.headers.get("content-type"),
          bytes: (await response.arrayBuffer()).byteLength,
        };
      }),
    ),
  }));
  expect(evidence.live).toBe(0);
  expect(evidence.ready).toBe(2);
  expect(evidence.drawn).toBe(2);
  expect(evidence.assets.some((asset) => asset.url.includes("crewCanvas.worker"))).toBe(true);
  for (const asset of evidence.assets) {
    expect(asset.status).toBe(200);
    expect(asset.type).toContain("javascript");
  }
  await testInfo.attach("classic-module-worker-evidence", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
});
for (const renderer of ["auto", "canvas"] as const) {
  for (const count of [0, 1, 6])
    test(`qualified glyphs ${renderer} ${count} workers sign failed`, async ({
      page,
    }, testInfo) => {
      await expectPairedProof(page, testInfo, { kind: "crew", renderer, count, signFailed: true });
    });
  for (const scenario of ["growth", "arrivals"] as const)
    test(`qualified glyphs ${renderer} ${scenario} sign failed`, async ({ page }, testInfo) => {
      await expectPairedProof(page, testInfo, {
        kind: "crew",
        renderer,
        count: scenario === "arrivals" ? 9 : 3,
        scenario,
        signFailed: true,
      });
    });
}
test("classic worker 300 frame timing", async ({ page }, testInfo) => {
  await page.goto("/tests/browser/crews/canvas-paired.html");
  const result = await page.evaluate(() => window.classicWorkerTiming());
  console.log("CLASSIC_WORKER", JSON.stringify(result));
  await testInfo.attach("classic-worker-timing", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});

test("classic worker 30 second animated run per backend", async ({ page }, testInfo) => {
  await page.goto("/tests/browser/crews/canvas-paired.html");
  const result = await page.evaluate(() => window.classicAnimatedTiming());
  console.log("CLASSIC_ANIMATED", JSON.stringify(result));
  await testInfo.attach("classic-animated-timing", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});

test("classic real worker WebGL context loss switches to exact software fallback", async ({
  page,
}) => {
  await page.goto("/tests/browser/crews/canvas-paired.html");
  expect(await page.evaluate(() => window.classicContextLoss())).toEqual({
    lost: true,
    before: "webgl",
    after: "canvas",
    differingPixels: 0,
    maxChannelDelta: 0,
  });
});

for (const renderer of ["auto", "canvas"] as const) {
  test(`classic main versus main full sway ${renderer}`, async ({ page }) => {
    await page.goto("/tests/browser/crews/canvas-paired.html");
    const result = await page.evaluate((renderer) => window.classicMainParity(renderer), renderer);
    expect(result.frames).toBe(33);
    expect(result.differingPixels).toBe(0);
    expect(result.maxChannelDelta).toBe(0);
  });
}

for (const renderer of ["auto", "canvas"] as const) {
  for (const context of [0, 0.25, 0.5, 1, undefined]) {
    test(`classic color ${renderer} ${context ?? "unknown"} exact parity`, async ({
      page,
    }, testInfo) => {
      await expectPairedProof(page, testInfo, {
        kind: "crew",
        renderer,
        count: 3,
        color: true,
        context,
      });
    });
  }
}
test("classic color captures and neutral equivalence", async ({ page }) => {
  mkdirSync("temp/verification/R4-A", { recursive: true });
  await page.goto("/tests/browser/crews/canvas-paired.html");
  for (const context of [0, 0.5, 1, undefined]) {
    await page.evaluate(async (context) => {
      const options = { kind: "crew" as const, count: 3, renderer: "auto" as const };
      const neutral = await window.createPairedRenderer({ ...options, path: "worker" });
      document.querySelector<HTMLCanvasElement>("#worker")!.id = "main";
      const color = await window.createPairedRenderer({
        ...options,
        path: "worker",
        color: true,
        context,
      });
      const frame = { time: 1.25, stand: 1, presence: 0 };
      await neutral.draw(frame, 0);
      await color.draw(frame, 0);
      const a = await neutral.capture(),
        b = await color.capture();
      const differs = a.some((value, index) => value !== b[index]);
      if (context === 0 || context === undefined) {
        if (differs) throw new Error("Zero/unknown must preserve monochrome pixels");
      } else if (!differs) throw new Error("Color must change visible glyphs");
      (window as any).disposeColor = () => {
        neutral.dispose?.();
        color.dispose?.();
        document.querySelectorAll("canvas").forEach((c) => c.remove());
      };
      document.querySelector<HTMLCanvasElement>("#main")!.style.display = "none";
    }, context);
    for (const dark of [false, true]) {
      await page.evaluate((dark) => {
        document.body.style.background = dark ? "#171719" : "#fafafa";
      }, dark);
      await page.locator("#worker").screenshot({
        path: `temp/verification/R4-A/classic-color-${context === undefined ? "unknown" : context * 100}-${dark ? "dark" : "light"}.png`,
      });
    }
    await page.evaluate(() => (window as any).disposeColor());
  }
  await page.evaluate(async () => {
    const scene = await window.createPairedRenderer({
      kind: "crew",
      count: 3,
      renderer: "auto",
      scenario: "growth",
    });
    await scene.draw({ time: 0.25, stand: 1, presence: 0 }, 0);
  });
  await page.locator("#main").screenshot({ path: "temp/verification/R4-A/classic-growth-on.png" });
});

for (const renderer of ["auto", "canvas"] as const) {
  test(`classic independent color levels and compaction ${renderer}`, async ({
    page,
  }, testInfo) => {
    await expectPairedProof(page, testInfo, {
      kind: "crew",
      renderer,
      count: 9,
      scenario: "color",
    });
  });
}
test("classic production scene labels and color screenshots", async ({ page }) => {
  await page.goto("/tests/browser/crews/canvas-paired.html");
  for (const width of [1280, 800])
    for (const dark of [false, true])
      for (const context of [0, 0.5, 1, undefined]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(async ({ context, dark }) => window.classicScene(context, dark), {
          context,
          dark,
        });
        await expect(page.locator(".crew-scene")).toHaveAttribute("data-art-status", "ready");
        await expect(page.locator(".crew-scene__label")).toHaveCount(6);
        const expected = context === undefined ? "unknown" : String(context * 100);
        await expect(page.locator(".crew-scene__label").first()).toHaveAttribute(
          "data-charge",
          expected,
        );
        await page.locator("#classic-scene").screenshot({
          path: `temp/verification/R4-A/scene-${expected}-${dark ? "dark" : "light"}-${width}.png`,
        });
      }
  await page.evaluate(() => window.classicScene(0.1, true, true));
  await expect(page.locator(".crew-scene")).toHaveAttribute("data-art-status", "ready");
  await expect(page.locator(".crew-scene__label").first()).toHaveAttribute("data-age", "0");
  await page
    .locator("#classic-scene")
    .screenshot({ path: "temp/verification/R4-A/scene-growth-on.png" });
});

test("classic context survives narrow labels and localized role truncation", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync("temp/verification/R4-E", { recursive: true });
  await page.goto("/tests/browser/crews/canvas-paired.html");
  for (const width of [1280, 800, 512, 320, 240]) {
    await page.setViewportSize({ width, height: 900 });
    for (const dark of [false, true]) {
      for (const language of ["en", "de", "fr", "tr", "ja"] as const) {
        await page.evaluate(({ dark, language }) => window.classicScene(1, dark, false, language), {
          dark,
          language,
        });
        await expect(page.locator(".crew-scene")).toHaveAttribute("data-art-status", "ready");
        const geometry = await page.locator(".crew-scene__label").evaluateAll((labels) =>
          labels.map((label) => {
            const name = label.querySelector(".crew-scene__name")!;
            const charge = label.querySelector(".crew-scene__charge")!;
            const meter = label.querySelector(".crew-scene__meter")!;
            const bounds = label.getBoundingClientRect();
            const value = charge.getBoundingClientRect();
            const bar = meter.getBoundingClientRect();
            return {
              text: charge.textContent,
              valueFits: value.left >= bounds.left - 0.5 && value.right <= bounds.right + 0.5,
              meterFits:
                bar.left >= bounds.left - 0.5 && bar.right <= bounds.right + 0.5 && bar.width > 0,
              roleTruncates: getComputedStyle(name).textOverflow === "ellipsis",
              valueShrinks: getComputedStyle(charge).flexShrink,
              sceneFits: value.left >= 0 && bar.right <= innerWidth,
            };
          }),
        );
        expect(geometry).toHaveLength(6);
        for (const label of geometry)
          expect(label).toEqual({
            text: "100%",
            valueFits: true,
            meterFits: true,
            roleTruncates: true,
            valueShrinks: "0",
            sceneFits: true,
          });
        if (!dark) {
          expect(
            await page
              .locator('.crew-scene__label[data-working="false"]')
              .first()
              .evaluate((label) => getComputedStyle(label).opacity),
          ).toBe("1");
        }
        if (language === "en" || width === 512)
          await page.locator("#classic-scene").screenshot({
            path: `temp/verification/R4-E/scene-${dark ? "dark" : "light"}-${width}-${language}.png`,
          });
      }
    }
  }
  await page.setViewportSize({ width: 512, height: 900 });
  await page.evaluate(() => window.classicScene(0.5, true, true));
  await expect(page.locator(".crew-scene")).toHaveAttribute("data-art-status", "ready");
  await expect(page.locator(".crew-scene__charge, .crew-scene__meter")).toHaveCount(0);
  await page.locator("#classic-scene").screenshot({ path: "temp/verification/R4-E/growth-on.png" });
  for (const theme of ["star-wars", "lotr", "matrix"] as const) {
    for (const dark of [false, true]) {
      await page.evaluate(({ theme, dark }) => window.classicScene(0.5, dark, true, "en", theme), {
        theme,
        dark,
      });
      await expect(page.locator(".crew-scene")).toHaveAttribute("data-art-status", "ready");
      await page.locator("#classic-scene").screenshot({
        path: `temp/verification/R4-E/compare-${theme}-${dark ? "dark" : "light"}.png`,
      });
    }
  }
});
