import { createHash } from "node:crypto";
import type { SocialPublishingSchedule } from "../src/features/social/model/social";

const MINUTE = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let result = formatters.get(timeZone);
  if (!result) {
    result = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    // Intl validates timezones when the formatter is constructed.
    formatters.set(timeZone, result);
  }
  return result;
}
function clockMinutes(value: string): number {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error("Use HH:mm for the publishing window.");
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) throw new Error("Invalid publishing window time.");
  return hours * 60 + minutes;
}
export function parsePublishingSchedule(raw: unknown): SocialPublishingSchedule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Choose a publishing schedule.");
  const value = raw as Record<string, unknown>;
  const allowed = ["timeZone", "startTime", "endTime", "minIntervalMinutes", "maxIntervalMinutes"];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unknown publishing schedule field.");
  if (typeof value.timeZone !== "string" || value.timeZone.length > 100)
    throw new Error("Choose an IANA timezone.");
  try {
    formatter(value.timeZone);
  } catch {
    throw new Error("Choose a valid IANA timezone.");
  }
  if (typeof value.startTime !== "string" || typeof value.endTime !== "string")
    throw new Error("Choose a publishing window.");
  clockMinutes(value.startTime);
  clockMinutes(value.endTime);
  const min = value.minIntervalMinutes;
  const max = value.maxIntervalMinutes;
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 1 ||
    max < min ||
    max > 7 * 24 * 60
  )
    throw new Error(
      "Publishing intervals must be whole minutes from 1 to 10080; maximum must be at least minimum.",
    );
  return {
    timeZone: value.timeZone,
    startTime: value.startTime,
    endTime: value.endTime,
    minIntervalMinutes: min,
    maxIntervalMinutes: max,
  };
}
export function inPublishingWindow(schedule: SocialPublishingSchedule, at: number): boolean {
  const parts = formatter(schedule.timeZone).formatToParts(at);
  const current =
    Number(parts.find((part) => part.type === "hour")!.value) * 60 +
    Number(parts.find((part) => part.type === "minute")!.value);
  const start = clockMinutes(schedule.startTime);
  const end = clockMinutes(schedule.endTime);
  return (
    start === end ||
    (start < end ? current >= start && current < end : current >= start || current < end)
  );
}
/** Walk actual UTC minutes, so DST folds/gaps and overnight windows stay correct. */
export function nextPublishingWindow(schedule: SocialPublishingSchedule, earliest: number): number {
  if (inPublishingWindow(schedule, earliest)) return earliest;
  let candidate = Math.ceil(earliest / MINUTE) * MINUTE;
  for (let index = 0; index < 3 * 24 * 60; index++, candidate += MINUTE)
    if (inPublishingWindow(schedule, candidate)) return candidate;
  throw new Error("No publishing window is available in the next three days.");
}
/** Stable jitter survives restart; quiet hours can extend the maximum interval. */
export function nextPublishingRun(
  schedule: SocialPublishingSchedule,
  previousAt: number,
  planId: string,
  nextIndex: number,
): number {
  const seed = createHash("sha256").update(`${planId}:${nextIndex}`).digest().readUInt32BE(0);
  const span = schedule.maxIntervalMinutes - schedule.minIntervalMinutes + 1;
  const minutes = schedule.minIntervalMinutes + (seed % span);
  return nextPublishingWindow(schedule, previousAt + minutes * MINUTE);
}
