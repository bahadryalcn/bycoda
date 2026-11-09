import { dateTimeFormat } from "../lib/intl";
import { useEffect, useState } from "react";
import { Timeline as ArcTimeline, type TimelineProps } from "./arc/timeline/timeline";
import { useLocale, useT } from "../i18n";

/**
 * Chronological event list grouped by day (Today, Yesterday, dates) in the machine's local time zone, with
 * localized headings. Ticks its own clock unless `now` is passed.
 * @group data
 * @use History of a task, thread or record: events with time, text and optional recovery actions.
 * @avoid A single time value: Timestamp. Tabular records: SortableDataTable. Ordered workflow steps: Stepper.
 * @arc timeline
 */
export function Timeline({
  className,
  now: providedNow,
  ...props
}: Omit<TimelineProps, "now" | "messages" | "formatRelativeTime"> & { now?: number }) {
  const t = useT();
  const currentLocale = useLocale();
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    if (providedNow !== undefined) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [providedNow]);
  const now = providedNow ?? clock;
  if (now === null) return null;
  const locale = props.locale ?? currentLocale;
  const timeZone = props.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const clockFormat = dateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  return (
    <ArcTimeline
      {...props}
      now={now}
      locale={locale}
      timeZone={timeZone}
      className={["bycoda-arc bycoda-arc-timeline", className].filter(Boolean).join(" ")}
      messages={{
        today: t("Today"),
        yesterday: t("Yesterday"),
        unit: (count) => t(count === 1 ? "Timeline update" : "Timeline updates"),
        newUpdate: (text) => t("New update: {p0}", { p0: text }),
      }}
      formatRelativeTime={(at) => ({ short: clockFormat.format(new Date(at)), long: "" })}
    />
  );
}
