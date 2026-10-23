import { dateTimeFormat } from "../lib/intl";
import { useEffect, useState } from "react";
import { Timeline as ArcTimeline, type TimelineProps } from "./arc/timeline/timeline";
import { getLocale, useT } from "../i18n";

/** Locale-aware history using the current machine's local time zone. */
export function Timeline({
  className,
  now: providedNow,
  ...props
}: Omit<TimelineProps, "now" | "messages" | "formatRelativeTime"> & { now?: number }) {
  const t = useT();
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    if (providedNow !== undefined) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [providedNow]);
  const now = providedNow ?? clock;
  if (now === null) return null;
  const locale = props.locale ?? getLocale();
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
