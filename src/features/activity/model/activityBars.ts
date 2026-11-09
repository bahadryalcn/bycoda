import type { ActivitySummary } from "@bycoda/account-contracts/activity";
import { formatDate } from "../../../shared/i18n";
import type { BarChartDatum } from "../../../shared/ui/Charts";

/** A `YYYY-MM-DD` activity date as local midnight. */
export const localDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

/** Bars for the last seven local days, oldest first. */
export function activityBars(summary: ActivitySummary): BarChartDatum[] {
  return summary.last7Days.map(({ date, minutes }) => ({
    key: date,
    label: formatDate(localDay(date), {
      weekday: "long",
      month: "short",
      day: "numeric",
    }),
    axisLabel: formatDate(localDay(date), { weekday: "narrow" }),
    value: minutes,
  }));
}
