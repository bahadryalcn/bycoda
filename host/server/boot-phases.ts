import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { createLogger, type Logger } from "../diagnostics/logger";

type BootLog = Pick<Logger, "info" | "warn">;
const bootLog = (): BootLog => createLogger("host.lifecycle");

/**
 * Attributes Host start-up time to named phases as `host.lifecycle boot phase=<name> ms=<n>`.
 * `phase` ends the phase in progress and starts the next, so the phases are contiguous and
 * add up to the `total` that `ready` reports. Timing only: nothing here affects start-up.
 */
export function createBootTimer(
  log: BootLog = bootLog(),
  now: () => number = monotonicNow,
  processUptimeMs: () => number = () => process.uptime() * 1000,
) {
  const startedAt = now();
  // Runtime start-up and the work the CLI does before `serve` begins are not a phase here.
  log.info("boot", { phase: "pre-serve", ms: Math.round(processUptimeMs()) });
  let current: { phase: string; startedAt: number } | undefined;
  const end = (failed: boolean): void => {
    if (!current) return;
    const fields = { phase: current.phase, ms: Math.round(elapsedSince(current.startedAt, now())) };
    current = undefined;
    if (failed) log.warn("boot failed", fields);
    else log.info("boot", fields);
  };
  return {
    phase(phase: string): void {
      end(false);
      current = { phase, startedAt: now() };
    },
    /** The Host answers requests: ends the last phase and reports the whole start-up. */
    ready(): void {
      end(false);
      log.info("boot", { phase: "total", ms: Math.round(elapsedSince(startedAt, now())) });
    },
    /** Start-up stopped in the phase in progress. */
    failed(): void {
      end(true);
    },
  };
}

/** Times one awaited start-up step inside a larger phase; its result and failure pass through. */
export async function bootPhase<T>(
  phase: string,
  work: () => Promise<T>,
  log: BootLog = bootLog(),
  now: () => number = monotonicNow,
): Promise<T> {
  const startedAt = now();
  try {
    const result = await work();
    log.info("boot", { phase, ms: Math.round(elapsedSince(startedAt, now())) });
    return result;
  } catch (error) {
    log.warn("boot failed", { phase, ms: Math.round(elapsedSince(startedAt, now())) });
    throw error;
  }
}
