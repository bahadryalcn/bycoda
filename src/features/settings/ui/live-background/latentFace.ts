import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** Code glyphs in three weights. Lit surfaces use the dense digits, shadows thin punctuation, so
 * light reads through glyph density as well as alpha. Heavy marks (#, @, &, %) read as blots at
 * these sizes and are left out. */
const GLYPHS = ".:;-,'" + "+=<>/()[]{}*~" + "0123456789abcdef";
/** [start, length] of each glyph pool: faint, medium, dense, and any code glyph. */
const POOLS: readonly (readonly [number, number])[] = [
  [0, 6],
  [6, 13],
  [19, 16],
  [6, 29],
];
const DENSE = 2;
const CODE = 3;
/** Glyph cells in em units. Rain grids leave air between columns, so they read as falling
 * streams rather than lines of text; contour grids pack tighter to trace a clean edge. */
const RAIN_CELL = [0.82, 1.12] as const;
const CONTOUR_CELL = [0.62, 1.2] as const;
const MIN_FONT = 6;
/** Alpha is quantized so each pass changes canvas state a bounded number of times. */
const ALPHA_LEVELS = 24;
const MIN_LEVEL = 1;
/** Extra stream travel while new text arrives, in rows per second of eased energy. */
const ENERGY_RUSH = 9;
const SYLLABLES_PER_SECOND = 3.4;
/** A stream's leading glyph: it is drawn in the accent color. */
const HEAD_GLOW = 0.9;
/** Font tiers, back to front: far rain, the figure's own grid, near rain. */
const TIERS = 3;
const FAR = 0;
const FIGURE = 1;
const NEAR = 2;
/** Draw groups: every tier in the content color, then in the accent color. */
const GROUPS = TIERS * 2;

/** Head ellipse shared by the outline and the relief: center and radii in scale units. */
const HEAD_Y = -0.42;
const HEAD_RX = 0.42;
const HEAD_RY = 0.54;
/** The jaw narrows gently below the cheekbones; a strong taper reads as an alien chin. */
const JAW_TAPER = 0.16;
/** Superellipse exponents: a fuller cranium above, a rounded-square jaw below. */
const CRANIUM_ROUNDNESS = 2.3;
const JAW_ROUNDNESS = 2.15;

const normalize = (x: number, y: number, z: number) => {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length] as const;
};
/** Key light from the upper left and in front, as on a lit sculpture. */
const LIGHT = normalize(-0.5, -0.55, 0.68);
/** Half vector between the key light and the viewer, for small specular glints. */
const HALF = normalize(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
/** Backlight direction in the picture plane: the rim catches it on the upper right. */
const RIM_LIGHT = normalize(0.7, -0.72, 0);

/** Latent face: depth of the sculpted face and the rounded bevel of neck and shoulders. */
const FACE_DEPTH = 0.34;
const BEVEL = 0.2;

type Column = { speed: number; offset: number; trail: number; period: number };

/** `luminous`: the figure itself is lit code, condensing out of faint rain.
 * `eclipse`: a dark figure standing in front of layered, backlit code rain. */
type FigureStyle = "luminous" | "eclipse";
type StyleConfig = {
  /** Pane height per scale unit: the eclipse frames the figure closer. */
  headShare: number;
  /** Glyph size per tier as a share of the scale, and the cell budget each grid may use. */
  fontShare: readonly [number, number, number];
  maxCells: readonly [number, number, number];
  /** Cell shape of the figure's own grid. */
  figureCell: readonly [number, number];
};
const STYLES: Record<FigureStyle, StyleConfig> = {
  luminous: {
    headShare: 1.78,
    fontShare: [0.019, 0.02, 0],
    maxCells: [9000, 9000, 0],
    figureCell: RAIN_CELL,
  },
  eclipse: {
    headShare: 1.86,
    fontShare: [0.021, 0.0135, 0.036],
    maxCells: [9000, 16000, 3000],
    figureCell: CONTOUR_CELL,
  },
};

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
  return behind >= 0 && behind < trail ? (1 - behind / trail) ** 1.6 : 0;
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

/** Signed distance (negative inside) of the head and shoulders, in scale units. Human
 * proportions keep the figure from reading as an alien: ears at eye-to-nose height, a neck
 * about half the head's width, and trapezius slopes into shoulders three heads wide. */
function silhouetteDistance(x: number, y: number): number {
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
 * `jaw` (0 closed, 1 open). Raised forms and cavities are returned separately: cavities also
 * darken through occlusion. A generic sculpted face, not any particular person. */
let reliefRaised = 0;
let reliefCavity = 0;
function faceRelief(u: number, v: number, jaw: number) {
  // Smooth absolute value: a hard |u| would crease the relief down the middle.
  const au = Math.sqrt(u * u + 0.004);
  const drop = jaw * 0.09;
  // Below the mouth, features follow the jaw down.
  const lv = v > 0.64 ? v - drop : v;
  reliefRaised =
    0.12 * bump(au, v, 0.37, -0.2, 0.3, 0.07) + // brow ridge
    0.26 * bump(au, v, 0.35, -0.03, 0.11, 0.03) + // closed eyelids
    0.14 * bump(u, v, 0, 0.12, 0.07, 0.23) + // nose bridge
    0.16 * bump(u, v, 0, 0.33, 0.11, 0.08) + // nose tip
    0.07 * bump(au, v, 0.13, 0.37, 0.07, 0.05) + // nostril wings
    0.045 * bump(au, v, 0.56, 0.24, 0.2, 0.08) + // cheekbones
    0.13 * bump(u, v, 0, 0.59, 0.19, 0.05) + // upper lip
    0.15 * bump(u, lv, 0, 0.73, 0.16, 0.06) + // lower lip
    0.1 * bump(u, lv, 0, 0.92, 0.18, 0.1); // chin
  reliefCavity =
    0.16 * bump(au, v, 0.36, -0.06, 0.15, 0.08) + // eye sockets
    0.08 * bump(au, v, 0.08, 0.43, 0.04, 0.03) + // nostrils
    0.08 * bump(au, v, 0.5, 0.56, 0.15, 0.15) + // cheek hollows
    0.1 * bump(u, v, 0, 0.66 + drop * 0.5, 0.2, 0.025) + // lip line
    0.45 * jaw * bump(u, v, 0, 0.665 + drop * 0.5, 0.13, 0.02 + jaw * 0.05) + // open mouth
    0.05 * bump(u, lv, 0, 0.82, 0.16, 0.04); // under the lower lip
}

function faceHeight(u: number, v: number, jaw: number): number {
  const base = Math.sqrt(Math.max(0.0001, 1 - u * u - v * v));
  faceRelief(u, v, jaw);
  return base + reliefRaised - reliefCavity;
}

/** Height of the sculpted bust in scale units: a rounded bevel for neck and shoulders, the
 * modelled face on the head. Zero outside the outline. */
function bustHeight(x: number, y: number, jaw: number): number {
  const distance = silhouetteDistance(x, y);
  if (distance >= 0) return 0;
  const t = clamp01(-distance / BEVEL);
  const body = BEVEL * Math.sqrt(1 - (1 - t) * (1 - t));
  const onHead = smoothstep(0.02, -0.08, headDistance(x, y));
  if (onHead === 0) return body;
  const [u, v] = headLocal(x, y);
  const face = faceHeight(u, v, jaw) * FACE_DEPTH;
  return body + (Math.max(body, face) - body) * onHead;
}

/** Shading of the luminous bust, written to the scratch values below to avoid allocation. */
let shadeDiffuse = 0;
let shadeRim = 0;
let shadeGlint = 0;
function shadeBust(x: number, y: number, jaw: number) {
  const step = 0.007;
  const dx = (bustHeight(x + step, y, jaw) - bustHeight(x - step, y, jaw)) / (2 * step);
  const dy = (bustHeight(x, y + step, jaw) - bustHeight(x, y - step, jaw)) / (2 * step);
  const [nx, ny, nz] = normalize(-dx, -dy, 1);
  shadeDiffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  // Grazing surfaces facing the backlight catch a thin rim.
  shadeRim = (1 - nz) ** 2 * Math.max(0, nx * RIM_LIGHT[0] + ny * RIM_LIGHT[1]);
  shadeGlint = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) ** 28;
}

/** Tone of the last shaded point: key light, backlit rim and glints, 0..1. */
const litTone = () => clamp01(0.12 + 0.7 * shadeDiffuse ** 1.6 + 0.9 * shadeRim + 0.4 * shadeGlint);

/** Light caught by the face of a dark figure, 0..1. Only raised forms that turn toward the
 * light glint: brow, nose, cheekbones, lips and chin. */
function faceGlint(x: number, y: number, jaw: number): number {
  const [u, v] = headLocal(x, y);
  const step = 0.012;
  const dx = (faceHeight(u + step, v, jaw) - faceHeight(u - step, v, jaw)) / (2 * step);
  const dy =
    ((faceHeight(u, v + step, jaw) - faceHeight(u, v - step, jaw)) / (2 * step)) *
    (HEAD_RX / HEAD_RY);
  const length = Math.hypot(dx, dy, 1);
  const lambert = Math.max(0, (-dx * LIGHT[0] - dy * LIGHT[1] + LIGHT[2]) / length);
  faceRelief(u, v, jaw);
  const ridge = clamp01(reliefRaised * 9 - reliefCavity * 4);
  return clamp01(ridge * lambert ** 2) ** 1.5;
}

/** Outward direction of the silhouette at a point, for rim lighting. */
function outlineUp(x: number, y: number): number {
  const step = 0.004;
  const dx = silhouetteDistance(x + step, y) - silhouetteDistance(x - step, y);
  const dy = silhouetteDistance(x, y + step) - silhouetteDistance(x, y - step);
  const length = Math.hypot(dx, dy) || 1;
  // 1 where the outline faces up and toward the backlight, 0 where it faces down.
  return clamp01(0.5 - (0.5 * (dy * 0.85 - dx * 0.35)) / length);
}

type Grid = {
  tier: number;
  font: number;
  stepX: number;
  stepY: number;
  left: number;
  top: number;
  cols: number;
  rows: number;
  firstColumn: number;
};

/**
 * A figure made of falling code. Nothing is drawn at rest: while the AI replies the figure
 * kindles from the head outward, streams fall through or behind it and the mouth moves with the
 * reply. When it ends the figure fades back into the plain background.
 */
function createCodeFigureScene(
  palette: LiveBackgroundPalette,
  style: FigureStyle,
): LiveBackgroundScene {
  const config = STYLES[style];
  let width = 0;
  let height = 0;
  const fonts = [MIN_FONT, MIN_FONT, MIN_FONT];
  const fontStrings = ["", "", ""];
  let columns: Column[] = [];
  // Flat per-cell arrays: the frame loop allocates nothing.
  let cellX = new Float32Array(0);
  let cellY = new Float32Array(0);
  let cellCol = new Uint16Array(0);
  let cellRow = new Uint16Array(0);
  let cellTier = new Uint8Array(0);
  /** Static glow with the jaw closed and fully open, and how much passing streams add. */
  let cellBody = new Float32Array(0);
  let cellBodyOpen = new Float32Array(0);
  let cellGain = new Float32Array(0);
  /** Body brighter than this is a highlight and burns in the accent color. */
  let cellSpark = new Float32Array(0);
  let cellPool = new Uint8Array(0);
  let cellReveal = new Float32Array(0);
  let cellGlow = new Float32Array(0);
  let cellAccent = new Uint8Array(0);
  let cellAlpha = new Float32Array(0);
  /** Draw order bucketed by pass and alpha level, rebuilt each frame without allocation. */
  let order = new Uint32Array(0);
  const bucketStart = new Uint32Array(GROUPS * (ALPHA_LEVELS + 1) + 1);
  const bucketFill = new Uint32Array(GROUPS * (ALPHA_LEVELS + 1));
  let cellBucket = new Uint16Array(0);
  let count = 0;
  /** Stream travel added by reply energy, so speed changes never make the streams jump. */
  let rush = 0;

  const push = (
    grid: Grid,
    col: number,
    row: number,
    body: number,
    bodyOpen: number,
    gain: number,
    spark: number,
    reveal: number,
    pool: number,
  ) => {
    cellX[count] = grid.left + (col + 0.5) * grid.stepX;
    cellY[count] = grid.top + (row + 0.5) * grid.stepY;
    cellCol[count] = grid.firstColumn + col;
    cellRow[count] = row;
    cellTier[count] = grid.tier;
    cellBody[count] = body;
    cellBodyOpen[count] = bodyOpen;
    cellGain[count] = gain;
    cellSpark[count] = spark;
    cellReveal[count] = reveal;
    cellPool[count] = pool;
    count++;
  };

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(0, nextWidth);
      height = Math.max(0, nextHeight);
      count = 0;
      columns = [];
      rush = 0;
      if (width < 2 || height < 2) return;

      // The head starts near the top and the shoulders leave through the bottom edge.
      const scale = Math.min(height / config.headShare, width / 1.6);
      const centerX = width / 2;
      const centerY = height * 0.08 + 0.96 * scale;
      const bottom = (height - centerY) / scale;
      const eclipse = style === "eclipse";
      const toX = (px: number) => (px - centerX) / scale;
      const toY = (py: number) => (py - centerY) / scale;

      // Grid geometry first, so every per-cell array is allocated once.
      const grids: Grid[] = [];
      const addGrid = (
        tier: number,
        left: number,
        top: number,
        right: number,
        speed: number,
        trail: number,
      ) => {
        left = Math.max(0, left);
        right = Math.min(width, right);
        top = Math.max(0, top);
        const area = (right - left) * (height - top);
        if (area <= 0) return;
        const [cellWidth, cellHeight] = tier === FIGURE ? config.figureCell : RAIN_CELL;
        const font = Math.max(
          MIN_FONT,
          scale * config.fontShare[tier]!,
          Math.sqrt(area / (config.maxCells[tier]! * cellWidth * cellHeight)),
        );
        const stepX = font * cellWidth;
        const stepY = font * cellHeight;
        const cols = Math.max(1, Math.floor((right - left) / stepX));
        const rows = Math.max(1, Math.floor((height - top) / stepY));
        const grid: Grid = {
          tier,
          font,
          stepX,
          stepY,
          left: left + (right - left - cols * stepX) / 2,
          top,
          cols,
          rows,
          firstColumn: columns.length,
        };
        for (let col = 0; col < cols; col++) {
          const id = columns.length;
          const length = trail * (0.6 + hash(id, 11) * 0.9);
          const period = rows + length + Math.floor(hash(id, 13) * rows * 0.9);
          columns.push({
            speed: speed * (0.65 + hash(id, 17) * 0.7),
            offset: hash(id, 19) * period,
            trail: length,
            period,
          });
        }
        fonts[tier] = font;
        fontStrings[tier] =
          `${tier === FIGURE && eclipse ? "500 " : ""}${font}px ${palette.monoFont}`;
        grids.push(grid);
      };

      const figureLeft = centerX - 1.42 * scale;
      const figureRight = centerX + 1.42 * scale;
      const figureTop = centerY - 1.04 * scale;
      if (eclipse) {
        addGrid(FAR, 0, 0, width, 7, 22);
        addGrid(FIGURE, figureLeft, figureTop, figureRight, 0, 1);
        addGrid(NEAR, 0, 0, width, 13, 14);
      } else {
        addGrid(FAR, centerX - 1.7 * scale, centerY - 1.4 * scale, centerX + 1.7 * scale, 6, 16);
        addGrid(FIGURE, figureLeft, figureTop, figureRight, 9, 18);
      }

      const capacity = grids.reduce((sum, grid) => sum + grid.cols * grid.rows, 0);
      cellX = new Float32Array(capacity);
      cellY = new Float32Array(capacity);
      cellCol = new Uint16Array(capacity);
      cellRow = new Uint16Array(capacity);
      cellTier = new Uint8Array(capacity);
      cellBody = new Float32Array(capacity);
      cellBodyOpen = new Float32Array(capacity);
      cellGain = new Float32Array(capacity);
      cellSpark = new Float32Array(capacity);
      cellPool = new Uint8Array(capacity);
      cellReveal = new Float32Array(capacity);
      cellGlow = new Float32Array(capacity);
      cellAccent = new Uint8Array(capacity);
      cellAlpha = new Float32Array(capacity);
      cellBucket = new Uint16Array(capacity);
      order = new Uint32Array(capacity);

      // Pane vignette for the eclipse field: light gathers behind the figure and falls off
      // toward the corners.
      const vignette = (px: number, py: number) =>
        smoothstep(
          1.08,
          0.3,
          Math.hypot((px - centerX) / (width * 0.62), (py - height * 0.42) / (height * 0.78)),
        );

      for (const grid of grids) {
        const { stepX, stepY } = grid;
        // Half a cell in scale units: glyphs closer than this to the outline would cross it.
        const halfCell = (0.5 * Math.hypot(stepX, stepY)) / scale;
        for (let row = 0; row < grid.rows; row++) {
          const py = grid.top + (row + 0.5) * stepY;
          const y = toY(py);
          const fade = smoothstep(bottom + 0.02, bottom - 0.42, y);
          for (let col = 0; col < grid.cols; col++) {
            const px = grid.left + (col + 0.5) * stepX;
            const x = toX(px);
            const distance = silhouetteDistance(x, y);
            const columnId = grid.firstColumn + col;
            // Kindling spreads from behind the head outward, scattered like embers catching.
            const radial = clamp01(Math.hypot(x, (y - HEAD_Y) * 0.9) / 1.5);
            const reveal = hash(columnId, row, 7) * 0.55 + radial * 0.45;

            if (eclipse) {
              if (grid.tier === FIGURE) {
                if (distance >= 0) continue;
                // A thin rim of backlight traces the outline; the face shows only glints.
                const rim =
                  Math.exp(distance / 0.013) * (0.3 + 0.7 * outlineUp(x, y)) * (0.35 + 0.65 * fade);
                const onFace = smoothstep(0.02, -0.04, headDistance(x, y));
                const closed = onFace > 0 ? onFace * faceGlint(x, y, 0) : 0;
                const open = onFace > 0 ? onFace * faceGlint(x, y, 1) : 0;
                const rimAlpha = Math.min(1, rim * 1.2);
                const body = Math.max(rimAlpha, closed * 0.85);
                const bodyOpen = Math.max(rimAlpha, open * 0.85);
                if (Math.max(body, bodyOpen) < 0.05) continue;
                // Fine dots and ticks: a contour of light, not a line of text.
                push(grid, col, row, body, bodyOpen, 0, 0.42, reveal, 0);
                continue;
              }
              // The field never crosses the figure: it is blocked, not dimmed.
              if (distance < halfCell) continue;
              const light = vignette(px, py);
              // Backlight: a broad halo around the head plus a tight band hugging the outline.
              const halo =
                0.55 * Math.exp(-Math.hypot(x, (y - HEAD_Y) * 0.85) / 0.85) +
                0.45 * Math.exp(-distance / 0.3);
              const band = Math.exp(-(distance - halfCell) / 0.045);
              if (grid.tier === NEAR) {
                // Only a few near streams, large and bright, give the field depth.
                if (hash(columnId, 29) > 0.3) continue;
                const gain = (0.35 + 0.55 * halo) * light;
                if (gain < 0.06) continue;
                push(grid, col, row, 0, 0, gain, 2, reveal, CODE);
                continue;
              }
              const gain = (0.22 + 0.78 * halo) * light;
              // The corona: static glyphs hugging the outline, so the edge reads between streams.
              const corona = hash(columnId, row, 53) < band ? 1 : 0.4;
              const body = 0.8 * band * (0.45 + 0.55 * light) * corona;
              if (gain < 0.05 && body < 0.04) continue;
              push(grid, col, row, body, body, gain, 2, reveal, body > 0.25 ? DENSE : CODE);
              continue;
            }

            if (grid.tier === FAR) {
              // Faint rain gathers around the figure and thins with distance from it.
              if (distance < halfCell || distance > 0.6) continue;
              const gain = 0.4 * Math.exp(-distance / 0.2) * fade;
              if (gain < 0.045) continue;
              push(grid, col, row, 0, 0, gain, 2, reveal, CODE);
              continue;
            }

            // The luminous figure: a lit sculpture whose surface is code.
            if (distance > halfCell * 0.35) continue;
            const coverage = smoothstep(halfCell * 0.35, -halfCell * 0.6, distance);
            // The bust dissolves into its own falling streams toward the bottom and the sides.
            const solid = fade * smoothstep(1.2, 0.72, Math.abs(x));
            // Under the chin the neck falls into shadow, so the jaw line reads.
            const outsideHead = headDistance(x, y);
            const chin =
              outsideHead > 0 && y > HEAD_Y + 0.3
                ? 0.25 + 0.75 * smoothstep(0, 0.18, outsideHead)
                : 1;
            shadeBust(x, y, 0);
            const closed = chin * litTone();
            let open = closed;
            if (outsideHead < 0.02) {
              shadeBust(x, y, 1);
              open = chin * litTone();
            }
            // Ordered dither: shadows thin out instead of filling with dim glyphs.
            const lit = Math.max(closed, open) > hash(columnId, row, 41) * 0.22;
            // A settled glow carries the form; the streams falling through it carry the light.
            const body = lit ? coverage * solid * closed * 0.75 : 0;
            const bodyOpen = lit ? coverage * solid * open * 0.75 : 0;
            const gain = (0.4 + 0.6 * closed) * coverage * Math.max(0.3, fade);
            if (Math.max(body, bodyOpen) + gain < 0.04) continue;
            const pool = closed > 0.55 ? DENSE : closed > 0.22 ? 1 : 0;
            push(grid, col, row, body, bodyOpen, gain, 0.58, reveal, pool);
          }
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
      const level = (0.35 + 0.65 * presence) * (0.9 + 0.1 * energy);
      const kindle = presence * 1.25;
      const mouth = mouthOpening(time, presence, energy);

      for (let i = 0; i < count; i++) {
        cellAlpha[i] = 0;
        cellGlow[i] = 0;
        cellAccent[i] = 0;
        const reveal = smoothstep(cellReveal[i]!, cellReveal[i]! + 0.2, kindle);
        if (reveal === 0) continue;
        const gain = cellGain[i]!;
        let stream = 0;
        if (gain > 0) {
          const column = columns[cellCol[i]!]!;
          const head = (column.offset + time * column.speed + rush) % column.period;
          stream = trailAt(head, cellRow[i]!, column.trail);
        }
        const body = cellBody[i]! + (cellBodyOpen[i]! - cellBody[i]!) * mouth;
        cellAlpha[i] = reveal * level * Math.min(1, body + gain * stream);
        // Stream heads and the brightest highlights burn in the accent color.
        cellGlow[i] = stream;
        cellAccent[i] = stream > HEAD_GLOW || body > cellSpark[i]! ? 1 : 0;
      }

      // Counting sort by pass and alpha level: one fill style and alpha change per bucket.
      const levels = ALPHA_LEVELS + 1;
      bucketFill.fill(0);
      for (let i = 0; i < count; i++) {
        const quantized = Math.round(cellAlpha[i]! * ALPHA_LEVELS);
        const group = cellTier[i]! * 2 + cellAccent[i]!;
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
      // Back to front: far rain, the figure, near rain; each in the content color, then its
      // heads and highlights in the accent color.
      for (let group = 0; group < GROUPS; group++) {
        if (bucketStart[group * levels] === bucketStart[(group + 1) * levels]) continue;
        const tier = group >> 1;
        ctx.font = fontStrings[tier]!;
        ctx.fillStyle = group % 2 === 1 ? palette.accent : palette.content;
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
            const glow = cellGlow[i]!;
            const rate = 0.25 + hash(col, row, 3) * 0.8 + glow * 9;
            const [start, length] = POOLS[glow > HEAD_GLOW ? DENSE : cellPool[i]!]!;
            const index = start + Math.floor(hash(col, row, Math.floor(time * rate)) * length);
            ctx.fillText(GLYPHS[index]!, cellX[i]!, cellY[i]!);
          }
        }
      }
      ctx.restore();
    },
  };
}

/** A luminous figure of code: a lit sculpture whose surface is falling code, condensing out of
 * faint rain while the AI replies. */
export function createLatentFaceScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  return createCodeFigureScene(palette, "luminous");
}

/** A dark figure in front of layered, backlit code rain: it blocks the code behind it and only
 * its rim and the ridges of its face catch the light. */
export function createCodeVisageScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  return createCodeFigureScene(palette, "eclipse");
}
