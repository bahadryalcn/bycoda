import { describe, expect, it, vi } from "vitest";
import { GESTURE_SECONDS, createPacingRoute, drawPacingUncle, pacingPose } from "./pacingUncleArt";
import { facing } from "./pacingSprite";

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
  it("stops every fourth leg to face the reader, then turns back", () => {
    const span = 44;
    const gestures: number[] = [];
    let previous = false;
    for (let t = 0; t < 200; t += 0.05) {
      const pose = pacingPose(t, span);
      const acting = pose.act !== undefined;
      if (acting && !previous) gestures.push(t);
      if (acting) expect(pose.walk).toBe(false);
      previous = acting;
    }
    expect(gestures.length).toBeGreaterThanOrEqual(3);
    const start = gestures[0] + 0.05;
    expect(facing(pacingPose(start, span)).front).toBe(false);
    expect(facing(pacingPose(start + GESTURE_SECONDS / 2, span))).toMatchObject({
      front: true,
      sx: 1,
    });
  });
  it("draws each crew theme's walker through a whole gesture", () => {
    const ctx = new Proxy(
      {},
      { get: (target: Record<string, unknown>, key: string) => (target[key] ??= vi.fn()) },
    ) as unknown as CanvasRenderingContext2D;
    vi.stubGlobal(
      "Path2D",
      class {
        rect() {}
      },
    );
    for (const theme of ["classic", "lotr", "star-wars"] as const)
      for (let t = 0; t < 40; t += 0.2) drawPacingUncle(ctx, 80, 32, t, theme);
    expect(ctx.fillRect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("leaves the canvas untouched while the frame does not change", () => {
    const target: Record<string, unknown> = {};
    const ctx = new Proxy(target, {
      get: (_, key: string) => (key in target ? target[key] : (target[key] = vi.fn())),
    }) as unknown as CanvasRenderingContext2D;
    target.imageSmoothingEnabled = true;
    const pause = [...Array(400).keys()]
      .map((i) => i / 12)
      .find((t) => {
        const a = pacingPose(t, 44);
        const b = pacingPose(t + 1 / 12, 44);
        return !a.walk && !b.walk && a.act === undefined && b.act === undefined && a.dir === b.dir;
      })!;
    drawPacingUncle(ctx, 80, 32, pause, "lotr");
    drawPacingUncle(ctx, 80, 32, pause + 1 / 12, "lotr");
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    // A resized canvas comes back with smoothing on and is painted again.
    target.imageSmoothingEnabled = true;
    drawPacingUncle(ctx, 80, 32, pause + 1 / 12, "lotr");
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
  });
});
