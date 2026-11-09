/**
 * "4h active yesterday" for the daily summary headline. The caller reads the minutes from the
 * activity feature (`yesterdayMinutes`, `formatActiveMinutes`) and passes them in, so this file
 * imports nothing from it.
 */
export function withActiveYesterday(
  headline: string,
  yesterdayMinutes: number | null,
  format: (minutes: number) => string,
  label: (formatted: string) => string,
): string {
  if (yesterdayMinutes === null || !(yesterdayMinutes > 0)) return headline;
  return `${headline} · ${label(format(yesterdayMinutes))}`;
}
