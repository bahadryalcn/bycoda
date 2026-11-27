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

/** A step still running after this long logs `boot stalled`, and again at each interval. */
export const BOOT_STALL_WARNING_MS = 30_000;

/**
 * Times one awaited start-up step inside a larger phase; its result and failure pass through.
 * A step that has not settled logs `boot stalled` with its name every `BOOT_STALL_WARNING_MS`,
 * so a wedged phase that holds `listen` back leaves evidence instead of silence.
 */
export async function bootPhase<T>(
  phase: string,
  work: () => Promise<T>,
  log: BootLog = bootLog(),
  now: () => number = monotonicNow,
): Promise<T> {
  const startedAt = now();
  const stalled = setInterval(
    () => log.warn("boot stalled", { phase, ms: Math.round(elapsedSince(startedAt, now())) }),
    BOOT_STALL_WARNING_MS,
  );
  stalled.unref();
  try {
    const result = await work();
    log.info("boot", { phase, ms: Math.round(elapsedSince(startedAt, now())) });
    return result;
  } catch (error) {
    log.warn("boot failed", { phase, ms: Math.round(elapsedSince(startedAt, now())) });
    throw error;
  } finally {
    clearInterval(stalled);
  }
}

/** How long boot waits for a service whose callers await its readiness themselves. */
export const BOOT_OPTIONAL_READY_MS = 20_000;

/**
 * Waits up to `ms` for an optional service's readiness. The callers of such a service await
 * its readiness itself, so past the deadline the Host starts without it: `boot degraded`
 * names the service and the late outcome is logged when it arrives. A readiness failure
 * within the deadline still fails start-up.
 */
export async function readyWithin(
  phase: string,
  ready: Promise<unknown>,
  ms: number = BOOT_OPTIONAL_READY_MS,
  log: BootLog = bootLog(),
  now: () => number = monotonicNow,
): Promise<void> {
  const startedAt = now();
  const late = Symbol("late");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    ready,
    new Promise<typeof late>((resolve) => {
      timer = setTimeout(() => resolve(late), ms);
    }),
  ]).finally(() => clearTimeout(timer));
  if (outcome !== late) return;
  log.warn("boot degraded", { phase, ms: Math.round(elapsedSince(startedAt, now())) });
  void ready.then(
    () => log.info("boot", { phase, ms: Math.round(elapsedSince(startedAt, now())), late: true }),
    () => log.warn("boot failed", { phase, ms: Math.round(elapsedSince(startedAt, now())) }),
  );
}
