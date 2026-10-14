import { describe, expect, it } from "vitest";
import {
  inPublishingWindow,
  nextPublishingRun,
  nextPublishingWindow,
  parsePublishingSchedule,
} from "./social-schedule";

const schedule = (overrides: Record<string, unknown> = {}) =>
  parsePublishingSchedule({
    timeZone: "Europe/Istanbul",
    startTime: "09:00",
    endTime: "18:00",
    minIntervalMinutes: 120,
    maxIntervalMinutes: 300,
    ...overrides,
  });
describe("durable social publishing schedule", () => {
  it("rejects invalid timezone, window, intervals and protected fields", () => {
    for (const invalid of [
      { timeZone: "Invalid/Zone" },
      { startTime: "9:00" },
      { endTime: "24:00" },
      { minIntervalMinutes: 0 },
      { minIntervalMinutes: 301 },
      { maxIntervalMinutes: 2.5 },
      { enabled: true },
    ])
      expect(() => schedule(invalid)).toThrow();
  });
  it("uses the selected timezone and treats window end as exclusive", () => {
    const plan = schedule();
    expect(inPublishingWindow(plan, Date.parse("2026-10-12T06:00:00Z"))).toBe(true);
    expect(inPublishingWindow(plan, Date.parse("2026-10-12T15:00:00Z"))).toBe(false);
    expect(nextPublishingWindow(plan, Date.parse("2026-10-12T17:00:00Z"))).toBe(
      Date.parse("2026-10-13T06:00:00Z"),
    );
  });
  it("supports overnight and all-day windows", () => {
    const overnight = schedule({ startTime: "23:00", endTime: "03:00" });
    expect(inPublishingWindow(overnight, Date.parse("2026-10-12T21:00:00Z"))).toBe(true);
    expect(inPublishingWindow(overnight, Date.parse("2026-10-13T00:00:00Z"))).toBe(false);
    expect(nextPublishingWindow(overnight, Date.parse("2026-10-13T04:00:00Z"))).toBe(
      Date.parse("2026-10-13T20:00:00Z"),
    );
    const at = Date.parse("2026-10-12T04:17:12.321Z");
    expect(nextPublishingWindow(schedule({ startTime: "00:00", endTime: "00:00" }), at)).toBe(at);
  });
  it("walks real UTC minutes through DST gaps and folds", () => {
    const spring = schedule({ timeZone: "America/New_York", startTime: "02:30", endTime: "03:30" });
    expect(nextPublishingWindow(spring, Date.parse("2026-03-08T06:50:00Z"))).toBe(
      Date.parse("2026-03-08T07:00:00Z"),
    );
    const autumn = schedule({ timeZone: "America/New_York", startTime: "01:30", endTime: "01:45" });
    expect(nextPublishingWindow(autumn, Date.parse("2026-11-01T05:46:00Z"))).toBe(
      Date.parse("2026-11-01T06:30:00Z"),
    );
  });
  it("keeps jitter deterministic and respects minimum/maximum within an open window", () => {
    const plan = schedule({ startTime: "00:00", endTime: "00:00" });
    const previous = Date.parse("2026-10-12T09:00:00Z");
    const next = nextPublishingRun(plan, previous, "plan-id", 1);
    expect(nextPublishingRun(plan, previous, "plan-id", 1)).toBe(next);
    expect(next - previous).toBeGreaterThanOrEqual(120 * 60_000);
    expect(next - previous).toBeLessThanOrEqual(300 * 60_000);
  });
  it("quiet hours extend the interval and never permit a catch-up burst", () => {
    const plan = schedule({ minIntervalMinutes: 120, maxIntervalMinutes: 120 });
    const previous = Date.parse("2026-10-12T14:30:00Z");
    expect(nextPublishingRun(plan, previous, "plan-id", 1)).toBe(
      Date.parse("2026-10-13T06:00:00Z"),
    );
  });
});
