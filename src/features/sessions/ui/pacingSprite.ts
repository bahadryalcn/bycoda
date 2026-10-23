import { themePalette } from "../../../shared/theme/palette";

/** Shared pixel-sprite helpers for the crew walkers that pace beside the activity dock. */
export type PacingPose = {
  x: number;
  dir: number;
  walk: boolean;
  phase: number;
  /** 0..1 through a moment spent facing the reader; absent while pacing. */
  act?: number;
};
export type Rect = [x: number, y: number, w: number, h: number, color: string];
export const RIM = themePalette.rgba_18_14_10_0_88;

const TURN = 0.09;
/** Turning toward the reader squashes the side sprite to nothing, then grows the front sprite. */
export function facing(p: PacingPose): { front: boolean; sx: number; beat: number } {
  if (p.act === undefined) return { front: false, sx: p.dir, beat: 0 };
  const edge = Math.min(p.act, 1 - p.act) / TURN;
  const beat = Math.min(1, Math.max(0, (p.act - TURN) / (1 - 2 * TURN)));
  if (edge >= 1) return { front: true, sx: 1, beat };
  return edge < 0.5
    ? { front: false, sx: p.dir * (1 - 2 * edge), beat }
    : { front: true, sx: 2 * edge - 1, beat };
}

export const blinking = (elapsed: number, period = 3.1) => elapsed % period < 0.13;

export const shift = (rects: Rect[], dx: number, dy: number): Rect[] =>
  rects.map(([x, y, w, h, c]) => [x + dx, y + dy, w, h, c]);

/** Square pixels along a straight arm or branch; `x`/`y` return its far end. */
export function limb(
  x: number,
  y: number,
  angle: number,
  length: number,
  size: number,
  color: string,
) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const count = Math.max(2, Math.ceil(length / (size * 0.6)));
  const rects: Rect[] = [];
  for (let i = 0; i <= count; i++) {
    const d = (i / count) * length;
    rects.push([x + dx * d - size / 2, y + dy * d - size / 2, size, size, color]);
  }
  return { rects, x: x + dx * length, y: y + dy * length };
}

export function fillRects(ctx: CanvasRenderingContext2D, rects: Rect[]) {
  for (const [x, y, w, h, c] of rects) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  }
}

/** A dark outline keeps the silhouette legible at 32 px on both themes. */
export function rimRects(ctx: CanvasRenderingContext2D, rects: Rect[], pad = 1) {
  ctx.fillStyle = RIM;
  for (const [x, y, w, h] of rects) ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
}

/** Puts a 24 x 32 grid's feet one unit above the baseline, over a soft ground shadow. */
export function placeSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  scale: number,
  sx: number,
  shadow = 7,
) {
  ctx.translate(x, baseline);
  ctx.fillStyle = themePalette.rgba_0_0_0_0_22;
  ctx.beginPath();
  ctx.ellipse(0, -1.2, shadow * scale, 1.2 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.scale(scale * sx, scale);
  ctx.translate(-12, -33);
}
