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
  start.setSeconds(0, 0);
  const [hour, minute] = parseTime(schedule.time);
  if (schedule.scheduleKind === "hourly") {
    const candidate = new Date(start);
    candidate.setMinutes(clamp(schedule.minute, 0, 59), 0, 0);
    if (candidate.getTime() <= after) candidate.setHours(candidate.getHours() + 1);
    return candidate.getTime();
  }

  const candidate = new Date(start);
  candidate.setHours(hour, minute, 0, 0);
  if (schedule.scheduleKind === "daily") {
    if (candidate.getTime() <= after) candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }
  if (schedule.scheduleKind === "weekdays") {
    if (candidate.getTime() <= after) candidate.setDate(candidate.getDate() + 1);
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  const day = clamp(schedule.dayOfWeek, 0, 6);
  let days = (day - candidate.getDay() + 7) % 7;
  if (days === 0 && candidate.getTime() <= after) days = 7;
  candidate.setDate(candidate.getDate() + days);
  return candidate.getTime();
}

export function parseTime(value: string): [number, number] {
  const [hour, minute] = value.split(":").map(Number);
  return [clamp(hour, 0, 23), clamp(minute, 0, 59)];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
