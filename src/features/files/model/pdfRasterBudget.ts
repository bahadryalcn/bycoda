// Counts both the visible bitmap and its temporary render buffer. CSS and text
// geometry remain at the requested zoom, independently of raster resolution.
export const PDF_PAGE_PIXELS = 2_000_000;
export const PDF_TOTAL_PIXELS = 16_000_000;
export function pdfRasterSize(width: number, height: number, dpr: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid PDF page dimensions");
  }
  const ratio = Math.min(
    Math.max(1, dpr || 1),
    Math.sqrt(PDF_PAGE_PIXELS / (width * height)),
    8192 / Math.max(width, height),
  );
  return {
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
    ratio,
  };
}

export class PdfRasterBudget {
  private used = 0;
  private waiting = new Set<() => void>();
  get pixels() {
    return this.used;
  }
  reserve(pixels: number, signal: AbortSignal): Promise<(pixels?: number) => void> {
    if (!Number.isSafeInteger(pixels) || pixels > PDF_TOTAL_PIXELS || pixels <= 0)
      return Promise.reject(new Error("Invalid PDF raster allocation"));
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.waiting.delete(attempt);
        reject(signal.reason);
      };
      const attempt = () => {
        if (signal.aborted) {
          abort();
          return;
        }
        if (this.used + pixels > PDF_TOTAL_PIXELS) {
          this.waiting.add(attempt);
          return;
        }
        this.waiting.delete(attempt);
        signal.removeEventListener("abort", abort);
        this.used += pixels;
        let remaining = pixels;
        resolve((amount = remaining) => {
          const released = Math.min(remaining, Math.max(0, amount));
          remaining -= released;
          this.used -= released;
          // Wake callbacks mutate the queue; iterate a snapshot to avoid requeue loops.
          // oxlint-disable-next-line unicorn/no-useless-spread
          for (const wake of [...this.waiting]) wake();
        });
      };
      signal.addEventListener("abort", abort, { once: true });
      attempt();
    });
  }
}
