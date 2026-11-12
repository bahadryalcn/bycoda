import { dateTimeFormat, useLocale } from "./index";

/** Calendar formatting bound to a React locale subscription, including date-part labels. */
export function useCalendarFormat() {
  const locale = useLocale();
  return {
    weekStart: localeWeekStart(locale),
    date: (date: Date, options: Intl.DateTimeFormatOptions) =>
      dateTimeFormat(locale, options).format(date),
    parts: (date: Date, options: Intl.DateTimeFormatOptions) =>
      dateTimeFormat(locale, options).formatToParts(date),
  };
}

/** Unicode locale week data; older webviews fall back to the locale's likely region. */
export function localeWeekStart(language: string): number {
  const locale = new Intl.Locale(language).maximize();
  const info = locale as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number };
    weekInfo?: { firstDay: number };
  };
  const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
  if (first !== undefined) return first % 7;
  if (["US", "CA", "BR", "JP", "TW", "HK", "PH"].includes(locale.region ?? "")) return 0;
  return 1;
}
