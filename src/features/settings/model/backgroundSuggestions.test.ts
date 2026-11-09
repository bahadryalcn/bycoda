import { expect, it } from "vitest";
import { LIVE_BACKGROUNDS } from "./liveBackground";
import { WORKSPACE_BACKGROUND_PRESETS } from "./workspaceBackground";
import {
  BACKGROUND_RANDOM_VISIBILITY_MAX,
  BACKGROUND_RANDOM_VISIBILITY_MIN,
  randomBackgroundCombination,
  sanitizeBackgroundGradient,
} from "./backgroundSuggestions";

it("picks a live scene, a gradient preset and visibility inside 20-70%", () => {
  const low = randomBackgroundCombination(() => 0);
  expect(low.scene).toBe(LIVE_BACKGROUNDS[1]);
  expect(low.intensity).toBe(BACKGROUND_RANDOM_VISIBILITY_MIN);
  expect(low.gradient).toEqual({ ...WORKSPACE_BACKGROUND_PRESETS[0]!.value, enabled: true });

  const high = randomBackgroundCombination(() => 0.999999);
  expect(high.scene).toBe(LIVE_BACKGROUNDS[LIVE_BACKGROUNDS.length - 1]);
  expect(high.intensity).toBeLessThanOrEqual(BACKGROUND_RANDOM_VISIBILITY_MAX);
  expect(high.intensity).toBeGreaterThanOrEqual(0.69);
});

it("never returns the none scene and clamps out-of-range random values", () => {
  for (const value of [-5, 0.5, 2]) {
    const combination = randomBackgroundCombination(() => value);
    expect(combination.scene).not.toBe("none");
    expect(combination.intensity).toBeGreaterThanOrEqual(BACKGROUND_RANDOM_VISIBILITY_MIN);
    expect(combination.intensity).toBeLessThanOrEqual(BACKGROUND_RANDOM_VISIBILITY_MAX);
  }
});

it("drops invalid stops and pads two valid colors to three", () => {
  expect(
    sanitizeBackgroundGradient({
      name: "  Dawn  ",
      stops: ["#FFAA00", "nope", "#00ff00"],
      angle: 400,
      type: "radial",
    }),
  ).toEqual({
    name: "Dawn",
    stops: ["#ffaa00", "#00ff00", "#00ff00"],
    angle: 360,
    type: "radial",
  });
});

it("rejects gradients with fewer than two usable colors and falls back on bad fields", () => {
  expect(sanitizeBackgroundGradient({ stops: ["#123456"] })).toBeNull();
  expect(sanitizeBackgroundGradient(null)).toBeNull();
  expect(sanitizeBackgroundGradient("text")).toBeNull();
  const fallback = sanitizeBackgroundGradient({
    stops: ["#123456", "#abcdef", "#000000"],
    angle: Number.NaN,
    type: "wave",
  });
  expect(fallback).toMatchObject({ angle: 135, type: "linear", name: "" });
});
