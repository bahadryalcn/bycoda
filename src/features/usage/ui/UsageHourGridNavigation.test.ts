import { expect, it } from "vitest";
import { isHourOutside, nextSelectableCell } from "./UsageVisualizations";
import type { UsageWindow } from "../model/usageAnalytics";

// Local-time construction keeps these assertions valid in every time zone and on DST days.
const atHour = (day: Date, hour: number) => {
  const at = new Date(day);
  at.setHours(hour, 0, 0, 0);
  return at.getTime();
};

it("skips disabled hour cells when arrowing past them within the grid", () => {
  const day = new Date(2026, 2, 8);
  const window: UsageWindow = { start: atHour(day, 5), end: atHour(day, 20) };
  const dates = [day.getTime(), new Date(2026, 2, 9).getTime()];
  const isSelectable = (row: number, column: number) =>
    !isHourOutside(dates[column], row, window);
  const size = { rows: 24, columns: dates.length };

  // Hour 0 is outside the window: moving down from an enabled hour 4 must jump to hour 5.
  expect(nextSelectableCell({ row: 4, column: 0 }, 1, 0, size, isSelectable)).toEqual({
    row: 5,
    column: 0,
  });
  // Moving up from hour 5 must skip hours 4..0 and stay on the origin (no selectable cell above).
  expect(nextSelectableCell({ row: 5, column: 0 }, -1, 0, size, isSelectable)).toEqual({
    row: 5,
    column: 0,
  });
  // Moving down from the last enabled hour stays put instead of landing on a disabled cell.
  expect(nextSelectableCell({ row: 19, column: 0 }, 1, 0, size, isSelectable)).toEqual({
    row: 19,
    column: 0,
  });
});

it("moves horizontally to the next selectable day without wrapping rows", () => {
  const day = new Date(2026, 2, 8);
  const window: UsageWindow = { start: atHour(day, 5), end: atHour(day, 20) };
  const dates = [day.getTime(), new Date(2026, 2, 9).getTime()];
  const isSelectable = (row: number, column: number) =>
    !isHourOutside(dates[column], row, window);
  const size = { rows: 24, columns: dates.length };

  expect(nextSelectableCell({ row: 10, column: 0 }, 0, 1, size, isSelectable)).toEqual({
    row: 10,
    column: 1,
  });
  // The last column never wraps to the next row.
  expect(nextSelectableCell({ row: 10, column: 1 }, 0, 1, size, isSelectable)).toEqual({
    row: 10,
    column: 1,
  });
});

it("treats an hour as outside only when it lies entirely outside the window", () => {
  const day = new Date(2026, 2, 8);
  const window: UsageWindow = { start: atHour(day, 5) + 30 * 60_000, end: atHour(day, 20) };

  // Hour 5 is partially inside the window (starts at 05:30), so it stays selectable.
  expect(isHourOutside(day.getTime(), 5, window)).toBe(false);
  expect(isHourOutside(day.getTime(), 4, window)).toBe(true);
  expect(isHourOutside(day.getTime(), 20, window)).toBe(true);
});
