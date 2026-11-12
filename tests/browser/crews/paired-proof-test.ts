import { expect, type Page, type TestInfo } from "@playwright/test";
import type { ProofOptions } from "./canvas-paired";
import { CLASSIC_SIGN_PIXEL_CAP, CLASSIC_SIGN_DELTA_CAP } from "./classic-sign-parity";

export async function expectPairedProof(page: Page, testInfo: TestInfo, options: ProofOptions) {
  await page.goto("/tests/browser/crews/canvas-paired.html");
  const result = await page.evaluate((input) => window.runPairedProof(input), options);
  if (result.firstFailure) {
    for (const name of ["reference", "candidate", "diff"] as const) {
      await testInfo.attach(`${name}-frame-${result.firstFailure.sequence}`, {
        body: Buffer.from(result.firstFailure[name].split(",")[1], "base64"),
        contentType: "image/png",
      });
    }
  }
  await testInfo.attach("paired-metrics", {
    body: JSON.stringify({ options, ...result }),
    contentType: "application/json",
  });
  expect(result.frames).toBeGreaterThan(1);
  expect(result.nonemptyFrames, "Reject blank painter false positives").toBeGreaterThan(0);
  expect(result.outsideRegionPixels, "Every pixel outside the sign stays exact").toBe(0);
  if (options.kind === "crew" && !options.signFailed) {
    expect(result.maxRegionPixelsPerFrame).toBeLessThanOrEqual(CLASSIC_SIGN_PIXEL_CAP);
    expect(result.maxChannelDelta).toBeLessThanOrEqual(CLASSIC_SIGN_DELTA_CAP);
  } else {
    expect(result.differingPixels, "Differing RGBA pixels across entire sequence").toBe(0);
    expect(result.maxChannelDelta).toBe(0);
  }
  if (options.kind !== "dots") expect(result.backend).toEqual(["main", "worker"]);
  if (options.kind === "crew")
    expect(result.gpu).toEqual(options.renderer === "auto" ? [true, true] : [false, false]);
}
