import { describe, expect, it } from "vitest";
import { dateTimeFormat } from "../../i18n";
import { localeWeekStart } from "../../i18n/calendar";
import {
  addDays,
  clampValue,
  dateKey,
  formatEntry,
  formatValue,
  gridDestination,
  hour24,
  minuteOptions,
  orderedRange,
  parseEntry,
  parseLocalDate,
  parseLocalDateTime,
  parseLocalTime,
  parseTimeEntry,
  shiftMonth,
  timeKey,
  toLocalDateTime,
} from "./values";

describe("local picker values", () => {
  it("strictly parses calendar dates, leap days and 24-hour times", () => {
    expect(dateKey(parseLocalDate("2028-02-29")!)).toBe("2028-02-29");
    expect(parseLocalDate("2027-02-29")).toBeNull();
    expect(parseLocalDate("2028-04-31")).toBeNull();
    expect(parseLocalTime("23:59")).toBe(1439);
    for (const time of ["24:00", "12:60", "1:00", "", "-1:00"])
      expect(parseLocalTime(time)).toBeNull();
    expect(timeKey(1439)).toBe("23:59");
    expect(toLocalDateTime(parseLocalDateTime("2028-02-29T23:59")!)).toBe("2028-02-29T23:59");
  });
  it("clamps every native value format, including date-only datetime bounds", () => {
    expect(clampValue("08:00", "time", "09:00", "17:00")).toBe("09:00");
    expect(clampValue("18:00", "time", "09:00", "17:00")).toBe("17:00");
    expect(clampValue("2028-01-01", "date", "2028-02-01")).toBe("2028-02-01");
    expect(clampValue("2028-03-01T10:00", "datetime", undefined, "2028-02-29T09:00")).toBe(
      "2028-02-29T09:00",
    );
    expect(clampValue("2028-01-01T10:00", "datetime", "2028-02-01")).toBe("2028-02-01T00:00");
    expect(clampValue("bad", "date", "2028-01-01")).toBe("bad");
  });
  it("orders reversed range endpoints and clamps month shifts across years", () => {
    const early = new Date(2027, 11, 31, 12);
    const late = new Date(2028, 0, 3, 12);
    expect(orderedRange(late, early)).toEqual({ start: early, end: late });
    expect(dateKey(shiftMonth(early, 1))).toBe("2028-01-31");
    expect(dateKey(shiftMonth(new Date(2028, 0, 31, 12), 1))).toBe("2028-02-29");
    expect(dateKey(shiftMonth(new Date(2028, 0, 31, 12), -1))).toBe("2027-12-31");
  });
  it("uses local calendar arithmetic across DST transitions", () => {
    for (const day of ["2026-03-07", "2026-03-08", "2026-10-31", "2026-11-01"]) {
      const date = parseLocalDate(day)!;
      const next = addDays(date, 1);
      expect(next.getHours()).toBe(12);
      expect(dateKey(addDays(next, -1))).toBe(day);
      expect(toLocalDateTime(parseLocalDateTime(`${day}T12:30`)!)).toBe(`${day}T12:30`);
    }
    // In a DST-observing process, reject a nonexistent local time rather than silently rolling it forward.
    const gap = "2026-03-08T02:30";
    const normalized = new Date(gap);
    expect(parseLocalDateTime(gap)).toEqual(
      toLocalDateTime(normalized) === gap ? normalized : null,
    );
  });

  it.runIf(process.env.TZ === "America/New_York")(
    "crosses a 23-hour day and rejects the spring DST gap",
    () => {
      const before = parseLocalDate("2026-03-07")!;
      const after = addDays(before, 1);
      expect(dateKey(after)).toBe("2026-03-08");
      expect(after.getTime() - before.getTime()).toBe(23 * 60 * 60 * 1000);
      expect(parseLocalDateTime("2026-03-08T02:30")).toBeNull();
    },
  );
  it("navigates weeks by locale and months without selecting", () => {
    const date = new Date(2028, 0, 31, 12);
    expect(dateKey(gridDestination(date, "PageDown", 1)!)).toBe("2028-02-29");
    expect(dateKey(gridDestination(date, "Home", 0)!)).toBe("2028-01-30");
    expect(dateKey(gridDestination(date, "End", 1)!)).toBe("2028-02-06");
    expect(dateKey(gridDestination(date, "ArrowDown", 1)!)).toBe("2028-02-07");
    expect(gridDestination(date, "Escape", 1)).toBeNull();
    expect(localeWeekStart("en-US")).toBe(0);
    expect(localeWeekStart("tr")).toBe(1);
    expect(localeWeekStart("de")).toBe(1);
  });
  it("formats 12/24-hour locales and converts typed day periods without changing storage", () => {
    expect(hour24(12, "am")).toBe(0);
    expect(hour24(12, "pm")).toBe(12);
    expect(parseTimeEntry("1:05 PM")).toBe("13:05");
    expect(parseTimeEntry("12:00 am")).toBe("00:00");
    expect(parseTimeEntry("13:05 PM")).toBeNull();
    const format = (locale: string) => (date: Date, options: Intl.DateTimeFormatOptions) =>
      dateTimeFormat(locale, options).format(date);
    expect(formatValue("13:05", "time", format("en-US"))).toMatch(/1:05.*PM/);
    expect(formatValue("13:05", "time", format("de"))).toBe("13:05");
    expect(formatValue("2028-02-29", "date", format("en-US"))).toBe("Feb 29, 2028");
    expect(minuteOptions(15, 7)).toEqual([0, 7, 15, 30, 45]);
    expect(minuteOptions(0)).toHaveLength(60);
  });
});

describe("typed entry", () => {
  const parts = (locale: string) =>
    dateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
      new Date(2026, 11, 31, 12),
    );

  it("shows and reads the locale's numeric date with a 24-hour time", () => {
    expect(formatEntry("2028-02-05", "date", parts("tr"))).toBe("05.02.2028");
    expect(formatEntry("2028-02-05T18:30", "datetime", parts("en-US"))).toBe("02/05/2028 18:30");
    expect(formatEntry("18:30", "time", parts("tr"))).toBe("18:30");
    expect(parseEntry("5.2.2028", "date", parts("tr"))).toBe("2028-02-05");
    expect(parseEntry("2/5/2028 6:30 pm", "datetime", parts("en-US"))).toBe("2028-02-05T18:30");
    expect(parseEntry("2028/02/05", "date", parts("ja"))).toBe("2028-02-05");
  });

  it("always reads a leading four-digit year as year, month, day", () => {
    expect(parseEntry("2028-02-05", "date", parts("en-US"))).toBe("2028-02-05");
    expect(parseEntry("2028-02-05T18:30", "datetime", parts("tr"))).toBe("2028-02-05T18:30");
  });

  it("rejects short years, missing parts and impossible times", () => {
    expect(parseEntry("5.2.28", "date", parts("tr"))).toBeNull();
    expect(parseEntry("5.2", "date", parts("tr"))).toBeNull();
    expect(parseEntry("5.2.2028", "datetime", parts("tr"))).toBeNull();
    expect(parseEntry("5.2.2028 25:00", "datetime", parts("tr"))).toBeNull();
  });
});
