/** Schedule arithmetic shared by the desktop and the host; no platform imports. */

export type AutomationScheduleKind = "hourly" | "daily" | "weekdays" | "weekly";

export type AutomationSchedule = {
  scheduleKind: AutomationScheduleKind;
  minute: number;
  time: string;
  dayOfWeek: number;
};

export function isScheduleKind(value: string): value is AutomationScheduleKind {
  return value === "hourly" || value === "daily" || value === "weekdays" || value === "weekly";
}

export function nextAutomationRunAt(schedule: AutomationSchedule, after = Date.now()): number {
  const start = new Date(after);
  if (!Number.isFinite(start.getTime())) return NaN;
  const [hour, minute] = parseTime(schedule.time);
  if (schedule.scheduleKind === "hourly") {
    // Walk actual minutes so both occurrences of a folded hour remain eligible.
    const minute = clamp(schedule.minute, 0, 59);
    let candidate = Math.floor(after / 60_000) * 60_000 + 60_000;
    while (new Date(candidate).getMinutes() !== minute) {
      if (!Number.isFinite(new Date(candidate).getTime())) return NaN;
      candidate += 60_000;
    }
    return candidate;
  }

  // Reconstruct each calendar date with the configured time. A missing time may
  // normalize forward on its own date, but must not shift later dates as well.
  for (let days = 0; ; days++) {
    const candidate = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + days,
      hour,
      minute,
    );
    if (!Number.isFinite(candidate.getTime())) return NaN;
    const day = candidate.getDay();
    if (schedule.scheduleKind === "weekdays" && (day === 0 || day === 6)) continue;
    if (schedule.scheduleKind === "weekly" && day !== clamp(schedule.dayOfWeek, 0, 6)) continue;
    if (candidate.getTime() > after) return candidate.getTime();
  }
}

export function parseTime(value: string): [number, number] {
  const [hour, minute] = value.split(":").map(Number);
  return [clamp(hour, 0, 23), clamp(minute, 0, 59)];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
