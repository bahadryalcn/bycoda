import { expect, it } from "vitest";
import { RunClock, RUN_CLOCK_PAUSE_GAP_MS, RUN_CLOCK_TICK_MS } from "./run-clock";

it("counts ordinary tick gaps as active time", () => {
  const clock = new RunClock();
  expect(clock.activeMs("r", 1_000, 1_000)).toBe(0);
  expect(clock.activeMs("r", 1_000, 31_000)).toBe(30_000);
  expect(clock.activeMs("r", 1_000, 61_000)).toBe(60_000);
});

it("treats a gap beyond twice the tick as a pause and credits at most one tick", () => {
  const clock = new RunClock();
  clock.activeMs("r", 0, 0);
  clock.activeMs("r", 0, RUN_CLOCK_TICK_MS);
  const slept = RUN_CLOCK_TICK_MS + 3_600_000;
  expect(clock.activeMs("r", 0, slept)).toBe(2 * RUN_CLOCK_TICK_MS);
  expect(RUN_CLOCK_PAUSE_GAP_MS).toBe(2 * RUN_CLOCK_TICK_MS);
});

it("seeds a run first seen late from wall-clock elapsed time and ignores backwards clocks", () => {
  const clock = new RunClock();
  expect(clock.activeMs("late", 1_000, 601_000)).toBe(600_000);
  expect(clock.activeMs("late", 1_000, 500_000)).toBe(600_000);
  clock.forget("late");
  expect(clock.size).toBe(0);
});
