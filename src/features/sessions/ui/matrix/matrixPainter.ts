import { themePalette } from "../../../../shared/theme/palette";
import { paintCharacter } from "../characterRig";
import { CODE_HEIGHT, CODE_WIDTH, CREW_TOP, type CodeArtPainter } from "../crewCodeArt";
import { lotrContext, unit } from "../lotr/lotrMotionKit";
import { starWarsLayout } from "../starWarsLayout";
import { matrixCharacter } from "./matrixCrew";
import { matrixMotionAt } from "./matrixMotion";
import { matrixRig } from "./matrixRig";
import { neoScene } from "./neoMotion";

export { loadMatrixCrew } from "./matrixRig";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789";
const COLUMN = 14;
const ROW = 16;
const ROWS = Math.ceil(CODE_HEIGHT / ROW);
/** Rain falls to this share of its speed at the peak of bullet time. */
const SLOW = 0.88;
/** The rain fades in or out over about this long (ms). */
const RAIN_FADE_MS = 600;
/** Below this level the rain is not drawn and counts as gone. */
const RAIN_GONE = 0.01;

/** The rain only falls while someone works; an idle crew leaves the page background alone. */
export function rainTarget(activity: readonly { working?: boolean }[]): 0 | 1 {
  return activity.some((state) => state?.working === true) ? 1 : 0;
}

/** Eases the rain level toward its target; a still frame (dt 0) keeps it unchanged. */
export function easeRain(level: number, target: number, dt: number): number {
  const next = level + (target - level) * (1 - Math.exp(-dt / (RAIN_FADE_MS / 3)));
  return Math.abs(target - next) < RAIN_GONE ? target : next;
}

/** The painter is rebuilt whenever the crew changes; the last level carries over so the
 * rain keeps fading instead of snapping off. */
let carried = { level: 0, at: -Infinity };

/** Deterministic 0-1 noise, so the code rain repeats exactly when the clock is seeked. */
const noise = (a: number, b: number) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const glyph = (a: number, b: number) => GLYPHS[Math.floor(noise(a, b) * GLYPHS.length)];

/** Rotate a point of artwork units about a joint, the way the rig turns its layers. */
function turn(point: [number, number], pivot: [number, number], degrees: number): [number, number] {
  const r = (degrees * Math.PI) / 180;
  const x = point[0] - pivot[0];
  const y = point[1] - pivot[1];
  return [
    pivot[0] + x * Math.cos(r) - y * Math.sin(r),
    pivot[1] + x * Math.sin(r) + y * Math.cos(r),
  ];
}

/** Where Neo's code glow sits: through the forearm, arm and prop joints, then the body lean. */
function palmOf(pose: {
  propAngle: number;
  armAngle: number;
  forearmAngle: number;
  bodyAngle: number;
  bodyX: number;
  bodyY: number;
}): [number, number] {
  let p = turn([113, 182], [107, 136], pose.forearmAngle);
  p = turn(p, [99, 107], pose.armAngle);
  p = turn(p, [80, 172], pose.propAngle);
  p = turn(p, [80, 226], pose.bodyAngle);
  return [p[0] + pose.bodyX, p[1] + pose.bodyY];
}

/** Code rain behind the crew: falling columns with a bright head, slower while bullet time runs. */
function paintRain(c: CanvasRenderingContext2D, clock: number, level: number) {
  c.font = "13px monospace";
  c.textBaseline = "top";
  const tick = Math.floor(clock / 110);
  for (let column = 0; column * COLUMN < CODE_WIDTH; column++) {
    const speed = 4 + noise(column, 1) * 6;
    const length = 6 + Math.floor(noise(column, 2) * 9);
    const travel = (clock / 1000) * speed;
    const head = (noise(column, 3) * ROWS + travel) % (ROWS + length);
    for (let i = 0; i < length; i++) {
      const row = Math.floor(head) - i;
      if (row < 0 || row >= ROWS) continue;
      c.globalAlpha = level * (i === 0 ? 0.55 : 0.3) * (1 - i / length);
      c.fillStyle = i === 0 ? themePalette.hexe2ffe8 : themePalette.hex00ff41;
      c.fillText(glyph(column * 31 + row, tick), column * COLUMN, row * ROW);
    }
  }
  c.globalAlpha = 1;
}

/** A newly arriving Smith materializes from falling code: the edge sweeps up through him. */
function paintMaterialize(c: CanvasRenderingContext2D, edge: number, clock: number) {
  c.font = "9px monospace";
  c.textBaseline = "alphabetic";
  const tick = Math.floor(clock / 60);
  for (let i = 0; i < 14; i++) {
    const x = 20 + noise(i, tick) * 120;
    for (let j = 0; j < 4; j++) {
      c.globalAlpha = j === 0 ? 1 : 0.7 - j * 0.15;
      c.fillStyle = j === 0 ? themePalette.hexe2ffe8 : themePalette.hex00ff41;
      c.fillText(glyph(i, tick + j), x, edge - j * 10);
    }
  }
  c.globalAlpha = 1;
  c.fillStyle = themePalette.hex00ff41;
  c.fillRect(-40, edge - 0.5, 240, 1.5);
}

/** Ripple rings from Neo's raised palm: three staggered rings expanding and fading. */
function paintRipple(c: CanvasRenderingContext2D, x: number, y: number, progress: number) {
  c.strokeStyle = themePalette.hex7dffa0;
  c.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    const p = (progress + k / 3) % 1;
    c.globalAlpha = (1 - p) * 0.7;
    c.beginPath();
    c.ellipse(x, y, 6 + p * 36, 6 + p * 36, 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;
}

/** The shared scene owns lifecycle, visibility, reduced motion and the paint clock. */
export function createMatrixPainter(surface: HTMLCanvasElement): CodeArtPainter {
  const scale = 2;
  surface.width = CODE_WIDTH * scale;
  surface.height = CODE_HEIGHT * scale;
  const c = surface.getContext("2d")!;
  // Scene state that eases between frames: the rain clock and the bullet time strength.
  let lastTime: number | undefined;
  let rainClock = 0;
  let bullet = 0;
  let rain = performance.now() - carried.at < 2000 ? carried.level : 0;
  const paint: CodeArtPainter = (_poses, activity = [], viewportWidth = 1280, time = 0) => {
    const dt = lastTime === undefined ? 0 : Math.min(50, Math.max(0, time - lastTime));
    lastTime = time;
    rainClock += dt * (1 - SLOW * bullet);
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.clearRect(0, 0, CODE_WIDTH, CODE_HEIGHT);
    // Time 0 is the still pose (reduced motion, hidden or idle): no rain, transparent background.
    if (time > 0) rain = easeRain(rain, rainTarget(activity), dt);
    if (time > 0 && rain >= RAIN_GONE) paintRain(c, rainClock, rain);
    // The crescent is theme-neutral: the lead and advisor sit at the rear.
    const places = starWarsLayout(Math.max(6, activity.length), viewportWidth).sort(
      (a, b) => a.y - b.y,
    );
    let bulletTarget = 0;
    for (const place of places) {
      const state = activity[place.id];
      const arrival = state?.arrival ?? 1;
      if (arrival <= 0) continue;
      const character = matrixCharacter(place.id, state?.role);
      const rig = matrixRig(character.id);
      if (!rig) continue;
      const working = state?.working === true;
      // Neo's dodge and stop only play while he works; the stand weight ramps them in and out.
      const weight = working ? unit(state?.stand) : 0;
      const scene =
        character.id === "neo" ? neoScene(lotrContext(place.id, time, state)) : undefined;
      if (scene) bulletTarget = Math.max(bulletTarget, scene.bulletTime * weight);
      c.save();
      c.translate(place.x, place.y + CREW_TOP);
      c.scale(place.scale, place.scale);
      // A small docking light makes active work visible independently of context fill.
      c.globalAlpha = arrival;
      c.fillStyle = themePalette.rgba_12_19_32_0_5;
      c.beginPath();
      c.ellipse(0, 0, 43, 6, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = character.accent;
      c.globalAlpha = arrival * (working ? 0.8 : 0.23);
      c.lineWidth = working ? 1.5 : 0.8;
      c.beginPath();
      c.ellipse(0, 0, 44, 7, 0, 0, Math.PI * 2);
      c.stroke();
      c.translate(-75, -224);
      c.scale(150 / 160, 225 / 240);
      const poseAt = (offset: number) =>
        matrixMotionAt(character.id, place.id, time + offset, state);
      // Full charge keeps the figures in their own colors; a partial charge fill would grey them.
      if (arrival < 1) {
        const edge = 240 * (1 - arrival);
        c.save();
        c.beginPath();
        c.rect(-40, edge, 240, 240);
        c.clip();
        paintCharacter(c, rig, poseAt, 1, character.headroom);
        c.restore();
        paintMaterialize(c, edge, time);
      } else {
        paintCharacter(c, rig, poseAt, 1, character.headroom);
      }
      if (scene && weight > 0 && scene.ripple >= 0) {
        const [x, y] = palmOf(poseAt(0));
        c.globalAlpha = arrival;
        paintRipple(c, x, y, scene.ripple);
      }
      if (scene && bullet > 0.01) {
        // The bullet time caption floats above Neo's head while the rain slows.
        c.globalAlpha = arrival * bullet;
        c.fillStyle = themePalette.hex9fffb8;
        c.font = "600 9px monospace";
        c.textAlign = "center";
        c.textBaseline = "alphabetic";
        c.fillText("BULLET TIME", 80, -10);
      }
      c.restore();
    }
    // Bullet time eases in and out over about a tenth of a second.
    bullet += (bulletTarget - bullet) * (1 - Math.exp(-dt / 100));
  };
  paint.busy = () => rain >= RAIN_GONE;
  paint.dispose = () => {
    carried = { level: rain, at: performance.now() };
  };
  return paint;
}
