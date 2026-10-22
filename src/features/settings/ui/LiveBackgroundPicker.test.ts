import { describe, expect, it } from "vitest";
import { LIVE_BACKGROUNDS } from "../model/liveBackground";
import { liveBackgroundKeyTarget, stepLiveBackground } from "./LiveBackgroundPicker";

describe("liveBackgroundKeyTarget", () => {
  const count = 4;

  it("moves forward and backward with arrow keys and wraps at the ends", () => {
    expect(liveBackgroundKeyTarget("ArrowRight", 1, count)).toBe(2);
    expect(liveBackgroundKeyTarget("ArrowDown", 3, count)).toBe(0);
    expect(liveBackgroundKeyTarget("ArrowLeft", 2, count)).toBe(1);
    expect(liveBackgroundKeyTarget("ArrowUp", 0, count)).toBe(3);
  });

  it("jumps to the first and last tile with Home and End", () => {
    expect(liveBackgroundKeyTarget("Home", 2, count)).toBe(0);
    expect(liveBackgroundKeyTarget("End", 1, count)).toBe(3);
  });

  it("ignores keys that are not radio navigation keys", () => {
    expect(liveBackgroundKeyTarget("Enter", 1, count)).toBeNull();
    expect(liveBackgroundKeyTarget("a", 1, count)).toBeNull();
  });
});

describe("stepLiveBackground", () => {
  const last = LIVE_BACKGROUNDS[LIVE_BACKGROUNDS.length - 1]!;
  const first = LIVE_BACKGROUNDS[0]!;

  it("cycles through every option, including none, in list order", () => {
    expect(stepLiveBackground(first, 1)).toBe(LIVE_BACKGROUNDS[1]);
    expect(stepLiveBackground(LIVE_BACKGROUNDS[1]!, -1)).toBe(first);
  });

  it("wraps from the last option to the first and back", () => {
    expect(stepLiveBackground(last, 1)).toBe(first);
    expect(stepLiveBackground(first, -1)).toBe(last);
  });
});
