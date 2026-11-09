import { describe, expect, it } from "vitest";
import { formatActiveMinutes, yesterdayMinutes } from "./activityTotals";

describe("activity totals", () => {
  it("formats hours and minutes", () => {
    expect(formatActiveMinutes(0)).toBe("0m");
    expect(formatActiveMinutes(25)).toBe("25m");
    expect(formatActiveMinutes(60)).toBe("1h");
    expect(formatActiveMinutes(220)).toBe("3h 40m");
    expect(formatActiveMinutes(-5)).toBe("0m");
  });

  it("reads yesterday from the seven-day list", () => {
    const base = { today: 0, week: 0, month: 0, year: 0 };
    expect(yesterdayMinutes({ ...base, last7Days: [] })).toBeNull();
    expect(
      yesterdayMinutes({
        ...base,
        last7Days: [
          { date: "2026-11-07", minutes: 240 },
          { date: "2026-11-08", minutes: 10 },
        ],
      }),
    ).toBe(240);
  });
});
