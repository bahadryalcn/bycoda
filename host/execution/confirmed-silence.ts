import { ObservedRunDuration } from "../../src/features/automations/model/automationLimits";
import type { HostStore } from "../store";
import { monotonicNow } from "../../src/shared/lib/time/timestamps";

// Stall age on the same sleep-aware clock as run limits. `lastActivityAt` stays a persisted
// wall-clock fact; only the silence after it is confirmed. A heartbeat samples the Host's own
// monotonic clock; a sample it cannot vouch for (system sleep, a clock jump, a stalled Host
// loop) is remembered as an unobserved wall-clock interval and never counts as silence, so a
// resumed Host does not mistake a suspended worker for a stalled one. A process that has not
// seen the interval (a Host restart) measures plain wall-clock age, so a genuinely stalled
// worker is still detected after a restart.
const SAMPLE_GAP_MS = 90_000;
const MAX_GAPS = 256;

interface Ledger {
  clock: ObservedRunDuration;
  at: number;
  gaps: { from: number; to: number }[];
}
const ledgers = new WeakMap<HostStore, Ledger>();

/** Heartbeat: call at least once per supervision interval (the assistant timer does). */
export function observeSupervisionClock(
  store: HostStore,
  wall = Date.now(),
  monotonic = monotonicNow(),
): Ledger {
  let ledger = ledgers.get(store);
  if (!ledger) {
    ledger = { clock: new ObservedRunDuration(wall, monotonic), at: wall, gaps: [] };
    ledgers.set(store, ledger);
    return ledger;
  }
  ledger.clock.sample(wall, monotonic, SAMPLE_GAP_MS);
  if (ledger.clock.uncertainSample && wall > ledger.at) {
    const last = ledger.gaps.at(-1);
    if (last && last.to >= ledger.at) last.to = wall;
    else ledger.gaps.push({ from: ledger.at, to: wall });
    if (ledger.gaps.length > MAX_GAPS) ledger.gaps.shift();
  }
  ledger.at = wall;
  return ledger;
}

/**
 * Milliseconds of silence since `lastActivityAt` that this process can confirm: the wall-clock
 * age minus every interval the Host could not observe.
 */
export function confirmedSilence(
  store: HostStore,
  lastActivityAt: number,
  wall = Date.now(),
  monotonic = monotonicNow(),
): number {
  const { gaps } = observeSupervisionClock(store, wall, monotonic);
  let silence = wall - lastActivityAt;
  for (const gap of gaps)
    silence -= Math.max(0, Math.min(gap.to, wall) - Math.max(gap.from, lastActivityAt));
  return Math.max(0, silence);
}

/** Whether the confirmed silence has reached the stall window. */
export const stallConfirmed = (
  store: HostStore,
  lastActivityAt: number,
  stallMs: number,
  wall?: number,
  monotonic?: number,
): boolean => confirmedSilence(store, lastActivityAt, wall, monotonic) >= stallMs;
