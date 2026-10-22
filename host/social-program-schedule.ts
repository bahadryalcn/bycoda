import { createHash } from "node:crypto";
import type { ProgramSchedule } from "../src/features/social/model/socialProgram";

const MINUTE = 60_000;
const cache = new Map<string, Intl.DateTimeFormat>();
const wallCache = new Map<string, Map<number, number>>();
function parts(zone: string, at: number) {
  let fmt = cache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    cache.set(zone, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  return {
    day,
    clock: Number(p.hour) * 60 + Number(p.minute),
    weekday: new Date(`${day}T12:00:00Z`).getUTCDay() || 7,
  };
}
function clock(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("Use HH:mm for publishing times.");
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function wallMinute(zone: string, day: string, minute: number) {
  const key = `${zone}:${day}`;
  let minutes = wallCache.get(key);
  if (!minutes) {
    minutes = new Map();
    const base = Date.parse(`${day}T00:00:00Z`);
    for (
      let candidate = base - 14 * 3600000;
      candidate <= base + 38 * 3600000;
      candidate += MINUTE
    ) {
      const p = parts(zone, candidate);
      if (p.day === day && !minutes.has(p.clock)) minutes.set(p.clock, candidate);
    }
    if (wallCache.size >= 128) wallCache.delete(wallCache.keys().next().value!);
    wallCache.set(key, minutes);
  }
  for (let clock = minute; clock < 1440; clock++) {
    const candidate = minutes.get(clock);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}
export function parseProgramSchedule(raw: unknown): ProgramSchedule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Choose a publishing schedule.");
  const s = raw as ProgramSchedule;
  const keys = [
    "mode",
    "timeZone",
    "startsAt",
    "endsAt",
    "days",
    "startTime",
    "endTime",
    "times",
    "minIntervalMinutes",
    "maxIntervalMinutes",
    "frequency",
    "period",
  ];
  if (Object.keys(s).some((k) => !keys.includes(k))) throw new Error("Unknown schedule field.");
  if (!["interval", "times", "frequency"].includes(s.mode) || !["day", "week"].includes(s.period))
    throw new Error("Invalid schedule mode.");
  if (typeof s.timeZone !== "string" || s.timeZone.length > 100)
    throw new Error("Choose an IANA timezone.");
  parts(s.timeZone, Date.now());
  if (
    !Number.isSafeInteger(s.startsAt) ||
    s.startsAt < 0 ||
    (s.endsAt !== undefined && (!Number.isSafeInteger(s.endsAt) || s.endsAt <= s.startsAt))
  )
    throw new Error("Invalid campaign dates.");
  if (
    !Array.isArray(s.days) ||
    !s.days.length ||
    s.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
  )
    throw new Error("Select publishing days.");
  clock(s.startTime);
  clock(s.endTime);
  if (!Array.isArray(s.times) || !s.times.length || s.times.length > 48)
    throw new Error("Choose 1–48 publishing times.");
  s.times.forEach(clock);
  if (
    ![s.minIntervalMinutes, s.maxIntervalMinutes, s.frequency].every(Number.isSafeInteger) ||
    s.minIntervalMinutes < 1 ||
    s.maxIntervalMinutes < s.minIntervalMinutes ||
    s.maxIntervalMinutes > 10080 ||
    s.frequency < 1 ||
    s.frequency > 48
  )
    throw new Error("Invalid publishing interval or frequency.");
  const days = [...new Set(s.days)].sort();
  const span = (clock(s.endTime) - clock(s.startTime) + 1440) % 1440 || 1440;
  const maxPerDay = s.period === "day" ? s.frequency : Math.ceil(s.frequency / days.length);
  if (s.mode === "frequency" && maxPerDay > span)
    throw new Error(
      "Widen the publishing window or reduce the frequency: each post needs a distinct minute.",
    );
  return { ...s, days, times: [...new Set(s.times)].sort() };
}
export function programWindow(s: ProgramSchedule, at: number) {
  const p = parts(s.timeZone, at),
    start = clock(s.startTime),
    end = clock(s.endTime);
  // An overnight window belongs to its starting weekday.
  const day = start > end && p.clock < end ? (p.weekday === 1 ? 7 : p.weekday - 1) : p.weekday;
  return (
    s.days.includes(day) &&
    (start === end ||
      (start < end ? p.clock >= start && p.clock < end : p.clock >= start || p.clock < end))
  );
}
export function programDay(s: ProgramSchedule, at: number) {
  return parts(s.timeZone, at).day;
}

/** Resolve a wall-clock slot once. Gaps advance to the first valid local minute;
 * a fold chooses its first UTC occurrence. Only a bounded date window is scanned. */
function slots(s: ProgramSchedule, from: number): number[] {
  const base = new Date(`${parts(s.timeZone, from).day}T00:00:00Z`).getTime();
  const result: number[] = [];
  // Overnight frequency slots retain the weekday of their window's start.
  const firstDate = s.mode === "frequency" && clock(s.startTime) > clock(s.endTime) ? -1 : 0;
  for (let dateIndex = firstDate; dateIndex < 9; dateIndex++) {
    const localDate = new Date(base + dateIndex * 86400000).toISOString().slice(0, 10);
    const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay() || 7;
    if (!s.days.includes(weekday)) continue;
    const start = clock(s.startTime),
      end = clock(s.endTime),
      span = (end - start + 1440) % 1440 || 1440;
    let requested: number[];
    if (s.mode === "times") requested = s.times.map(clock);
    else {
      const days = [...s.days].sort((a, b) => a - b),
        dayIndex = days.indexOf(weekday);
      const count =
        s.period === "day"
          ? s.frequency
          : Math.floor(s.frequency / days.length) + (dayIndex < s.frequency % days.length ? 1 : 0);
      requested = Array.from({ length: count }, (_, i) => start + Math.floor((span * i) / count));
    }
    for (const minute of requested) {
      const dayOffset = Math.floor(minute / 1440),
        targetDay = new Date(base + (dateIndex + dayOffset) * 86400000).toISOString().slice(0, 10),
        targetClock = minute % 1440;
      const found = wallMinute(s.timeZone, targetDay, targetClock);
      if (found !== undefined && found >= from) result.push(found);
    }
  }
  return [...new Set(result)].sort((a, b) => a - b);
}
export function nextProgramSlot(s: ProgramSchedule, earliest: number): number | undefined {
  earliest = Math.max(earliest, s.startsAt);
  let at: number | undefined;
  if (s.mode !== "interval") at = slots(s, earliest)[0];
  else {
    let candidate = Math.ceil(earliest / MINUTE) * MINUTE;
    for (let i = 0; i < 9 * 1440; i++, candidate += MINUTE)
      if (programWindow(s, candidate)) {
        at = candidate;
        break;
      }
  }
  return at !== undefined && (s.endsAt === undefined || at <= s.endsAt) ? at : undefined;
}
export function followingProgramSlot(
  s: ProgramSchedule,
  previous: number,
  _id: string,
  sequence: number,
) {
  const seed = createHash("sha256")
    .update(`${s.minIntervalMinutes}:${s.maxIntervalMinutes}:${sequence}`)
    .digest()
    .readUInt32BE(0);
  const delta =
    s.mode === "interval"
      ? s.minIntervalMinutes + (seed % (s.maxIntervalMinutes - s.minIntervalMinutes + 1))
      : 1;
  return nextProgramSlot(s, previous + delta * MINUTE);
}
export function previewProgramSchedule(s: ProgramSchedule, count = 10) {
  const dates: number[] = [];
  let at = nextProgramSlot(s, s.startsAt);
  for (let i = 0; i < Math.min(count, 50) && at !== undefined; i++) {
    dates.push(at);
    at = followingProgramSlot(s, at, "preview", i + 1);
  }
  return dates;
}
