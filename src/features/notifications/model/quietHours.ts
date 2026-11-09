import type { QuietHours } from "@bycoda/account-contracts";
import { dateTimeFormat } from "../../../shared/lib/intl";

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

function localMinutes(at: number, timeZone: string): number | null {
  try {
    const parts = dateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(at));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

/**
 * Whether `at` (unix ms) falls inside the quiet hours: start inclusive, end exclusive, a window
 * may wrap midnight, an empty window (start = end) or an unknown zone is never quiet. Mirrors the
 * server rule so the desktop and the phone agree.
 */
export function inQuietHours(quiet: QuietHours | null | undefined, at: number): boolean {
  if (!quiet) return false;
  const now = localMinutes(at, quiet.timeZone);
  if (now === null) return false;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
