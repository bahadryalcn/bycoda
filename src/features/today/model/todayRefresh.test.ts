import { describe, expect, it } from "vitest";
import { isReadDue, msUntilNextDay, sameLocalDay, TODAY_MIN_GAP_MS } from "./todayRefresh";

const at = (hours: number, minutes = 0, seconds = 0, day = 18) =>
  new Date(2026, 10, day, hours, minutes, seconds).getTime();

describe("isReadDue", () => {
  it("skips a read that is still within the minimum gap on the same day", () => {
    expect(isReadDue(at(10), at(10) + TODAY_MIN_GAP_MS - 1)).toBe(false);
  });

  it("is due once the minimum gap has passed", () => {
    expect(isReadDue(at(10), at(10) + TODAY_MIN_GAP_MS)).toBe(true);
  });

  it("is due right after midnight even though the last read was seconds ago", () => {
    expect(isReadDue(at(23, 59, 55), at(0, 0, 1, 19))).toBe(true);
  });
});

describe("msUntilNextDay", () => {
  it("lands one second after the next local midnight", () => {
    expect(msUntilNextDay(at(23, 59, 0))).toBe(61_000);
    expect(sameLocalDay(at(23, 59, 0), at(23, 59, 0) + msUntilNextDay(at(23, 59, 0)))).toBe(false);
  });

  it("never returns less than a second", () => {
    expect(msUntilNextDay(at(0, 0, 0, 19) - 1)).toBeGreaterThanOrEqual(1_000);
  });
});
