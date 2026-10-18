import { describe, expect, it, vi } from "vitest";
import { nextAutomationRunAt, type AutomationSchedule } from "./automationSchedule";

function inTimezone(zone: string, run: () => void) {
  const original = process.env.TZ;
  process.env.TZ = zone;
  try {
    run();
  } finally {
    vi.useRealTimers();
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

const schedule: AutomationSchedule = {
  scheduleKind: "daily",
  minute: 30,
  time: "02:30",
  dayOfWeek: 1,
};

describe("automation daylight-saving schedules", () => {
  it("restores a weekly time one week after the missing occurrence", () => {
    inTimezone("America/New_York", () => {
      expect(
        nextAutomationRunAt(
          { ...schedule, scheduleKind: "weekly", dayOfWeek: 0 },
          Date.parse("2026-03-08T08:00:00Z"),
        ),
      ).toBe(Date.parse("2026-03-15T06:30:00Z"));
    });
  });

  it("never repeats the occurrence equal to after or loops on invalid instants", () => {
    inTimezone("UTC", () => {
      expect(
        nextAutomationRunAt(
          { ...schedule, scheduleKind: "hourly" },
          Date.parse("2026-03-08T02:30:00Z"),
        ),
      ).toBe(Date.parse("2026-03-08T03:30:00Z"));
      expect(nextAutomationRunAt(schedule, NaN)).toBeNaN();
      expect(nextAutomationRunAt({ ...schedule, scheduleKind: "hourly" }, Infinity)).toBeNaN();
    });
  });
  it.each(["daily", "weekdays", "weekly"] as const)(
    "restores the configured wall time after the spring gap for %s",
    (scheduleKind) => {
      inTimezone("America/New_York", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-08T08:00:00Z"));
        expect(nextAutomationRunAt({ ...schedule, scheduleKind })).toBe(
          Date.parse("2026-03-09T06:30:00Z"),
        );
      });
    },
  );

  it.each([
    ["America/New_York", "2026-11-01T05:40:00Z", "2026-11-01T06:30:00Z"],
    ["Australia/Lord_Howe", "2026-04-04T14:40:00Z", "2026-04-04T15:00:00Z"],
    ["America/New_York", "2026-03-08T06:40:00Z", "2026-03-08T07:30:00Z"],
  ])("uses the next actual hourly occurrence in %s", (zone, after, expected) => {
    inTimezone(zone, () => {
      expect(nextAutomationRunAt({ ...schedule, scheduleKind: "hourly" }, Date.parse(after))).toBe(
        Date.parse(expected),
      );
    });
  });

  it.each([
    ["America/New_York", 2026, 2, 8, 23],
    ["America/New_York", 2026, 10, 1, 25],
    ["Australia/Lord_Howe", 2026, 9, 4, 23.5],
    ["Australia/Lord_Howe", 2026, 3, 5, 24.5],
  ] as const)(
    "keeps daily wall times across %s %s/%s/%s (%s hours)",
    (zone, year, month, day, hours) => {
      inTimezone(zone, () => {
        const before = new Date(year, month, day - 1, 12).getTime();
        const next = nextAutomationRunAt({ ...schedule, time: "12:00" }, before);
        expect(next - before).toBe(hours * 3_600_000);
        expect(new Date(next).getHours()).toBe(12);
        expect(new Date(next).getMinutes()).toBe(0);
      });
    },
  );
});
