import { formatDate } from "../../../shared/i18n";

// Sprint dates are calendar days in the owner's zone: YYYY-MM-DD maps to local midnight
// and back, so a day never shifts in zones away from UTC. Older builds stored UTC
// midnight; such a value that is not local midnight is read as its UTC calendar day.
const DAY_MS = 86_400_000;
const isLegacyUtcDay = (value: number) => {
  const date = new Date(value);
  const localMidnight = date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
  return value % DAY_MS === 0 && !localMidnight;
};
export const dateValue = (value?: number) => {
  if (value === undefined) return "";
  if (isLegacyUtcDay(value)) {
    const utc = new Date(value);
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
  }
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
/** The sprint date as text, or the given empty label when the date is unset. */
export const displayDate = (value: number | undefined, empty: string) =>
  value === undefined
    ? empty
    : formatDate(value, {
        dateStyle: "medium",
        ...(isLegacyUtcDay(value) ? { timeZone: "UTC" } : {}),
      });
export const dateNumber = (value: string) => {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!).getTime();
};
