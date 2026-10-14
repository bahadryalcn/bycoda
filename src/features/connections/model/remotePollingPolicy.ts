/** Transcript reads may slow down in the background; explicit commands never do. */
export function remoteSessionPollDelay(
  active: boolean,
  visible: boolean,
  hidden: boolean,
  failures = 0,
): number {
  const normal = hidden
    ? active
      ? 5_000
      : 30_000
    : !visible
      ? active
        ? 3_000
        : 10_000
      : active
        ? 750
        : 1_500;
  return failures ? Math.max(normal, Math.min(30_000, 750 * 2 ** Math.min(failures, 6))) : normal;
}

/** The wait after `failures` consecutive failed polls of one machine: 6 s,
 * 12 s, 24 s, then 30 s. Shared by every poller so they back off alike. */
export function remoteBackoffDelay(failures: number): number {
  return Math.min(30_000, 3_000 * 2 ** Math.min(4, failures));
}

/** Spreads retries of many targets that failed together (+-15 %). */
export function withBackoffJitter(delay: number, random: () => number = Math.random): number {
  return Math.round(delay * (0.85 + 0.3 * random()));
}
