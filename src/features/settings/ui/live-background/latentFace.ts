import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** Code characters, not a brightness ramp: tone comes from alpha, so the figure never reads
 * as ASCII art. */
const GLYPHS = "01{}[]()<>=+-*/;:._$#&|!?%~^0123456789abcdefnrstuxyz";
/** Glyph cell in em units. */
const CELL_WIDTH = 0.62;
const CELL_HEIGHT = 1.2;
const MIN_FONT = 8;
/** Scale units: soft edge, rim light and the reach of loose sparks outside the outline. */
const EDGE = 0.05;
const RIM = 0.06;
const SPARK_REACH = 0.22;
const MAX_ALPHA = 1;
/** Alpha is quantized so each pass changes canvas state a bounded number of times. */
const ALPHA_LEVELS = 24;
const MIN_LEVEL = 1;
/** Extra stream travel while new text arrives, in rows per second of eased energy. */
const ENERGY_RUSH = 9;
/** Facial lines are hints, not a portrait: thin, single-cell strokes in code glyphs. */
const FEATURE_ALPHA = 0.9;
/** Line half-width and the darker hollow kept around each line, in cells. */
const LINE_WIDTH = 0.7;
const LINE_HOLLOW = 1.8;
/** Mouth center, half-width and opening in scale units. */
const MOUTH_Y = -0.05;
const MOUTH_HALF_WIDTH = 0.13;
const MOUTH_OPEN = 0.1;
const SYLLABLES_PER_SECOND = 3.4;
/** Head ellipse shared by the outline and the relief: center and radii in scale units. */
const HEAD_Y = -0.42;
const HEAD_RX = 0.42;
const HEAD_RY = 0.54;
/** Key light from the upper left, slightly in front, as on a lit sculpture. */
const LIGHT = (() => {
  const [x, y, z] = [-0.35, -0.45, 0.82];
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length] as const;
})();

/** How strongly raised forms catch light and cavities swallow it. */
const RIDGE_GAIN = 9;
const CAVITY_GAIN = 4;
/** The jaw narrows gently below the cheekbones; a strong taper reads as an alien chin. */
const JAW_TAPER = 0.16;
/** Superellipse exponents: a fuller cranium above, a rounded-square jaw below. */
const CRANIUM_ROUNDNESS = 2.3;
const JAW_ROUNDNESS = 2.15;

/** `lines`: a featureless mass with thin eye, nose and lip strokes. `relief`: a dark figure
 * standing in front of falling code. It blocks the code behind it, and only the ridges of
 * its face and its outline catch the light. */
type FigureStyle = "lines" | "relief";
type StyleConfig = {
  /** Cells in the figure's bounding box. Glyphs grow on large panes instead of multiplying. */
  maxCells: number;
  /** Pane height per scale unit: the relief frames the face closer. */
  headShare: number;
  bodyAlpha: number;
  streamAlpha: number;
};
const STYLES: Record<FigureStyle, StyleConfig> = {
  lines: { maxCells: 6000, headShare: 2.2, bodyAlpha: 0.12, streamAlpha: 0.88 },
  relief: { maxCells: 4400, headShare: 1.55, bodyAlpha: 0.85, streamAlpha: 0.15 },
};

/** Relief: the code field behind the figure. Its faint body keeps the backlight readable
 * between streams; the streams carry most of the light. */
const FIELD_BODY = 0.26;
const FIELD_STREAM = 0.74;
const FIELD_MIN_ALPHA = 0.07;
/** Relief: the figure uses a finer grid than the field, so thin lids and lips survive. */
const FINE_SHARE = 0.55;
const MIN_FINE_FONT = 6;
/** Fine cells darker than this in both jaw poses are never drawn and are not kept. */
const FINE_MIN_TONE = 0.03;
/** Draw groups: field or outline cells and fine figure cells, each in body and glow passes. */
const GROUPS = 4;

type Column = { speed: number; offset: number; trail: number; period: number };
type Point = readonly [number, number];

/** Closed-eye lines and the nose, in scale units. Only outlines: nothing is filled. */
const FEATURE_LINES: readonly (readonly Point[])[] = [
  [
    [-0.27, -0.44],
    [-0.17, -0.475],
    [-0.07, -0.445],
  ],
  [
    [0.07, -0.445],
    [0.17, -0.475],
    [0.27, -0.44],
  ],
  [
    [0, -0.4],
    [0.012, -0.28],
    [0.035, -0.2],
  ],
  [
    [-0.045, -0.19],
    [0, -0.172],
    [0.048, -0.19],
  ],
];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** Integer hash to [0, 1): layout and glyph choice are fixed for a given time, never random. */
function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a + 0x9e3779b9, 374761393) ^ Math.imul(b + 0x85ebca6b, 668265263);
  h = Math.imul(h ^ c ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Brightness of a falling stream's trail at `row`, 1 at the head and fading upward. */
function trailAt(head: number, row: number, trail: number): number {
  const behind = head - row;
  return behind >= 0 && behind < trail ? (1 - behind / trail) ** 1.3 : 0;
}

function smoothMin(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
}

function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  return (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
}

function box(x: number, y: number, cx: number, cy: number, hx: number, hy: number): number {
  const dx = Math.abs(x - cx) - hx;
  const dy = Math.abs(y - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}

/** Distance from a point to a polyline. Callers pass coordinates in cell units, so a line is
 * the same number of glyphs wide whether it runs across or down the grid. */
function distanceToLine(x: number, y: number, line: readonly Point[]): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1]!;
    const [bx, by] = line[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : clamp01(((x - ax) * dx + (y - ay) * dy) / length);
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return distance;
}

/** 1 on a line, 0 beyond its width. */
const lineStrength = (distance: number) => clamp01(1 - distance / LINE_WIDTH);
/** Body dimming beside a line, so a stroke reads against the code around it. */
const hollowAt = (distance: number) => 0.15 + 0.85 * smoothstep(LINE_WIDTH, LINE_HOLLOW, distance);

/** Deterministic speech rhythm: syllables of varying size with occasional pauses, closed
 * once the reply ends. */
export function mouthOpening(time: number, presence: number, energy = 0): number {
  if (presence <= 0) return 0;
  const beat = time * SYLLABLES_PER_SECOND;
  const syllable = Math.floor(beat);
  const size = hash(syllable, 23);
  if (size < 0.12) return 0;
  const phase = Math.sin((beat - syllable) * Math.PI);
  return presence * (0.45 + 0.55 * size) * (0.8 + 0.2 * energy) * phase ** 0.7;
}

/** Signed distance (negative inside) of the head and shoulders, in scale units. Facial
 * features are drawn separately over this mass. */
/** Head-local position with the jaw taper applied, so the outline and relief agree. */
function headLocal(x: number, y: number): readonly [number, number] {
  const v = (y - HEAD_Y) / HEAD_RY;
  return [(x / HEAD_RX) * (1 + JAW_TAPER * Math.max(0, v) ** 1.5), v];
}

function headDistance(x: number, y: number): number {
  const [u, v] = headLocal(x, y);
  const n = v < 0 ? CRANIUM_ROUNDNESS : JAW_ROUNDNESS;
  return ((Math.abs(u) ** n + Math.abs(v) ** n) ** (1 / n) - 1) * Math.min(HEAD_RX, HEAD_RY);
}

/** Human proportions keep the figure from reading as an alien: ears at eye-to-nose height,
 * a neck about half the head's width, and trapezius slopes into shoulders three heads wide. */
export function silhouetteDistance(x: number, y: number): number {
  const head = headDistance(x, y);
  const ears = ellipse(Math.abs(x), y, HEAD_RX + 0.005, HEAD_Y + 0.04, 0.055, 0.12);
  const neck = box(x, y, 0, 0.24, 0.2, 0.2);
  const shoulders = ellipse(x, y, 0, 1.02, 1.32, 0.58);
  return smoothMin(smoothMin(smoothMin(head, ears, 0.04), neck, 0.08), shoulders, 0.36);
}

/** Gaussian bump in head-local units. */
function bump(u: number, v: number, cu: number, cv: number, su: number, sv: number): number {
  return Math.exp(-(((u - cu) / su) ** 2) - ((v - cv) / sv) ** 2);
}

/** Facial relief in head-local units (u across, v down, both -1..1) with the jaw dropped by
 * `jaw` (0 closed, 1 open). Returns raised forms and cavities separately: cavities also
 * darken through occlusion. A generic sculpted face, not any particular person. */
function faceRelief(u: number, v: number, jaw: number): { raised: number; cavity: number } {
  // Smooth absolute value: a hard |u| would crease the relief down the middle.
  const au = Math.sqrt(u * u + 0.004);
  const drop = jaw * 0.09;
  // Below the mouth, features follow the jaw down.
  const lv = v > 0.64 ? v - drop : v;
  const raised =
    0.12 * bump(au, v, 0.37, -0.2, 0.3, 0.07) + // brow ridge
    // A thin lid line under each brow puts the eyes where a viewer expects them.
    0.26 * bump(au, v, 0.35, -0.03, 0.11, 0.03) + // closed eyelids
    0.14 * bump(u, v, 0, 0.12, 0.07, 0.23) + // nose bridge
    0.16 * bump(u, v, 0, 0.33, 0.11, 0.08) + // nose tip
    0.07 * bump(au, v, 0.13, 0.37, 0.07, 0.05) + // nostril wings
    // Long, low cheekbone planes: round blobs here would read as glowing eyes.
    0.045 * bump(au, v, 0.56, 0.24, 0.2, 0.08) + // cheekbones
    0.13 * bump(u, v, 0, 0.59, 0.19, 0.05) + // upper lip
    0.15 * bump(u, lv, 0, 0.73, 0.16, 0.06) + // lower lip
    0.1 * bump(u, lv, 0, 0.92, 0.18, 0.1); // chin
  const cavity =
    0.16 * bump(au, v, 0.36, -0.06, 0.15, 0.08) + // eye sockets
    0.08 * bump(au, v, 0.08, 0.43, 0.04, 0.03) + // nostrils
    0.08 * bump(au, v, 0.5, 0.56, 0.15, 0.15) + // cheek hollows
    0.1 * bump(u, v, 0, 0.66 + drop * 0.5, 0.2, 0.025) + // lip line
    0.45 * jaw * bump(u, v, 0, 0.665 + drop * 0.5, 0.13, 0.02 + jaw * 0.05) + // open mouth
    0.05 * bump(u, lv, 0, 0.82, 0.16, 0.04); // under the lower lip
  return { raised, cavity };
}

function faceHeight(u: number, v: number, jaw: number): number {
  const base = Math.sqrt(Math.max(0.0001, 1 - u * u - v * v));
  const { raised, cavity } = faceRelief(u, v, jaw);
  return base + raised - cavity;
}

/** Light caught by the face of a dark figure, 0..1. Only raised forms that turn toward the
 * light glint: brow, nose, cheekbones, lips and chin. The dome of the head, the sockets and
 * the far side stay dark, so the face reads without becoming a lit mask. */
export function faceGlint(x: number, y: number, jaw: number): number {
  const [u, v] = headLocal(x, y);
  const step = 0.012;
  // Height is in head-radius units; convert slopes to scale units so the light is isotropic.
  const dx = (faceHeight(u + step, v, jaw) - faceHeight(u - step, v, jaw)) / (2 * step);
  const dy =
    ((faceHeight(u, v + step, jaw) - faceHeight(u, v - step, jaw)) / (2 * step)) *
    (HEAD_RX / HEAD_RY);
  const length = Math.hypot(dx, dy, 1);
  const lambert = Math.max(0, (-dx * LIGHT[0] - dy * LIGHT[1] + LIGHT[2]) / length);
  const { raised, cavity } = faceRelief(u, v, jaw);
  const ridge = clamp01(raised * RIDGE_GAIN - cavity * CAVITY_GAIN);
  // A steep curve: broad, softly lit planes stay dark and only true glints remain.
  return clamp01(ridge * lambert ** 2) ** 1.5;
}

/**
 * A figure made of falling code. Nothing is drawn at rest: while the AI replies, glyphs
 * kindle inside a head-and-shoulders outline, streams fall through it and loose sparks crackle
 * at its edge; the mouth moves with the reply. When it ends the figure scatters back into the
 * plain background.
 */
function createCodeFigureScene(
  palette: LiveBackgroundPalette,
  style: FigureStyle,
): LiveBackgroundScene {
  const config = STYLES[style];
  let width = 0;
  let height = 0;
  let fontSize = MIN_FONT;
  let columns: Column[] = [];
  // Flat per-cell arrays: the frame loop allocates nothing.
  let cellX = new Float32Array(0);
  let cellY = new Float32Array(0);
  let cellCol = new Uint16Array(0);
  let cellRow = new Uint16Array(0);
  let cellMask = new Float32Array(0);
  let cellTone = new Float32Array(0);
  let cellReveal = new Float32Array(0);
  let cellGlow = new Float32Array(0);
  let cellAlpha = new Float32Array(0);
  /** Lines: static eye/nose stroke strength and the hollow around it. */
  let cellLine = new Float32Array(0);
  let cellHollow = new Float32Array(0);
  /** Relief: tone with the jaw fully open; `cellTone` holds the closed pose. */
  let cellToneOpen = new Float32Array(0);
  /** Relief: 1 for cells on the figure, 0 for the code field behind it. */
  let cellInside = new Uint8Array(0);
  /** Relief: 1 for cells on the figure's fine grid. */
  let cellFine = new Uint8Array(0);
  let fineFont = MIN_FINE_FONT;
  /** Lines: cells near the mouth, with their position in scale units for the moving lips. */
  let mouthCells = new Uint32Array(0);
  let mouthX = new Float32Array(0);
  let mouthY = new Float32Array(0);
  let mouthCount = 0;
  let cellsPerUnitY = 1;
  /** Draw order bucketed by pass and alpha level, rebuilt each frame without allocation. */
  let order = new Uint32Array(0);
  const bucketStart = new Uint32Array(GROUPS * (ALPHA_LEVELS + 1) + 1);
  const bucketFill = new Uint32Array(GROUPS * (ALPHA_LEVELS + 1));
  let cellBucket = new Uint16Array(0);
  let count = 0;
  /** Stream travel added by reply energy, so speed changes never make the streams jump. */
  let rush = 0;

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(0, nextWidth);
      height = Math.max(0, nextHeight);
      count = 0;
      mouthCount = 0;
      columns = [];
      rush = 0;
      if (width < 2 || height < 2) return;

      // The head starts near the top and the shoulders leave through the bottom edge.
      const scale = Math.min(height / config.headShare, width / 1.6);
      const centerX = width / 2;
      const centerY = height * 0.08 + 0.96 * scale;
      const relief = style === "relief";
      // The relief's code field fills the pane; the outline style needs only the figure.
      const left = relief ? 0 : Math.max(0, centerX - 1.42 * scale);
      const right = relief ? width : Math.min(width, centerX + 1.42 * scale);
      const top = relief ? 0 : Math.max(0, centerY - 1.04 * scale);
      const boxWidth = right - left;
      const boxHeight = height - top;
      fontSize = Math.max(
        MIN_FONT,
        scale * (relief ? 0.018 : 0.03),
        Math.sqrt((boxWidth * boxHeight) / (config.maxCells * CELL_WIDTH * CELL_HEIGHT)),
      );
      const stepX = fontSize * CELL_WIDTH;
      const stepY = fontSize * CELL_HEIGHT;
      const cols = Math.max(1, Math.floor(boxWidth / stepX));
      const rows = Math.max(1, Math.floor(boxHeight / stepY));
      const originX = left + (boxWidth - cols * stepX) / 2;
      const bottom = (height - centerY) / scale;
      const cellsPerUnitX = scale / stepX;
      cellsPerUnitY = scale / stepY;
      const lines = FEATURE_LINES.map((line) =>
        line.map(([x, y]) => [x * cellsPerUnitX, y * cellsPerUnitY] as const),
      );

      for (let col = 0; col < cols; col++) {
        const trail = 8 + Math.floor(hash(col, 11) * 16);
        const period = rows + trail + Math.floor(hash(col, 13) * rows * 0.8);
        columns.push({
          speed: 5 + hash(col, 17) * 9,
          offset: hash(col, 19) * period,
          trail,
          period,
        });
      }

      // Relief: the figure's own fine grid over its bounding box, with its own streams.
      fineFont = Math.max(MIN_FINE_FONT, fontSize * FINE_SHARE);
      const fineStepX = fineFont * CELL_WIDTH;
      const fineStepY = fineFont * CELL_HEIGHT;
      const fineLeft = Math.max(0, centerX - 1.42 * scale);
      const fineTop = Math.max(0, centerY - 1.04 * scale);
      const fineCols = relief
        ? Math.max(1, Math.floor((Math.min(width, centerX + 1.42 * scale) - fineLeft) / fineStepX))
        : 0;
      const fineRows = relief ? Math.max(1, Math.floor((height - fineTop) / fineStepY)) : 0;
      for (let col = 0; col < fineCols; col++) {
        const trail = 12 + Math.floor(hash(col, 31) * 24);
        const period = fineRows + trail + Math.floor(hash(col, 37) * fineRows * 0.8);
        columns.push({
          speed: 8 + hash(col, 41) * 14,
          offset: hash(col, 43) * period,
          trail,
          period,
        });
      }

      const capacity = cols * rows + fineCols * fineRows;
      cellX = new Float32Array(capacity);
      cellY = new Float32Array(capacity);
      cellCol = new Uint16Array(capacity);
      cellRow = new Uint16Array(capacity);
      cellMask = new Float32Array(capacity);
      cellTone = new Float32Array(capacity);
      cellToneOpen = new Float32Array(capacity);
      cellInside = new Uint8Array(capacity);
      cellFine = new Uint8Array(capacity);
      cellReveal = new Float32Array(capacity);
      cellGlow = new Float32Array(capacity);
      cellAlpha = new Float32Array(capacity);
      cellLine = new Float32Array(capacity);
      cellHollow = new Float32Array(capacity);
      cellBucket = new Uint16Array(capacity);
      order = new Uint32Array(capacity);
      mouthCells = new Uint32Array(capacity);
      mouthX = new Float32Array(capacity);
      mouthY = new Float32Array(capacity);
      for (let row = 0; row < rows; row++) {
        const py = top + (row + 0.5) * stepY;
        const y = (py - centerY) / scale;
        for (let col = 0; col < cols; col++) {
          const px = originX + (col + 0.5) * stepX;
          const x = (px - centerX) / scale;
          const distance = silhouetteDistance(x, y);
          if (relief) {
            // The figure itself is drawn on the fine grid below.
            if (distance < 0) continue;
            cellX[count] = px;
            cellY[count] = py;
            cellCol[count] = col;
            cellRow[count] = row;
            cellMask[count] = 1;
            // Backlight: the code is brightest just behind the head and thins toward the
            // pane edges, so the figure reads as a dark shape against it.
            const halo = Math.exp(-Math.hypot(x, (y - HEAD_Y) * 0.8) / 0.9);
            const edge = Math.exp(-distance / 0.035);
            cellTone[count] = clamp01(halo + 0.5 * edge);
            cellToneOpen[count] = cellTone[count]!;
            // The field kindles from behind the head outward.
            cellReveal[count] =
              hash(col, row, 7) * 0.65 + clamp01(Math.hypot(x, y + 0.3) / 1.6) * 0.35;
            count++;
            continue;
          }
          if (distance > SPARK_REACH) continue;
          const inside = smoothstep(EDGE, -EDGE, distance);
          // Outside the edge only sparse sparks remain, thinning with distance.
          const spark =
            distance > 0 ? Math.exp(-distance / 0.06) * (hash(col, row, 5) > 0.55 ? 0.6 : 0) : 0;
          const mask = Math.max(inside, spark);
          if (mask < 0.02) continue;
          // Mass: a backlit rim, a soft key light from the left and a fade where the
          // shoulders leave the pane.
          const rim = Math.exp(-Math.abs(distance) / RIM);
          const light = 0.82 - 0.22 * Math.max(-1, Math.min(1, x));
          const fade = smoothstep(bottom, bottom - 0.4, y);
          const mass = (0.55 + 0.45 * rim) * light * fade;
          cellX[count] = px;
          cellY[count] = py;
          cellCol[count] = col;
          cellRow[count] = row;
          cellMask[count] = mask;
          cellTone[count] = mass;
          // Glyphs kindle from the head outward, scattered like embers catching.
          const radial = clamp01(Math.hypot(x, y + 0.3) / 1.4);
          cellReveal[count] = hash(col, row, 7) * 0.65 + radial * 0.35;
          {
            let line = Number.POSITIVE_INFINITY;
            for (const feature of lines) {
              line = Math.min(line, distanceToLine(x * cellsPerUnitX, y * cellsPerUnitY, feature));
            }
            cellLine[count] = lineStrength(line);
            cellHollow[count] = hollowAt(line);
            if (
              Math.abs(x) < MOUTH_HALF_WIDTH * 1.3 &&
              y > MOUTH_Y - MOUTH_OPEN &&
              y < MOUTH_Y + MOUTH_OPEN * 1.6
            ) {
              mouthCells[mouthCount] = count;
              mouthX[mouthCount] = x;
              mouthY[mouthCount] = y;
              mouthCount++;
            }
          }
          count++;
        }
      }

      for (let row = 0; row < fineRows; row++) {
        const py = fineTop + (row + 0.5) * fineStepY;
        const y = (py - centerY) / scale;
        const fade = smoothstep(bottom, bottom - 0.3, y);
        for (let col = 0; col < fineCols; col++) {
          const px = fineLeft + (col + 0.5) * fineStepX;
          const x = (px - centerX) / scale;
          const distance = silhouetteDistance(x, y);
          if (distance >= 0) continue;
          // On the figure only light-facing ridges and a thin rim of backlight show.
          const face = smoothstep(0.02, -0.04, headDistance(x, y));
          const side = 0.55 + 0.45 * clamp01(0.5 - x);
          const rim = Math.exp(distance / 0.018) * side * 0.75 * fade;
          const closed = clamp01((face > 0 ? face * faceGlint(x, y, 0) : 0) + rim);
          const open = clamp01((face > 0 ? face * faceGlint(x, y, 1) : 0) + rim);
          if (Math.max(closed, open) < FINE_MIN_TONE) continue;
          cellX[count] = px;
          cellY[count] = py;
          cellCol[count] = cols + col;
          cellRow[count] = row;
          cellMask[count] = 1;
          cellInside[count] = 1;
          cellFine[count] = 1;
          cellTone[count] = closed;
          cellToneOpen[count] = open;
          cellReveal[count] =
            hash(cols + col, row, 7) * 0.65 + clamp01(Math.hypot(x, y + 0.3) / 1.6) * 0.35;
          count++;
        }
      }
    },
    draw(ctx, time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      const presence = clamp01(signal.presence);
      // At rest the pane is left exactly as it was: no figure, no residue.
      if (count === 0 || presence === 0) return;
      const energy = clamp01(signal.energy ?? 0);
      rush += Math.max(0, Math.min(delta, 0.1)) * energy * ENERGY_RUSH;
      const level = (0.4 + 0.6 * presence) * (0.85 + 0.15 * energy);
      const kindle = presence * 1.2;
      const flicker = Math.floor(time * 4);
      const mouth = mouthOpening(time, presence, energy);
      const relief = style === "relief";

      for (let i = 0; i < count; i++) {
        cellAlpha[i] = 0;
        cellGlow[i] = 0;
        const reveal = smoothstep(cellReveal[i]!, cellReveal[i]! + 0.2, kindle);
        if (reveal === 0) continue;
        const col = cellCol[i]!;
        const row = cellRow[i]!;
        const mask = cellMask[i]!;
        // The edge crackles: partially covered cells come and go like embers.
        if (mask < 1 && mask < hash(col, row, flicker) * 0.9) continue;
        const column = columns[col]!;
        const head = (column.offset + time * column.speed + rush) % column.period;
        const stream = trailAt(head, row, column.trail);
        if (relief) {
          const tone = cellTone[i]! + (cellToneOpen[i]! - cellTone[i]!) * mouth;
          // Behind the figure the streams carry the light; on it, they only brighten glints.
          const field = !cellInside[i];
          // Glints on the dark face burn in the accent color, like embers in charcoal.
          cellGlow[i] = field ? stream : tone > 0.45 ? 0.6 : stream * tone;
          cellAlpha[i] =
            reveal *
            tone *
            (field
              ? FIELD_BODY + FIELD_STREAM * stream
              : config.bodyAlpha + config.streamAlpha * stream) *
            level;
          // The faintest field glyphs add cost without adding backlight.
          if (field && cellAlpha[i]! < FIELD_MIN_ALPHA) cellAlpha[i] = 0;
          continue;
        }
        const tone = cellTone[i]! * cellHollow[i]!;
        cellGlow[i] = stream;
        const body = mask * tone * (config.bodyAlpha + config.streamAlpha * stream);
        cellAlpha[i] = reveal * Math.max(body, cellLine[i]! * FEATURE_ALPHA) * level;
      }

      // The lips are two arcs that part with each syllable. The opening between them stays
      // empty, so the mouth is a hollow outline rather than a filled shape.
      for (let m = 0; m < mouthCount; m++) {
        const i = mouthCells[m]!;
        const across = mouthX[m]! / MOUTH_HALF_WIDTH;
        const y = mouthY[m]!;
        const arc = Math.sqrt(Math.max(0, 1 - across * across));
        const upper = MOUTH_Y - mouth * MOUTH_OPEN * 0.3 * arc;
        const lower = MOUTH_Y + mouth * MOUTH_OPEN * arc;
        const toLip = Math.min(Math.abs(y - upper), Math.abs(y - lower)) * cellsPerUnitY;
        const reach = smoothstep(1.15, 0.9, Math.abs(across));
        const lip = lineStrength(toLip) * reach;
        const parted = y > upper && y < lower && toLip > LINE_WIDTH;
        const hollow = parted ? 0 : reach > 0 ? hollowAt(toLip) : 1;
        const reveal = smoothstep(cellReveal[i]!, cellReveal[i]! + 0.2, kindle);
        cellAlpha[i] = Math.max(cellAlpha[i]! * hollow, reveal * lip * FEATURE_ALPHA * level);
      }

      // Counting sort by pass and alpha level: one fill style and alpha change per bucket.
      const levels = ALPHA_LEVELS + 1;
      bucketFill.fill(0);
      for (let i = 0; i < count; i++) {
        const quantized = Math.round(Math.min(MAX_ALPHA, cellAlpha[i]!) * ALPHA_LEVELS);
        const group = (cellFine[i] ? 2 : 0) + (cellGlow[i]! > 0.55 ? 1 : 0);
        const bucket = quantized < MIN_LEVEL ? 0xffff : group * levels + quantized;
        cellBucket[i] = bucket;
        if (bucket !== 0xffff) bucketFill[bucket]!++;
      }
      bucketStart[0] = 0;
      for (let b = 0; b < GROUPS * levels; b++) {
        bucketStart[b + 1] = bucketStart[b]! + bucketFill[b]!;
        bucketFill[b] = bucketStart[b]!;
      }
      for (let i = 0; i < count; i++) {
        const bucket = cellBucket[i]!;
        if (bucket !== 0xffff) order[bucketFill[bucket]!++] = i;
      }

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Per grid: body in the content color, then bright stream heads and highlights in the
      // accent color with a glow.
      for (let group = 0; group < GROUPS; group++) {
        if (bucketStart[group * levels] === bucketStart[(group + 1) * levels]) continue;
        const heads = group % 2 === 1;
        const size = group >= 2 ? fineFont : fontSize;
        ctx.font = `${relief ? "600 " : ""}${size}px ${palette.monoFont}`;
        ctx.fillStyle = heads ? palette.accent : palette.content;
        ctx.shadowColor = palette.accent;
        ctx.shadowBlur = heads ? size * 0.7 : 0;
        for (let quantized = MIN_LEVEL; quantized < levels; quantized++) {
          const bucket = group * levels + quantized;
          const from = bucketStart[bucket]!;
          const to = bucketStart[bucket + 1]!;
          if (from === to) continue;
          ctx.globalAlpha = quantized / ALPHA_LEVELS;
          for (let k = from; k < to; k++) {
            const i = order[k]!;
            const col = cellCol[i]!;
            const row = cellRow[i]!;
            // Heads mutate fast, the settled body slowly, like code being rewritten.
            const rate = 0.6 + hash(col, row, 3) * 1.6 + cellGlow[i]! * 10;
            const index = Math.floor(hash(col, row, Math.floor(time * rate)) * GLYPHS.length);
            ctx.fillText(GLYPHS[index]!, cellX[i]!, cellY[i]!);
          }
        }
      }
      ctx.restore();
    },
  };
}

/** A featureless silhouette of falling code with thin eye, nose and lip lines. */
export function createLatentFaceScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  return createCodeFigureScene(palette, "lines");
}

/** A dark, lifelike figure in front of falling code: it blocks the code behind it and only
 * the ridges of its face catch the light. */
export function createCodeVisageScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  return createCodeFigureScene(palette, "relief");
}
