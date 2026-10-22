import { describe, expect, it } from "vitest";
import { pacingPose, createPacingRoute } from "./pacingUncleArt";

describe("pacing uncle", () => {
  it("takes 20 steps right, 10 left, then 5 right and turns without sliding", () => {
    const legs = createPacingRoute(844);
    expect(legs.slice(0, 3).map((leg) => [leg.steps, leg.dir])).toEqual([
      [20, 1],
      [10, -1],
      [5, 1],
    ]);
    expect(pacingPose(3.4, 844).x).toBeCloseTo(160 / 844);
    expect(pacingPose(6.9, 844)).toMatchObject({
      x: 320 / 844,
      dir: 1,
      walk: false,
    });
    expect(pacingPose(7.2, 844)).toMatchObject({ x: 320 / 844, walk: false });
    expect(pacingPose(9.08, 844).x).toBeCloseTo(240 / 844);
    expect(pacingPose(9.08, 844).dir).toBe(-1);
  });
  it("reaches both ends of narrow and wide bars without escaping or teleporting", () => {
    for (const span of [240, 844, 1364]) {
      let min = 1,
        max = 0,
        previous = pacingPose(0, span).x;
      for (let t = 0; t < 300; t += 0.05) {
        const pose = pacingPose(t, span);
        expect(pose.x).toBeGreaterThanOrEqual(0);
        expect(pose.x).toBeLessThanOrEqual(1);
        expect(Math.abs(pose.dir)).toBeLessThanOrEqual(1);
        expect(Math.abs(pose.x - previous)).toBeLessThanOrEqual(
          ((16 / span) * 0.05) / 0.34 + 0.00001,
        );
        min = Math.min(min, pose.x);
        max = Math.max(max, pose.x);
        previous = pose.x;
      }
      expect(min).toBe(0);
      expect(max).toBe(1);
    }
  });
  it("returns to the starting edge and handles a collapsed layout", () => {
    const route = createPacingRoute(844);
    expect(route.at(-1)?.to).toBe(0);
    expect(pacingPose(50, 0)).toMatchObject({ x: 0, walk: false });
  });
});
