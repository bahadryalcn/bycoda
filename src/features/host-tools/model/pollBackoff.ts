/** Consecutive failed polls before automatic polling gives up and the owner must retry. */
export const MAX_POLL_FAILURES = 3;
/** A scan that stopped changing is read less often (each scan starts PowerShell on Windows). */
export const QUIET_SCANS = 3;

/** Delay to the next poll: slower for a quiet list, doubled per consecutive failure up to 4x. */
export function pollDelay(interval: number, failures: number, quietScans = 0): number {
  const base =
    quietScans >= QUIET_SCANS * 2
      ? interval * 4
      : quietScans >= QUIET_SCANS
        ? interval * 2
        : interval;
  return base * Math.min(4, 2 ** failures);
}
