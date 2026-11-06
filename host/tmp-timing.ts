// TEMPORARY Windows dispatch timing probe. Not for merge.
import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const file = process.env.BYCODA_TIMING_LOG;
export function tmark(label: string, start: number, extra = ""): number {
  const now = performance.now();
  if (file)
    try {
      appendFileSync(
        file,
        `${new Date().toISOString()} pid=${process.pid} ${(now - start).toFixed(1).padStart(8)}ms ${label} ${extra}\n`,
      );
    } catch {
      /* probe only */
    }
  return now;
}
export const tnow = () => performance.now();
