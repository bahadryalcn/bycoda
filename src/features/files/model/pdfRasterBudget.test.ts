import { expect, it } from "vitest";
import {
  PDF_PAGE_PIXELS,
  PDF_TOTAL_PIXELS,
  PdfRasterBudget,
  pdfRasterSize,
} from "./pdfRasterBudget";

it("bounds A4 and large formats at every supported zoom and DPR", () => {
  for (const [width, height] of [
    [595, 842],
    [14400, 20000],
  ]) {
    for (const dpr of [1, 2, 3])
      for (const zoom of [0.25, 1, 5]) {
        const raster = pdfRasterSize(width * zoom, height * zoom, dpr);
        expect(raster.width * raster.height).toBeLessThanOrEqual(PDF_PAGE_PIXELS);
        expect(Math.max(raster.width, raster.height)).toBeLessThanOrEqual(8192);
      }
  }
});

it("rejects invalid allocation sizes without poisoning the shared budget", async () => {
  const pool = new PdfRasterBudget();
  const signal = new AbortController().signal;
  for (const pixels of [NaN, Infinity, -1, 0, 1.5]) {
    await expect(pool.reserve(pixels, signal)).rejects.toThrow("Invalid PDF raster allocation");
  }
  expect(pool.pixels).toBe(0);
  for (const width of [NaN, Infinity, 0, -1])
    expect(() => pdfRasterSize(width, 800, 2)).toThrow("Invalid PDF page dimensions");
});
it("bounds concurrent canvases, resumes waiters and cancels queued allocations", async () => {
  const pool = new PdfRasterBudget();
  const signal = new AbortController();
  const release = await pool.reserve(PDF_TOTAL_PIXELS, signal.signal);
  let allocated = false;
  const next = pool.reserve(100, signal.signal).then((release) => {
    allocated = true;
    return release;
  });
  await Promise.resolve();
  expect(allocated).toBe(false);
  release(100);
  const releaseNext = await next;
  expect(pool.pixels).toBe(PDF_TOTAL_PIXELS);
  const cancelled = new AbortController();
  const pending = pool.reserve(100, cancelled.signal);
  cancelled.abort(new Error("Cancelled"));
  await expect(pending).rejects.toThrow("Cancelled");
  release();
  release();
  releaseNext();
  expect(pool.pixels).toBe(0);
});
