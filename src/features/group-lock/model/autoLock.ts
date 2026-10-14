/** Minutes of inactivity before every group locks. 0 turns it off. */
export const AUTO_LOCK_MINUTES = [0, 5, 15, 30, 60] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_MINUTES)[number];
export const AUTO_LOCK_DEFAULT: AutoLockMinutes = 0;

export function parseAutoLockMinutes(value: unknown): AutoLockMinutes {
  return AUTO_LOCK_MINUTES.find((minutes) => minutes === value) ?? AUTO_LOCK_DEFAULT;
}

export function autoLockLabel(minutes: AutoLockMinutes): string {
  return minutes === 0 ? "Off" : `${minutes} minutes`;
}

/** True once the app has seen no input for the whole interval. */
export function autoLockDue(
  lastActivityAt: number,
  now: number,
  minutes: AutoLockMinutes,
): boolean {
  return minutes > 0 && now - lastActivityAt >= minutes * 60_000;
}
