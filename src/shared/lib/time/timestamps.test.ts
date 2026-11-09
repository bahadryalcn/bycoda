import { describe, expect, it } from "vitest";
import {
  elapsedSince,
  isoTimestamp,
  monotonicNow,
  parseTimestamp,
  wallClockGap,
} from "./timestamps";

describe("isoTimestamp", () => {
  it("formats numbers, strings and dates", () => {
    expect(isoTimestamp(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(isoTimestamp("2026-11-03T10:00:00Z")).toBe("2026-11-03T10:00:00.000Z");
    expect(isoTimestamp(new Date(86_400_000))).toBe("1970-01-02T00:00:00.000Z");
  });

  it("returns undefined instead of throwing for invalid input", () => {
    for (const value of [Number.NaN, "not a date", "", null, undefined, new Date("x")]) {
      expect(isoTimestamp(value)).toBeUndefined();
      expect(parseTimestamp(value)).toBeUndefined();
    }
  });
});

describe("monotonic durations", () => {
  it("measures forward only", () => {
    const start = monotonicNow();
    expect(elapsedSince(start, start - 5)).toBe(0);
    expect(elapsedSince(start, start + 250)).toBeCloseTo(250, 6);
  });

  it("reports the gap beyond a tick interval", () => {
    expect(wallClockGap(1_000, 1_030, 30)).toBe(0);
    expect(wallClockGap(1_000, 3_600_000, 30_000)).toBe(3_569_000);
  });
});
