import { describe, expect, it } from "vitest";
import { pollFailureDelayMs } from "./social-polling";

describe("pollFailureDelayMs", () => {
  it("doubles from one minute and stops at one hour", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(pollFailureDelayMs)).toEqual([
      60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000,
    ]);
    expect(pollFailureDelayMs(10_000)).toBe(3_600_000);
  });
});
