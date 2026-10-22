import { describe, expect, it } from "vitest";
import { dailySummaryDue, dailySummarySince } from "./dailySummarySettings";

const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 9, day, hours, minutes).getTime();

const base = { enabled: true, time: "09:00" };

describe("dailySummaryDue", () => {
  it("waits until the chosen time", () => {
    expect(dailySummaryDue({ ...base, now: at(4, 8, 59), lastSentAt: at(3, 9) })).toBe(false);
  });

  it("is due at and after the chosen time", () => {
    expect(dailySummaryDue({ ...base, now: at(4, 9), lastSentAt: at(3, 9) })).toBe(true);
    expect(dailySummaryDue({ ...base, now: at(4, 9, 30), lastSentAt: null })).toBe(true);
  });

  it("is not due again once it went out today", () => {
    expect(dailySummaryDue({ ...base, now: at(4, 15), lastSentAt: at(4, 9, 1) })).toBe(false);
  });

  it("sends when the app opens late the same day", () => {
    expect(dailySummaryDue({ ...base, now: at(4, 18), lastSentAt: at(3, 9) })).toBe(true);
  });

  it("is due again the next day", () => {
    expect(dailySummaryDue({ ...base, now: at(5, 9, 5), lastSentAt: at(4, 9) })).toBe(true);
  });

  it("is never due while off or with an unreadable time", () => {
    expect(dailySummaryDue({ ...base, enabled: false, now: at(4, 12), lastSentAt: null })).toBe(
      false,
    );
    expect(dailySummaryDue({ ...base, time: "soon", now: at(4, 12), lastSentAt: null })).toBe(
      false,
    );
  });
});

describe("dailySummarySince", () => {
  it("starts at the last summary, or a day back on first run", () => {
    expect(dailySummarySince(at(4, 9), at(3, 9))).toBe(at(3, 9));
    expect(dailySummarySince(100_000_000, null)).toBe(100_000_000 - 86_400_000);
  });
});
