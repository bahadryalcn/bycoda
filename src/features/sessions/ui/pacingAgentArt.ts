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

/** A suited Agent for the Matrix crew; it strides stiffly and stops to listen to its earpiece. */
const A = {
  suit: themePalette.hex1d2428,
  suitDeep: themePalette.hex10151a,
  suitLit: themePalette.hex2e2e2e,
  shirt: themePalette.hexe8eef2,
  tie: themePalette.hex171717,
  skin: themePalette.hexf5e6d3,
  skinShade: themePalette.hexd6a77a,
  hair: themePalette.hex2a211b,
  glint: themePalette.hex7ee787,
  wire: themePalette.hexb0b8c4,
};

/** Facing right on the 24 x 32 grid; long, even strides with the arms barely swinging. */
function side(step: number, walk: boolean, blink: boolean) {
  const bob = walk ? (1 - Math.abs(step)) * 0.5 : 0;
  const reach = walk ? step * 2.4 : 0;
  const legs: Rect[] = [];
  const leg = (hip: number, offset: number, color: string) => {
    const lift = walk && offset * step > 0 && Math.abs(step) < 0.85 ? 0.8 : 0;
    legs.push(
      [hip + offset / 2, 23, 3, 4, color],
      [hip + offset, 27, 3, 3 - lift, color],
      [hip + offset, 30 - lift, 4.5, 2, A.tie],
    );
  };
  leg(9.5, -reach, A.suitDeep);
  leg(12, reach, A.suit);
  const body = shift(
    [
      [9.5, 10, 7.5, 13, A.suit],
      [9.5, 10, 1.5, 13, A.suitDeep],
      [14, 10, 2, 6, A.shirt],
      [14.5, 11, 1, 5, A.tie],
      [11.5, 8.5, 3, 2, A.skin],
      [9, 2.5, 7.5, 7, A.skin],
      [9, 2.5, 7.5, 2.2, A.hair],
      [9, 2.5, 1.5, 5, A.hair],
      [13, 5, 4, 1.6, A.suitDeep],
      [15, 5.4, 1.6, 0.6, blink ? A.suitDeep : A.glint],
      [10.2, 6.2, 0.8, 1.2, A.wire],
      [10.5, 7.4, 0.5, 2.4, A.wire],
      [16.5, 7, 0.8, 1.5, A.skinShade],
    ],
    0,
    -bob,
  );
  const swing = walk ? step * 0.7 : 0;
  const arm = shift(
    [
      [11, 11, 2.8, 5.5, A.suitLit],
      [11.2 + swing, 16.5, 2.5, 4, A.suitLit],
      [11.4 + swing, 20.5, 2.2, 1, A.shirt],
      [11.4 + swing, 21.5, 2.2, 1.8, A.skin],
    ],
    0,
    -bob,
  );
  return { legs, body, arm };
}

/** Facing the reader: a hand rises to the earpiece, the head tilts and the lenses glint. */
function front(beat: number, look: PacingLook) {
  const raise = Math.min(1, 3 * Math.sin(beat * Math.PI));
  const tilt = Math.sin(beat * Math.PI) * 0.6;
  const glint = look.blink ? A.suitDeep : A.glint;
  const body: Rect[] = [
    [9, 23, 2.8, 4, A.suitDeep],
    [9, 27, 2.8, 3, A.suitDeep],
    [12.2, 23, 2.8, 4, A.suit],
    [12.2, 27, 2.8, 3, A.suit],
    [8.2, 30, 3.8, 2, A.tie],
    [12, 30, 3.8, 2, A.tie],
    [10.5, 8.5, 3, 2, A.skin],
    [7.5, 10, 9, 13, A.suit],
    [7.5, 10, 1.5, 13, A.suitDeep],
    [15, 10, 1.5, 13, A.suitDeep],
    [10.5, 10, 3, 6, A.shirt],
    [11.5, 10.5, 1, 7, A.tie],
    ...shift(
      [
        [8.25, 2.5, 7.5, 7, A.skin],
        [8.25, 2.5, 7.5, 2.2, A.hair],
        [8.25, 5, 3, 1.6, A.suitDeep],
        [12.75, 5, 3, 1.6, A.suitDeep],
        [8.8, 5.4, 1.6, 0.6, glint],
        [13.3, 5.4, 1.6, 0.6, glint],
        [15.75, 5.5, 0.6, 1.2, A.wire],
        [15.9, 6.7, 0.5, 3, A.wire],
      ],
      tilt,
      0,
    ),
  ];
  const arms: Rect[] = [
    [5.5, 11, 2, 5.5, A.suitLit],
    [5.5, 16.5, 2, 4, A.suitLit],
    [5.5, 20.5, 2, 1, A.shirt],
    [5.6, 21.5, 1.8, 1.8, A.skin],
  ];
  // The right arm folds up until the fingers touch the earpiece.
  const shoulder = Math.PI / 2 - raise * (Math.PI / 3);
  const upper = limb(17.3, 11.5, shoulder, 4.5, 2.2, A.suitLit);
  const forearm = limb(upper.x, upper.y, Math.PI / 2 - raise * (Math.PI * 1.1), 4.5, 2, A.suitLit);
  arms.push(...upper.rects, ...forearm.rects);
  arms.push([forearm.x - 1, forearm.y - 1, 2, 2, A.skin]);
  return { body, arms };
}

export function drawPacingAgent(
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
