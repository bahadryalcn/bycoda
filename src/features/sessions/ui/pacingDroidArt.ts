import { themePalette } from "../../../shared/theme/palette";
import {
  facing,
  fillRects,
  limb,
  placeSprite,
  rimRects,
  shift,
  type PacingLook,
  type PacingPose,
  type Rect,
} from "./pacingSprite";

/** A gold protocol droid for the Star Wars crew; it shuffles stiffly and stops to wave. */
const D = {
  goldDeep: themePalette.hex9c6300,
  gold: themePalette.hexd19a2f,
  goldLit: themePalette.hexf4b942,
  goldPale: themePalette.hexfde68a,
  joint: themePalette.hex42474b,
  silver: themePalette.hexb0b8c4,
  silverShade: themePalette.hex7e8795,
  wireRed: themePalette.hexe45649,
  wireBlue: themePalette.hex4078f2,
  eye: themePalette.hexffe08a,
  eyeDim: themePalette.hexf59e0b,
};

/** Facing right on the 24 x 32 grid with stiff knees and short, shuffling steps. */
function side(step: number, walk: boolean, blink: boolean) {
  const bob = walk ? (1 - Math.abs(step)) * 0.4 : 0;
  const reach = walk ? step * 1.8 : 0;
  const legs: Rect[] = [];
  const leg = (hip: number, offset: number, thigh: string, shin: string) => {
    const lift = walk && offset * step > 0 && Math.abs(step) < 0.85 ? 0.8 : 0;
    legs.push(
      [hip + offset / 2, 23.5, 3, 3.5, thigh],
      [hip + offset * 0.75, 26.8, 3, 0.8, D.joint],
      [hip + offset, 27.5, 3, 2.5 - lift, shin],
      [hip + offset, 30 - lift, 4, 2, D.goldDeep],
    );
  };
  leg(9.5, -reach, D.goldDeep, D.goldDeep);
  leg(12, reach, D.gold, D.silver);
  const eye = blink ? D.eyeDim : D.eye;
  const body = shift(
    [
      [9.5, 3, 6.5, 6.5, D.gold],
      [9.5, 3, 6.5, 1.2, D.goldLit],
      [9.5, 3, 1.5, 6.5, D.goldDeep],
      [11, 5.5, 2, 2, D.goldDeep],
      [13, 5.2, 3.5, 0.8, D.goldDeep],
      [14.3, 6, 1.6, 1.4, eye],
      [15, 8, 1, 0.6, D.joint],
      [11.2, 9.5, 3, 2, D.joint],
      [8.5, 11.5, 8.5, 7.5, D.gold],
      [8.5, 11.5, 2, 7.5, D.goldDeep],
      [13.5, 12.5, 3, 1, D.goldLit],
      [14.5, 15, 1.5, 1.5, D.goldPale],
      [9.5, 19, 6.5, 2.5, D.joint],
      [11, 19.5, 1, 1.5, D.wireRed],
      [13, 19.5, 1, 1.5, D.wireBlue],
      [9, 21.5, 7.5, 2.5, D.gold],
      [9, 21.5, 1.5, 2.5, D.goldDeep],
    ],
    0,
    -bob,
  );
  const swing = walk ? step : 0;
  const arm = shift(
    [
      [10.5, 12, 2.8, 5.5, D.gold],
      [10.8 + swing * 0.5, 17.5, 2.4, 0.8, D.joint],
      [10.8 + swing, 18.3, 2.5, 3.5, D.gold],
      [11 + swing, 21.8, 2.2, 1.5, D.goldDeep],
    ],
    0,
    -bob,
  );
  return { legs, body, arm };
}

/** Facing the reader: the head tilts, the eyes brighten and the right hand waves. */
function front(beat: number, look: PacingLook) {
  const raise = Math.min(1, 3 * Math.sin(beat * Math.PI));
  const tilt = Math.sin(beat * Math.PI) * 0.8;
  const eye = look.blink ? D.eyeDim : D.eye;
  const body: Rect[] = [
    [9, 23.5, 2.8, 3.5, D.goldDeep],
    [9, 26.8, 2.8, 0.8, D.joint],
    [9, 27.5, 2.8, 2.5, D.goldDeep],
    [12.2, 23.5, 2.8, 3.5, D.gold],
    [12.2, 26.8, 2.8, 0.8, D.joint],
    [12.2, 27.5, 2.8, 2.5, D.silver],
    [12.2, 27.5, 0.8, 2.5, D.silverShade],
    [8.2, 30, 3.8, 2, D.goldDeep],
    [12, 30, 3.8, 2, D.goldDeep],
    [10.5, 9.5, 3, 2, D.joint],
    [7.5, 11.5, 9, 7.5, D.gold],
    [7.5, 11.5, 1.5, 7.5, D.goldDeep],
    [15, 11.5, 1.5, 7.5, D.goldDeep],
    [10, 12.5, 4, 1, D.goldLit],
    [11.25, 15, 1.5, 1.5, D.goldPale],
    [8.5, 19, 7, 2.5, D.joint],
    [10, 19.5, 1, 1.5, D.wireRed],
    [13, 19.5, 1, 1.5, D.wireBlue],
    [8, 21.5, 8, 2.5, D.gold],
    ...shift(
      [
        [8.75, 3, 6.5, 6.5, D.gold],
        [8.75, 3, 6.5, 1.2, D.goldLit],
        [8.75, 5.2, 6.5, 0.8, D.goldDeep],
        [9.8, 6, 1.5, 1.4, eye],
        [12.7, 6, 1.5, 1.4, eye],
        [11.5, 8, 1, 0.6, D.joint],
      ],
      tilt,
      0,
    ),
  ];
  const arms: Rect[] = [
    [5.5, 12, 2, 5.5, D.gold],
    [5.5, 17.5, 2, 0.8, D.joint],
    [5.5, 18.3, 2, 3.5, D.gold],
    [5.6, 21.8, 1.8, 1.5, D.goldDeep],
  ];
  // Upper arm lifts outward, then the forearm swings side to side from the elbow.
  const shoulder = Math.PI / 2 - raise * ((Math.PI * 5) / 8);
  const upper = limb(17.3, 12.8, shoulder, 3.5, 2.2, D.gold);
  const wave = Math.sin(look.gesture * 9) * 0.5 * raise;
  const forearm = limb(upper.x, upper.y, Math.PI / 2 - raise * Math.PI + wave, 3.8, 2, D.gold);
  arms.push(...upper.rects, [upper.x - 1, upper.y - 0.5, 2, 1, D.joint], ...forearm.rects);
  arms.push([forearm.x - 1.2, forearm.y - 1.2, 2.4, 2.4, D.goldDeep]);
  return { body, arms };
}

export function drawPacingDroid(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  scale: number,
  p: PacingPose,
  look: PacingLook,
) {
  const face = facing(p);
  ctx.save();
  placeSprite(ctx, x, baseline, scale, face.sx);
  if (face.front) {
    const { body, arms } = front(face.beat, look);
    rimRects(ctx, [...body, ...arms]);
    fillRects(ctx, body);
    rimRects(ctx, arms, 0.5);
    fillRects(ctx, arms);
  } else {
    const { legs, body, arm } = side(p.walk ? Math.sin(p.phase) : 0, p.walk, look.blink);
    rimRects(ctx, [...legs, ...body, ...arm]);
    fillRects(ctx, legs);
    fillRects(ctx, body);
    rimRects(ctx, arm, 0.5);
    fillRects(ctx, arm);
  }
  ctx.restore();
}
