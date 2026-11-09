/** Quota-window arithmetic for `usage.limits.read`; pure so every rule is testable. */

export type LimitWindow = {
  /** Percent of the window consumed, 0-100. */
  usedPercent: number;
  windowMinutes: number;
  /** Unix ms of the next reset, if the provider reported one. */
  resetsAt: number | null;
};

/** `ahead` spends faster than the clock allows, `behind` has headroom. */
export type Pace = "ahead" | "on" | "behind";

export type WindowReading = {
  usedPercent: number;
  leftPercent: number;
  /** What a reset gives back: the whole used share. */
  regainPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
  /** Share of the window still ahead of us, where an even spender would have this much left. */
  timeLeftPercent: number | null;
  pace: Pace | null;
};

/** Within this many points of the clock the window counts as on pace. */
export const PACE_TOLERANCE_POINTS = 5;

const clampPercent = (value: number) =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
const round1 = (value: number) => Math.round(value * 10) / 10;

export function windowReading(window: LimitWindow, now: number): WindowReading {
  const used = clampPercent(window.usedPercent);
  const left = 100 - used;
  const windowMs = window.windowMinutes * 60_000;
  // A reset time in the past means the reading is stale, not that pace is known.
  const live =
    window.resetsAt !== null && window.resetsAt > now && windowMs > 0 && Number.isFinite(windowMs);
  const timeLeft = live
    ? clampPercent((((window.resetsAt as number) - now) / windowMs) * 100)
    : null;
  let pace: Pace | null = null;
  if (timeLeft !== null) {
    const gap = left - timeLeft;
    pace = gap < -PACE_TOLERANCE_POINTS ? "ahead" : gap > PACE_TOLERANCE_POINTS ? "behind" : "on";
  }
  return {
    usedPercent: round1(used),
    leftPercent: round1(left),
    regainPercent: round1(used),
    windowMinutes: window.windowMinutes,
    resetsAt: window.resetsAt,
    timeLeftPercent: timeLeft === null ? null : round1(timeLeft),
    pace,
  };
}
