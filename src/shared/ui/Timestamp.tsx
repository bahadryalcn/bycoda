import { type ComponentProps } from "react";
import { useLocale, useT } from "../i18n";
import { formatRelativeTime } from "../i18n/format";
import { dateTimeFormat } from "../lib/intl";
import { useToday } from "./arc/lib/use-today";

export type TimestampFormat =
  | "auto"
  | "relative"
  | "time"
  | "time-seconds"
  | "date"
  | "datetime-seconds";

/**
 * Semantic `<time>` with a locale-formatted label and tabular digits. `auto` reads "Today 14:05" /
 * "Yesterday 09:30" or a full date and follows midnight, focus and resume through the shared day clock;
 * `relative` ("5 minutes ago"), `time` (clock), `time-seconds` (24-hour log clock), `date` (no year in
 * the current year) and `datetime-seconds` are computed on render. The full date is the title by default.
 * @group text
 * @use Show a past or scheduled point in time (last run, created, updated) as a date, clock or age.
 * @avoid Event history list: Timeline. Durations or numbers: format with src/shared/i18n helpers.
 * @replaces time
 */
export function Timestamp({
  value,
  format = "auto",
  prefix,
  relativeStyle,
  tooltip,
  className,
  ...props
}: Omit<ComponentProps<"time">, "dateTime" | "children"> & {
  value: number;
  format?: TimestampFormat;
  /** Visible label before the time ("Created", "Updated"); also leads the title. */
  prefix?: string;
  /** Width of relative text: "3 minutes ago" / "3 min. ago" / "3m ago". */
  relativeStyle?: Intl.RelativeTimeFormatStyle;
  /** Show the full date as the title. Default true, except for `auto` (only when it reads Today/Yesterday). */
  tooltip?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const today = useToday();
  if (!Number.isFinite(value)) return null;
  const date = new Date(value);
  const yesterday = today ? new Date(today) : undefined;
  yesterday?.setDate(yesterday.getDate() - 1);
  const sameDay = (other: Date | undefined) =>
    other != null &&
    date.getFullYear() === other.getFullYear() &&
    date.getMonth() === other.getMonth() &&
    date.getDate() === other.getDate();
  const day =
    format === "auto"
      ? sameDay(today)
        ? t("Today")
        : sameDay(yesterday)
          ? t("Yesterday")
          : undefined
      : undefined;
  const showTitle = tooltip ?? (format === "auto" ? day != null : true);
  // The full date is only needed for the title and the auto format's older-date label.
  const full =
    showTitle || (format === "auto" && !day)
      ? dateTimeFormat(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(date)
      : "";
  const clock = dateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
  const text =
    format === "auto"
      ? day
        ? `${day} ${clock}`
        : full
      : format === "relative"
        ? formatRelativeTime(date, { locale, style: relativeStyle })
        : format === "time"
          ? clock
          : format === "time-seconds"
            ? dateTimeFormat(locale, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hourCycle: "h23",
              }).format(date)
            : format === "date"
              ? dateTimeFormat(locale, {
                  month: "short",
                  day: "numeric",
                  year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
                }).format(date)
              : dateTimeFormat(locale, {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                  second: "numeric",
                }).format(date);
  return (
    <time
      title={showTitle ? (prefix ? `${prefix}: ${full}` : full) : undefined}
      {...props}
      className={className ? `tabular-nums ${className}` : "tabular-nums"}
      dateTime={date.toISOString()}
    >
      {prefix ? `${prefix} ${text}` : text}
    </time>
  );
}
