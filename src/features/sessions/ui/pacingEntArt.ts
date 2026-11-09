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

/** A slow, mossy Ent for the Lord of the Rings crew; it stops to stretch its branches. */
const E = {
  barkDeep: themePalette.hex29231f,
  barkDark: themePalette.hex49372b,
  bark: themePalette.hex69503a,
  barkLit: themePalette.hex85654a,
  root: themePalette.hex3e3730,
  moss: themePalette.hex75806b,
  mossDark: themePalette.hex536044,
  leafDark: themePalette.hex536044,
  leaf: themePalette.hex657150,
  leafLit: themePalette.hexb5d984,
  eye: themePalette.hexf4b942,
};

/** Facing right on the 24 x 32 grid, crown at the top edge, root-feet on y = 32. */
function side(step: number, walk: boolean) {
  const bob = walk ? (1 - Math.abs(step)) * 0.6 : 0;
  const reach = walk ? step * 2.5 : 0;
  const legs: Rect[] = [];
  const leg = (hip: number, offset: number, color: string) => {
    const lift = walk && offset * step > 0 && Math.abs(step) < 0.85 ? 1 : 0;
    legs.push(
      [hip + offset / 2, 24, 3.5, 4, color],
      [hip + offset, 27.5, 3.5, 3 - lift, color],
      [hip + offset - 1, 30 - lift, 5.5, 2, E.root],
    );
  };
  leg(9, -reach, E.barkDark);
  leg(12, reach, E.bark);
  const body = shift(
    [
      [8, 11, 8.5, 14, E.bark],
      [8, 11, 2, 14, E.barkDark],
      [14.5, 12, 1, 12, E.barkLit],
      [11, 14, 0.6, 5, E.barkDeep],
      [12.8, 18, 0.6, 5, E.barkDeep],
      [9, 4, 7.5, 8, E.bark],
      [9, 4, 2, 8, E.barkDark],
      [12, 6.5, 5, 1.2, E.barkDeep],
      [14.6, 7.7, 1.2, 1, E.eye],
      [16.5, 8.5, 2.5, 1, E.barkLit],
      [14, 10.5, 2.5, 0.6, E.barkDeep],
      [12.5, 11, 4, 3, E.moss],
      [13, 14, 3, 3, E.moss],
      [13.5, 17, 2, 2, E.mossDark],
      [15.5, 11.5, 1, 4, E.mossDark],
      [7, 1, 1, 3, E.barkDark],
      [7, 2, 10, 3.5, E.leafDark],
      [5.5, 3, 4, 3, E.leaf],
      [13, 1.5, 5, 3, E.leaf],
      [16, 3.5, 3, 2.5, E.leafDark],
      [9, 1.5, 3, 2, E.leafLit],
      [14, 2, 2, 1, E.leafLit],
    ],
    0,
    -bob,
  );
  // The long branch arm swings against the stride.
  const swing = walk ? -step * 1.2 : 0;
  const arm = shift(
    [
      [11, 12, 2.5, 6, E.bark],
      [11.5 + swing, 18, 2, 4, E.bark],
      [11 + swing, 22, 0.8, 2.5, E.barkDark],
      [12.4 + swing, 22, 0.8, 3, E.barkDark],
      [13.6 + swing, 22, 0.8, 2, E.barkDark],
      [13.5, 16, 1.5, 1, E.leaf],
    ],
    0,
    -bob,
  );
  return { legs, body, arm };
}

/** Facing the reader: both branches rise, the crown shakes and a few leaves drift down. */
function front(beat: number, look: PacingLook) {
  const raise = Math.min(1, 1.6 * Math.sin(beat * Math.PI));
  const shake = raise > 0.85 ? Math.sin(look.gesture * 34) * 0.5 : 0;
  const eyes = look.blink ? E.barkDeep : E.eye;
  const body: Rect[] = [
    [8.5, 24, 3.5, 6.5, E.barkDark],
    [12.5, 24, 3.5, 6.5, E.bark],
    [7, 30, 5, 2, E.root],
    [12, 30, 5, 2, E.root],
    [7.5, 11, 9, 14, E.bark],
    [7.5, 11, 1.5, 14, E.barkDark],
    [15, 11, 1.5, 14, E.barkDark],
    [10.5, 16, 0.6, 5, E.barkDeep],
    [13, 19, 0.6, 5, E.barkDeep],
    [8, 4, 8, 8, E.bark],
    [8.5, 6.5, 7, 1.2, E.barkDeep],
    [9.7, 7.7, 1.3, 1, eyes],
    [13, 7.7, 1.3, 1, eyes],
    [11.3, 8.3, 1.4, 2, E.barkLit],
    [10.5, 10.6, 3, 0.6, E.barkDeep],
    [9.5, 11, 5, 3, E.moss],
    [10, 14, 4, 3, E.moss],
    [11, 17, 2, 2, E.mossDark],
  ];
  const crown = shift(
    [
      [6, 2, 12, 3.5, E.leafDark],
      [4.5, 3, 4, 3, E.leaf],
      [15.5, 3, 4, 3, E.leaf],
      [9, 1, 6, 2, E.leaf],
      [8, 1.5, 2.5, 1.5, E.leafLit],
      [13.5, 2, 2, 1, E.leafLit],
    ],
    shake,
    0,
  );
  const arms: Rect[] = [];
  for (const hand of [-1, 1]) {
    const down = Math.PI / 2;
    const up = -Math.PI / 3;
    const angle = hand > 0 ? down + (up - down) * raise : Math.PI - (down + (up - down) * raise);
    const branch = limb(12 + hand * 4.5, 12.5, angle, 8, 2, E.bark);
    arms.push(...branch.rects);
    for (const spread of [-0.6, 0, 0.6]) {
      const twig = limb(branch.x, branch.y, angle + spread * hand, 2.2, 0.9, E.barkDark);
      arms.push(...twig.rects);
    }
    arms.push([branch.x - 0.8, branch.y - 0.8, 1.6, 1.2, E.leafLit]);
  }
  // Leaves shaken loose fall past the trunk while the branches are up.
  const leaves: Rect[] = [];
  for (const [start, x] of [
    [0.25, 6],
    [0.38, 17],
    [0.5, 10],
  ] as const) {
    const fall = (beat - start) / 0.45;
    if (fall <= 0 || fall >= 1) continue;
    leaves.push([
      x + Math.sin(fall * 9) * 1.5,
      4 + fall * 26,
      1.2,
      0.8,
      fall < 0.5 ? E.leafLit : E.leaf,
    ]);
  }
  return { body: [...body, ...crown], arms, leaves };
}

export function drawPacingEnt(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  scale: number,
  p: PacingPose,
  look: PacingLook,
) {
  const face = facing(p);
  ctx.save();
  placeSprite(ctx, x, baseline, scale, face.sx, 7.5);
  if (face.front) {
    const { body, arms, leaves } = front(face.beat, look);
    rimRects(ctx, [...body, ...arms]);
    fillRects(ctx, body);
    fillRects(ctx, arms);
    rimRects(ctx, leaves, 0.4);
    fillRects(ctx, leaves);
  } else {
    const { legs, body, arm } = side(p.walk ? Math.sin(p.phase) : 0, p.walk);
    rimRects(ctx, [...legs, ...body, ...arm]);
    fillRects(ctx, legs);
    fillRects(ctx, body);
    rimRects(ctx, arm, 0.5);
    fillRects(ctx, arm);
  }
  ctx.restore();
}
