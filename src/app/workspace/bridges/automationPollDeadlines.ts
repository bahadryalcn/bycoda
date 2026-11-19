/** Longest one poller step may wait on a single window, native or remote call.
 * A step that outlives its deadline is abandoned, never repeated: its late
 * result is ignored and the next tick retries from persisted state. */
export const AUTOMATION_POLL_DEADLINES = {
  leaderCheckMs: 10_000,
  localReadMs: 15_000,
  remoteReadMs: 20_000,
  /** One waiter on the shared once-per-process recovery; the recovery itself is never restarted. */
  recoveryWaitMs: 30_000,
  /** Native due-run claim; its in-flight call is awaited again instead of claiming twice. */
  dueClaimMs: 15_000,
  /** Session acceptance; an uncertain launch is never relaunched. */
  launchAcceptMs: 60_000,
} as const;
