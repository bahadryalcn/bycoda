import { type ComponentProps } from "react";
import { t, useLocale } from "../i18n";
import { dateTimeFormat } from "../lib/intl";
import { useToday } from "./arc/lib/use-today";

/** Local calendar labels follow midnight, focus and resume through the shared day clock. */
export function Timestamp({
  value,
  ...props
}: Omit<ComponentProps<"time">, "dateTime" | "children"> & { value: number }) {
  const locale = useLocale();
  const today = useToday();
  const date = new Date(value);
  const yesterday = today ? new Date(today) : undefined;
  yesterday?.setDate(yesterday.getDate() - 1);
  const sameDay = (other: Date | undefined) =>
    other != null &&
    date.getFullYear() === other.getFullYear() &&
    date.getMonth() === other.getMonth() &&
    date.getDate() === other.getDate();
  const full = dateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const label = sameDay(today) ? t("Today") : sameDay(yesterday) ? t("Yesterday") : undefined;
  const clock = dateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
  return (
    <time title={full} {...props} dateTime={date.toISOString()}>
      {label ? `${label} ${clock}` : full}
    </time>
  );
}
