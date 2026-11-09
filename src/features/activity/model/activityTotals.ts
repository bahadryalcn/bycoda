import { dateTimeFormat } from "../../../shared/lib/intl";
import { localDateFor, type ActivitySummary } from "@bycoda/account-contracts/activity";
import { formatNumber, t } from "../../../shared/i18n";
import { activityClient } from "./activityClient";

/** "3h 40m", "62h", "25m"; locale digits and grouping, zero reads "0m". */
export function formatActiveMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return t("{p0}m", { p0: formatNumber(rest) });
  if (rest === 0) return t("{p0}h", { p0: formatNumber(hours) });
  return t("{p0}h {p1}m", { p0: formatNumber(hours), p1: formatNumber(rest) });
}

/** Active minutes of the local day before `summary`'s last day (the 7-day list ends today). */
export function yesterdayMinutes(summary: ActivitySummary): number | null {
  const days = summary.last7Days;
  return days.length >= 2 ? (days[days.length - 2]?.minutes ?? null) : null;
}

/**
 * Non-React access for notifications and other services: totals for today, week, month and
 * year plus the last seven days, or null when the Host cannot answer.
 */
export async function getActivityTotals(
  machineId: string,
  now = new Date(),
  timeZone = dateTimeFormat().resolvedOptions().timeZone,
): Promise<ActivitySummary | null> {
  try {
    return await activityClient(machineId).summary({
      today: localDateFor(now, timeZone),
      timeZone,
    });
  } catch {
    return null;
  }
}
