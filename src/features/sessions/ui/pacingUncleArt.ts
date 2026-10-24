import { themePalette } from "../../../shared/theme/palette";
import type { CrewTheme } from "../../settings/model/settings";
import { drawPacingDroid } from "./pacingDroidArt";
import { drawPacingEnt } from "./pacingEntArt";
import {
  blinking,
  facing,
  fillRects,
  placeSprite,
  rimRects,
  type PacingLook,
  type PacingPose,
  type PacingWalker,
  type Rect,
} from "./pacingSprite";
/** Code-art pacing uncle. A pixel silhouette with a dark rim stays legible at 32 px on both themes. */
export type { PacingPose } from "./pacingSprite";
export const PACING_STEPS = [
  20, -10, 5, -20, 40, -15, 30, -10, 50, -20, 15, -35, 60, -10, 25, -80,
] as const;
export const PACING_STEP_SECONDS = 0.34;
const PAUSE_SECONDS = 0.28;
const TURN_SECONDS = 0.3;
/** Every fourth leg ends with the walker facing the reader for a short gesture. */
export const GESTURE_SECONDS = 3.2;
const gestures = (leg: number) => leg % 4 === 3;
type PacingLeg = {
  from: number;
  to: number;
  dir: number;
  duration: number;
  steps: number;
};

/** The actual rail width determines the route; edge turns shorten a requested run. */
export function createPacingRoute(span: number): PacingLeg[] {
  if (span <= 0) return [];
  const stride = Math.min(16, Math.max(4, span / 50));
  const legs: PacingLeg[] = [];
  let x = 0;
  const add = (target: number) => {
    const to = Math.min(span, Math.max(0, target));
    if (Math.abs(to - x) < 0.001) return;
    const steps = Math.abs(to - x) / stride;
    legs.push({
      from: x,
      to,
      dir: Math.sign(to - x),
      steps,
      duration: steps * PACING_STEP_SECONDS,
    });
    x = to;
  };
  for (const steps of PACING_STEPS) add(x + steps * stride);
  // Walk back to the starting edge instead of teleporting when the route repeats.
  add(0);
  return legs;
}

let route: { span: number; legs: PacingLeg[]; cycle: number } | null = null;
function routeFor(span: number) {
  if (route?.span === span) return route;
  const legs = createPacingRoute(span);
  const cycle = legs.reduce(
    (sum, leg, i) =>
      sum +
      leg.duration +
      (gestures(i) ? GESTURE_SECONDS : 0) +
      PAUSE_SECONDS +
      (leg.dir !== legs[(i + 1) % legs.length].dir ? TURN_SECONDS : 0),
    0,
  );
  route = { span, legs, cycle };
  return route;
}

export function pacingPose(t: number, span = 844): PacingPose {
  const { legs, cycle } = routeFor(span);
  if (!legs.length) return { x: 0, dir: 1, walk: false, phase: 0 };
  let moment = ((t % cycle) + cycle) % cycle;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const next = legs[(i + 1) % legs.length];
    if (moment < leg.duration)
      return {
        x: (leg.from + ((leg.to - leg.from) * moment) / leg.duration) / span,
        dir: leg.dir,
        walk: true,
        phase: (moment / PACING_STEP_SECONDS) * Math.PI,
      };
    moment -= leg.duration;
    if (gestures(i)) {
      if (moment < GESTURE_SECONDS)
        return {
          x: leg.to / span,
          dir: leg.dir,
          walk: false,
          phase: 0,
          act: moment / GESTURE_SECONDS,
        };
      moment -= GESTURE_SECONDS;
    }
    if (moment < PAUSE_SECONDS) return { x: leg.to / span, dir: leg.dir, walk: false, phase: 0 };
    moment -= PAUSE_SECONDS;
    if (next.dir !== leg.dir) {
      if (moment < TURN_SECONDS)
        return {
          x: leg.to / span,
          dir: leg.dir * Math.cos((moment / TURN_SECONDS) * Math.PI),
          walk: false,
          phase: 0,
        };
      moment -= TURN_SECONDS;
    }
  }
  return { x: 0, dir: 1, walk: false, phase: 0 };
}
const C = {
  rim: themePalette.rgba_18_14_10_0_88,
  cap: themePalette.hex6b5744,
  capTop: themePalette.hex8a7259,
  brim: themePalette.hex45382c,
  hair: themePalette.hexb9b3aa,
  skin: themePalette.hexefbb92,
  skinShade: themePalette.hexcf926a,
  eye: themePalette.hex2a211b,
  moustache: themePalette.hex3a2f28,
  moustacheTip: themePalette.hex77695d,
  shirt: themePalette.hexece6d8,
  cardigan: themePalette.hexb5853f,
  cardiganShade: themePalette.hex8b622b,
  cardiganLight: themePalette.hexd3a35c,
  sleeve: themePalette.hex9a6e31,
  button: themePalette.hex4a3520,
  trousers: themePalette.hex5f6677,
  trousersFar: themePalette.hex474d5b,
  shoe: themePalette.hex2c2420,
  bead: themePalette.hexf0a92e,
  beadLit: themePalette.hexffe08a,
};
const glyphs = ["const", "=>", "{}", "if", "();", "let", "[]", "0110", "</>"];

/** Sprite grid is 24 x 32 units facing right; feet rest on y = 32, one unit above the bar edge. */
function sprite(step: number, walk: boolean) {
  const bob = walk ? (1 - Math.abs(step)) * 0.8 : 0;
  const legs: Rect[] = [];
  const reach = walk ? step * 3 : 0;
  const leg = (hip: number, offset: number, color: string) => {
    const lift = walk && offset * step > 0 && Math.abs(step) < 0.85 ? 1 : 0;
    legs.push(
      [hip + offset / 2, 24, 3, 4, color],
      [hip + offset, 27.5, 3, 3 - lift, color],
      [hip + offset, 30 - lift, 4, 2, C.shoe],
    );
  };
  leg(9.5, -reach, C.trousersFar);
  leg(12, reach, C.trousers);
  const y = (rects: Rect[]): Rect[] => rects.map(([x, top, w, h, c]) => [x, top - bob, w, h, c]);
  const body = y([
    // Stooped back, cardigan and a comfortably round belly.
    [8, 16, 9, 9.5, C.cardigan],
    [7, 17, 1, 7, C.cardiganShade],
    [8, 16, 2, 9.5, C.cardiganShade],
    [17, 18, 2, 7, C.cardigan],
    [19, 19.5, 1, 4.5, C.cardigan],
    [17, 18.5, 1.5, 2, C.cardiganLight],
    [14, 16, 2.5, 2, C.shirt],
    [15, 18, 1, 1, C.shirt],
    [17.5, 20.5, 1, 1, C.button],
    [18, 23, 1, 1, C.button],
    // Flat cap, grey sideburn, big nose and a heavy moustache.
    [10, 15, 5, 1.5, C.skinShade],
    [8, 8, 8.5, 7.5, C.skin],
    [16.5, 9, 1, 5, C.skin],
    [17, 10, 1.5, 2.2, C.skinShade],
    [8, 8, 1.5, 4.5, C.hair],
    [9.5, 9.5, 1.5, 2.5, C.skinShade],
    [14.5, 9.5, 1, 1, C.eye],
    [12.5, 12.2, 6, 1.8, C.moustache],
    [12.5, 14, 1, 1, C.moustacheTip],
    [18, 13.2, 1, 1, C.moustacheTip],
    [8, 4, 8, 1.5, C.capTop],
    [7, 5.5, 10, 2, C.cap],
    [7, 7.5, 9.5, 1, C.brim],
    [15, 7, 4.5, 1.5, C.brim],
  ]);
  // Elbow bent backward, hands clasped at the small of the back.
  const arm = y([
    [9, 17, 3.5, 3, C.sleeve],
    [6.5, 19, 3.5, 3, C.sleeve],
    [5.5, 21.5, 3.5, 2, C.sleeve],
    [4.5, 22.5, 3, 2.5, C.skin],
  ]);
  return { legs, body, arm, bob };
}
/** Facing the reader: arms apart, the right hand raised to flip the tespih. */
function front(blink: boolean) {
  const eyes = blink ? C.skinShade : C.eye;
  const body: Rect[] = [
    [9, 24, 2.5, 6, C.trousersFar],
    [12.5, 24, 2.5, 6, C.trousers],
    [8.5, 30, 3.5, 2, C.shoe],
    [12, 30, 3.5, 2, C.shoe],
    [7, 16, 10, 9, C.cardigan],
    [6.5, 18, 11, 6, C.cardigan],
    [6.5, 18, 1, 6, C.cardiganShade],
    [16.5, 18, 1, 6, C.cardiganShade],
    [11, 16, 2, 3, C.shirt],
    [11.5, 20, 1, 1, C.button],
    [11.5, 22.5, 1, 1, C.button],
    [10, 15, 4, 1.5, C.skinShade],
    [8, 8, 8, 7.5, C.skin],
    [7, 10, 1, 2.5, C.skinShade],
    [16, 10, 1, 2.5, C.skinShade],
    [8, 8.5, 1, 4, C.hair],
    [15, 8.5, 1, 4, C.hair],
    [9.8, 10, 1, 1, eyes],
    [13.2, 10, 1, 1, eyes],
    [11.3, 10.5, 1.4, 2.2, C.skinShade],
    [9.3, 12.8, 5.4, 1.6, C.moustache],
    [9, 14, 1, 1, C.moustacheTip],
    [14, 14, 1, 1, C.moustacheTip],
    [8, 4.5, 8, 1.5, C.capTop],
    [7, 6, 10, 2, C.cap],
    [7.5, 8, 9, 1, C.brim],
  ];
  const arms: Rect[] = [
    [5, 17, 2, 6, C.sleeve],
    [5, 23, 2, 2, C.skin],
    [16.5, 17, 2.5, 3.5, C.sleeve],
    [18, 19.5, 3, 2, C.sleeve],
    [20.5, 19, 2.5, 2.5, C.skin],
  ];
  return { body, arms, hand: [21.7, 21.3] as const };
}
/** Three brisk flips around the fingers that start and settle with the beads hanging down. */
function flipTespih(ctx: CanvasRenderingContext2D, hx: number, hy: number, beat: number) {
  const turns = 3 * (beat - Math.sin(beat * Math.PI * 2) / (Math.PI * 2));
  const speed = 1 - Math.cos(beat * Math.PI * 2);
  const loop = (angle: number) => {
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    const at = (along: number, across: number) =>
      [hx + ax * along - ay * across, hy + ay * along + ax * across] as const;
    const beads: (readonly [number, number])[] = [];
    for (let i = 0; i < 14; i++) {
      const u = (i / 14) * Math.PI * 2;
      beads.push(at(((1 - Math.cos(u)) / 2) * 6.5, Math.sin(u) * 1.4));
    }
    return { beads, tassel: [at(7.8, 0), at(8.9, 0)] };
  };
  const angle = Math.PI / 2 + turns * Math.PI * 2;
  // A faint trailing loop makes the fast middle of the flip readable at 32 px.
  if (speed > 0.4) {
    ctx.globalAlpha = 0.3 * (speed / 2);
    ctx.fillStyle = C.bead;
    for (const [x, y] of loop(angle - 0.55).beads) ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    ctx.globalAlpha = 1;
  }
  const { beads, tassel } = loop(angle);
  ctx.fillStyle = C.rim;
  for (const [x, y] of [...beads, ...tassel]) ctx.fillRect(x - 1.1, y - 1.1, 2.2, 2.2);
  beads.forEach(([x, y], i) => {
    ctx.fillStyle = i % 5 === 0 ? C.beadLit : C.bead;
    ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
  });
  ctx.fillStyle = C.bead;
  for (const [x, y] of tassel) ctx.fillRect(x - 0.5, y - 0.6, 1, 1.4);
}
const textured = new Set<string>([
  C.cardigan,
  C.cardiganShade,
  C.sleeve,
  C.trousers,
  C.trousersFar,
]);
/** Clothing is woven from real code glyphs; they read as texture small and as code up close. */
function weave(ctx: CanvasRenderingContext2D, rects: Rect[]) {
  const cloth = new Path2D();
  for (const [rx, ry, w, h, c] of rects) if (textured.has(c)) cloth.rect(rx, ry, w, h);
  ctx.save();
  ctx.clip(cloth);
  ctx.font = "2.2px monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = themePalette.rgba_255_244_220_0_3;
  for (let row = 0; row < 8; row++)
    ctx.fillText(
      glyphs
        .slice(row % 3)
        .concat(glyphs)
        .join(" "),
      2 - (row % 2) * 1.5,
      15 + row * 2.2,
    );
  ctx.restore();
}
const character: PacingWalker = (ctx, x, baseline, scale, p, look) => {
  const face = facing(p);
  ctx.save();
  placeSprite(ctx, x, baseline, scale, face.sx);
  if (face.front) {
    const { body, arms, hand } = front(look.blink);
    rimRects(ctx, [...body, ...arms]);
    fillRects(ctx, body);
    rimRects(ctx, arms, 0.5);
    fillRects(ctx, arms);
    weave(ctx, [...body, ...arms]);
    flipTespih(ctx, hand[0], hand[1], face.beat);
    ctx.restore();
    return;
  }
  const step = p.walk ? Math.sin(p.phase) : 0;
  const { legs, body, arm, bob } = sprite(step, p.walk);
  const all = [...legs, ...body, ...arm];
  // A one-unit dark rim around the whole silhouette, then the arm gets its own inner rim.
  rimRects(ctx, all);
  fillRects(ctx, legs);
  fillRects(ctx, body);
  rimRects(ctx, arm, 0.5);
  fillRects(ctx, arm);
  weave(ctx, all);
  // Amber tespih hangs from the clasped hands; idle hands keep counting beads.
  ctx.save();
  ctx.translate(6, 25 - bob);
  ctx.rotate(p.walk ? Math.sin(p.phase - 0.6) * 0.32 : Math.sin((look.count / 6) * Math.PI) * 0.06);
  const beads = 12;
  const counted = look.count;
  for (let i = 0; i < beads; i++) {
    const angle = -Math.PI / 2 + (i / beads) * Math.PI * 2;
    const bx = Math.cos(angle) * 1.7 - 0.5;
    const by = 2.6 + Math.sin(angle) * 2.6;
    ctx.fillStyle = C.rim;
    ctx.fillRect(bx - 0.5, by - 0.5, 2, 2);
    ctx.fillStyle = !p.walk && i === counted ? C.beadLit : C.bead;
    ctx.fillRect(bx, by, 1, 1);
  }
  ctx.fillStyle = C.bead;
  ctx.fillRect(-0.7, 5.6, 1, 2.2);
  ctx.restore();
  ctx.restore();
};

const WALKERS: Record<CrewTheme, PacingWalker> = {
  classic: character,
  lotr: drawPacingEnt,
  "star-wars": drawPacingDroid,
};

/** Pixel art changes 12 times a second; every visible detail derives from the frame number. */
export const PACING_FPS = 12;
const PHASE_BINS = 8;
/** Sprite cells are 48 x 34 units around the feet; gestures reach past the 24-unit grid. */
const CELL_W = 48;
const CELL_H = 34;
/** Room for one theme's full set (the uncle needs about 100 frames) without churn. */
const MAX_SPRITES = 128;
type Cell = { image: CanvasImageSource; ctx: CanvasRenderingContext2D };
const sprites = new Map<string, CanvasImageSource>();
const painted = new WeakMap<CanvasRenderingContext2D, string>();

function createCell(width: number, height: number): Cell | null {
  if (typeof OffscreenCanvas !== "undefined") {
    const image = new OffscreenCanvas(width, height);
    const ctx = image.getContext("2d") as unknown as CanvasRenderingContext2D | null;
    return ctx ? { image, ctx } : null;
  }
  if (typeof document === "undefined") return null;
  const image = document.createElement("canvas");
  image.width = width;
  image.height = height;
  const ctx = image.getContext("2d");
  return ctx ? { image, ctx } : null;
}

/** Each distinct frame is drawn once; the walk, pauses and gestures replay cached bitmaps. */
function cachedSprite(
  key: string,
  scale: number,
  dpr: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
) {
  const hit = sprites.get(key);
  if (hit) {
    sprites.delete(key);
    sprites.set(key, hit);
    return hit;
  }
  const cell = createCell(Math.ceil(CELL_W * scale * dpr), Math.ceil(CELL_H * scale * dpr));
  if (!cell) return null;
  cell.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(cell.ctx);
  sprites.set(key, cell.image);
  if (sprites.size > MAX_SPRITES) sprites.delete(sprites.keys().next().value!);
  return cell.image;
}

/** Snaps the pose and clock details to the frame grid so equal frames share one key. */
function frameOf(p: PacingPose, t: number, theme: CrewTheme) {
  const step = (Math.PI * 2) / PHASE_BINS;
  const phase = p.walk ? Math.round(p.phase / step) % PHASE_BINS : 0;
  const gesture = p.act === undefined ? -1 : Math.round(p.act * GESTURE_SECONDS * PACING_FPS);
  const dir = Math.round(p.dir * 4) / 4;
  // Only eyes that are on screen blink: front views, and the droid's side visor.
  const blink = blinking(t) && (gesture >= 0 || theme === "star-wars");
  // The idle uncle counts beads only while standing sideways, not mid-turn.
  const counting = theme === "classic" && !p.walk && gesture < 0 && Math.abs(dir) === 1;
  const count = counting ? Math.floor(t * 4) % 12 : 0;
  const pose: PacingPose = {
    x: p.x,
    dir,
    walk: p.walk,
    phase: phase * step,
    act: gesture < 0 ? undefined : gesture / (GESTURE_SECONDS * PACING_FPS),
  };
  const look: PacingLook = { blink, count, gesture: Math.max(0, gesture) / PACING_FPS };
  return { pose, look, key: `${theme}|${+p.walk}|${phase}|${dir}|${gesture}|${+blink}|${count}` };
}

/**
 * Draws the crew theme's walker: the tespih uncle, an Ent, or a protocol droid.
 * Frames that match the canvas's current picture leave it untouched.
 */
export function drawPacingUncle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elapsed: number,
  theme: CrewTheme = "classic",
): void {
  const t = Math.floor(elapsed * PACING_FPS) / PACING_FPS;
  const scale = height / 32;
  const span = Math.max(0, width - 36);
  const { pose, look, key } = frameOf(pacingPose(t, span), t, theme);
  const dpr = ctx.getTransform?.()?.a || 1;
  // Snap to device pixels so the cached sprite copies without resampling.
  const x = Math.round(((width - span) / 2 + pose.x * span) * dpr) / dpr;
  const signature = `${key}|${x}|${width}|${height}|${dpr}`;
  // Resizing a canvas resets its context, which turns smoothing back on.
  if (!ctx.imageSmoothingEnabled && painted.get(ctx) === signature) return;
  painted.set(ctx, signature);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  const walker = WALKERS[theme] ?? character;
  const sprite = cachedSprite(`${key}|${scale}|${dpr}`, scale, dpr, (cell) =>
    walker(cell, (CELL_W / 2) * scale, CELL_H * scale, scale, pose, look),
  );
  if (!sprite) {
    walker(ctx, x, height, scale, pose, look);
    return;
  }
  ctx.drawImage(
    sprite,
    x - (CELL_W / 2) * scale,
    height - CELL_H * scale,
    CELL_W * scale,
    CELL_H * scale,
  );
}
