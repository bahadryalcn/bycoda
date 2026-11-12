import { expect, test } from "@playwright/test";
import { expectPairedProof } from "./paired-proof-test";

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
          expect(worker.equals(main), label).toBe(true);
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
