import { ASCII_MASK_ART } from "./asciiMaskArt";
import { accentInk } from "./dotGrid";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** Glyph cell: 0.62em wide, 1.3em tall. */
const CELL_WIDTH = 0.62;
const CELL_HEIGHT = 1.3;
/** Same cap the host canvas uses for its backing store. */
const MAX_PIXEL_RATIO = 1.5;
/** The figure fills this share of the pane height, but glyphs never shrink below the minimum:
 * a very narrow pane crops the figure instead of making it unreadable. */
const MASK_HEIGHT_SHARE = 0.78;
const MIN_MASK_FONT = 6;
/** The scene sits behind the conversation, so its layers are blitted well below full strength. */
const BACKGROUND_ALPHA = 0.6;
const MASK_ALPHA = 0.9;
/** The core pulses only once the reply is clearly under way. */
const SPEAK_THRESHOLD = 0.6;
const SYLLABLES_PER_SECOND = 3.5;
/** Presence is quantized so a slow fade repaints in a bounded number of steps. */
const PRESENCE_STEPS = 24;
/** Share of the room's light removed behind the figure, so surfacing glyphs never double up. */
const VEIL_STRENGTH = 0.9;
/** Glyph alpha is quantized so each layer changes canvas state a bounded number of times. */
const ALPHA_LEVELS = 14;
/** At rest the core is a dim ghost at this share of its full tone, like a sleeping machine. */
const GHOST = 0.45;

const ART = ASCII_MASK_ART;
/** Solid figure cells show at least this ramp step, the room at most this one, so the machine
 * stays a distinct texture instead of melting into its own glow. */
const FIGURE_FLOOR = 4;
const BACKGROUND_TOP = 3;
const RAMP = ART.ramp;
const COLS = ART.mask.cols;
const ROWS = ART.mask.rows;
const GRID_WIDTH = COLS * CELL_WIDTH;
const GRID_HEIGHT = ROWS * CELL_HEIGHT;

/** The figure is an AI core seen head on: a glowing lens inside orbit rings and a HUD scale.
 * World units: y up, the lens centered; the grid shows WORLD_SPAN vertically from WORLD_TOP. */
const WORLD_TOP = 1;
const WORLD_SPAN = 2;
const EM = WORLD_SPAN / GRID_HEIGHT;
const worldX = (col: number) => ((col + 0.5) * CELL_WIDTH - GRID_WIDTH / 2) * EM;
const worldY = (row: number) => WORLD_TOP - (row + 0.5) * CELL_HEIGHT * EM;

type MouthName = keyof typeof ART.mouths;
type MouthPose = (typeof ART.mouths)[MouthName];
const MOUTH_NAMES = Object.keys(ART.mouths) as MouthName[];
const VOWELS: readonly MouthName[] = ["half", "open", "open", "round", "wide", "half", "round"];

/** A drawing surface the scene renders into once and then only blits from. */
type Layer = OffscreenCanvas | HTMLCanvasElement;
type LayerContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
export type LayerFactory = (width: number, height: number) => Layer;

const defaultLayerFactory: LayerFactory = (width, height) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

type Layers = {
  ratio: number;
  background: Layer;
  veil: Layer;
  mask: Layer;
  mouths: Layer[];
};
type Layout = {
  fontSize: number;
  /** Figure rectangle and the pulsing lens patch inside it, in CSS pixels. */
  maskX: number;
  maskY: number;
  maskWidth: number;
  maskHeight: number;
  mouthX: number;
  mouthY: number;
  mouthWidth: number;
  mouthHeight: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** Integer hash: the vowel sequence is fixed for a given time, never random per frame. */
function hash(value: number): number {
  let h = Math.imul(value + 0x9e3779b9, 374761393);
  h = Math.imul(h ^ (h >>> 15), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
const noise = (col: number, row: number) => hash(col * 7919 + row * 104729) / 4294967296;

/** The core's pulse state ("mouth" pose) is a pure function of `time` and presence: at rest
 * unless the reply is under way, then a speech-like rhythm of swells, holds and short dips. */
export function asciiMouthAt(time: number, presence: number): MouthName {
  if (presence <= SPEAK_THRESHOLD) return "closed";
  const beat = time * SYLLABLES_PER_SECOND;
  const syllable = Math.floor(beat);
  const phase = beat - syllable;
  const seed = hash(syllable);
  const kind = seed % 16;
  if (kind === 0) return "closed";
  if (phase < 0.2) return kind <= 3 ? "press" : "slight";
  if (phase >= 0.8) return "slight";
  return VOWELS[(seed >>> 8) % VOWELS.length]!;
}

// ---------------------------------------------------------------------------------------------
// The AI core: a glass lens with a light inside, a machined bezel, orbit rings and a HUD scale.

/** Lens radius in world units; the rings and scale are sized from it. */
const LENS = 0.36;
const COL_W = CELL_WIDTH * EM;
const ROW_H = CELL_HEIGHT * EM;
/** Orbit rings: ellipses seen at an angle; their near half passes in front of the lens. */
const RINGS = [
  { a: 0.9, b: 0.2, tilt: 0.28, dashes: 0, data: true, tone: 0.5 },
  { a: 0.74, b: 0.36, tilt: -0.46, dashes: 40, data: false, tone: 0.34 },
] as const;
const SCALE_RADIUS = 0.58;
const HEX = "0123456789ABCDEF";

/** Shaded cells of the figure: tone 0..1 (-1 off the figure), how much of the cell the figure
 * covers, whether the core's light colors it, how bright the bloom is just outside it, and an
 * optional fixed glyph (line art) instead of the luminance ramp. */
type Shading = {
  tone: Float32Array;
  cover: Float32Array;
  accent: Uint8Array;
  halo: Float32Array;
  glyph: Uint16Array;
};

/** The lens: dark glass around a light that breathes with the pose. */
function lensTone(x: number, y: number, s: number, pose: MouthPose) {
  const { open, width, press } = pose;
  const power = (0.42 + 0.58 * open) * (1 - 0.35 * press);
  const pupil = (0.13 + 0.05 * open) * width * (1 - 0.25 * press);
  const angle = Math.atan2(y, x);
  // The light fills the lens like a lamp behind glass: a white-hot center, a broad glow and
  // fine radial filaments that catch it.
  const glow = Math.exp(-((s / (0.85 * width)) ** 2));
  const filaments = smoothstep(0.18, 0.4, s) * (0.5 + 0.5 * Math.cos(angle * 32 + s * 7));
  const hot = Math.exp(-((s / pupil) ** 2));
  const light = clamp01(
    glow * (0.55 + 0.45 * power) * (0.95 - 0.3 * filaments) + hot * (0.3 + 0.4 * power),
  );
  // A window reflection on the glass, upper left, and a darker fresnel edge.
  const reflection = Math.exp(-(((x / LENS + 0.36) / 0.2) ** 2) - ((y / LENS - 0.42) / 0.12) ** 2);
  const glass = 0.06 + 0.22 * s ** 6 + 0.75 * reflection;
  return light > glass ? { tone: light, accent: true } : { tone: glass, accent: false };
}

function shadeCells(cols: number, rows: number, col0: number, row0: number, pose: MouthPose) {
  const shading: Shading = {
    tone: new Float32Array(cols * rows),
    cover: new Float32Array(cols * rows),
    accent: new Uint8Array(cols * rows),
    halo: new Float32Array(cols * rows),
    glyph: new Uint16Array(cols * rows),
  };
  for (let row = 0; row < rows; row++) {
    const y = worldY(row0 + row);
    for (let col = 0; col < cols; col++) {
      const x = worldX(col0 + col);
      const index = row * cols + col;
      const r = Math.hypot(x, y);
      const s = r / LENS;
      let tone = -1;
      let accent = false;
      let glyph = 0;
      if (s < 1) {
        const lens = lensTone(x, y, s, pose);
        tone = lens.tone;
        accent = lens.accent;
      } else if (s < 1.13) {
        // Machined bezel: lit from the upper left, darker toward the lower right.
        const facing = (-x * 0.6 + y * 0.8) / r;
        tone = 0.34 + 0.4 * (0.5 + 0.5 * facing) + 0.2 * Math.exp(-(((s - 1.05) / 0.03) ** 2));
      } else if (s >= 1.22 && s < 1.32) {
        // Outer housing: a faint segmented ring.
        const segment = (Math.atan2(y, x) / (2 * Math.PI)) * 24;
        if (segment - Math.floor(segment) < 0.78) tone = 0.16;
      }
      // HUD scale: fine ticks around the core, brighter at the quarters.
      const gx = r > 0 ? x / r : 0;
      const gy = r > 0 ? y / r : 0;
      const scaleDistance = Math.abs(r - SCALE_RADIUS) / Math.hypot(gx * COL_W, gy * ROW_H);
      if (scaleDistance < 0.55) {
        const turn = Math.atan2(y, x) / (2 * Math.PI) + 1;
        const tick = (turn * 72) % 1;
        const quarter = (turn * 4) % 1;
        if (quarter < 0.03 || quarter > 0.97) {
          tone = Math.max(tone, 0.5);
          glyph = 43; // "+"
        } else if (tick < 0.24) {
          tone = Math.max(tone, 0.24);
        }
      }
      // Orbit rings, drawn as line art; the far half hides behind the lens.
      for (const ring of RINGS) {
        const c = Math.cos(ring.tilt);
        const n = Math.sin(ring.tilt);
        const u = c * x + n * y;
        const v = -n * x + c * y;
        const f = (u / ring.a) ** 2 + (v / ring.b) ** 2 - 1;
        const fu = (2 * u) / ring.a ** 2;
        const fv = (2 * v) / ring.b ** 2;
        const fx = fu * c - fv * n;
        const fy = fu * n + fv * c;
        const distance = Math.abs(f) / Math.hypot(fx * COL_W, fy * ROW_H);
        if (distance >= 0.55) continue;
        const near = v < 0;
        if (!near && s < 1.35) continue;
        const theta = Math.atan2(v / ring.b, u / ring.a) / (2 * Math.PI) + 1;
        if (ring.dashes && (theta * ring.dashes) % 1 > 0.62) continue;
        const ringTone = ring.tone * (near ? 1 : 0.45);
        if (tone >= 0 && ringTone <= tone) continue;
        tone = ringTone;
        accent = false;
        glyph = 0;
        // A few cells carry data, like a readout travelling around the orbit.
        if (ring.data && near && noise(col0 + col, row0 + row) < 0.14) {
          glyph = HEX.charCodeAt(Math.floor(noise(row0 + row, col0 + col) * 16));
          tone = Math.min(1, ringTone + 0.2);
        }
      }
      shading.tone[index] = tone < 0 ? -1 : clamp01(tone);
      shading.cover[index] = tone < 0 ? 0 : 1;
      shading.accent[index] = accent ? 1 : 0;
      shading.glyph[index] = glyph;
      // The core's light blooms into the room around it.
      shading.halo[index] = tone < 0 ? Math.exp(-Math.max(0, s - 1.13) / 1.4) : 0;
    }
  }
  return shading;
}

/** Cells that change with the core's pulse: the lens, plus a margin. Every pose is rendered for
 * this box only, so the patches meet the figure cleanly. */
const MOUTH_BOX = (() => {
  const reach = LENS * 1.02;
  const col = Math.floor((-reach / EM + GRID_WIDTH / 2) / CELL_WIDTH - 0.5) - 1;
  const lastCol = Math.ceil((reach / EM + GRID_WIDTH / 2) / CELL_WIDTH - 0.5) + 1;
  const row = Math.floor((WORLD_TOP - reach) / ROW_H - 0.5) - 1;
  const lastRow = Math.ceil((WORLD_TOP + reach) / ROW_H - 0.5) + 1;
  return { col, row, cols: lastCol - col + 1, rows: lastRow - row + 1 };
})();

type Model = { figure: Shading; mouths: Shading[] };
let model: Model | null = null;
/** The figure does not depend on the palette or the pane: it is shaded once per session. */
function figureModel(): Model {
  if (model) return model;
  const box = MOUTH_BOX;
  model = {
    figure: shadeCells(COLS, ROWS, 0, 0, ART.mouths.closed),
    mouths: MOUTH_NAMES.map((name) =>
      shadeCells(box.cols, box.rows, box.col, box.row, ART.mouths[name]),
    ),
  };
  return model;
}

/** Glyph index on the ramp; anything solidly on the figure shows at least the faintest mark. */
const rampIndex = (tone: number, floor: number) =>
  Math.max(floor, Math.min(RAMP.length - 1, Math.round(tone * (RAMP.length - 1))));
const glyphAlpha = (tone: number) => 0.24 + 0.76 * tone ** 0.8;

/** Glyph batches keyed by color and alpha level, so a layer changes state once per batch. */
type Batch = { x: number[]; y: number[]; chars: string[] };
function createBatches(): Batch[] {
  return Array.from({ length: 2 * (ALPHA_LEVELS + 1) }, () => ({ x: [], y: [], chars: [] }));
}
function addGlyph(
  batches: Batch[],
  accent: boolean,
  alpha: number,
  char: string,
  x: number,
  y: number,
) {
  const level = Math.round(clamp01(alpha) * ALPHA_LEVELS);
  if (level === 0 || char === " ") return;
  const batch = batches[(accent ? ALPHA_LEVELS + 1 : 0) + level]!;
  batch.x.push(x);
  batch.y.push(y);
  batch.chars.push(char);
}
function paintBatches(
  ctx: LayerContext,
  batches: Batch[],
  fontSize: number,
  palette: LiveBackgroundPalette,
  accent = palette.accent,
) {
  ctx.font = `${fontSize}px ${palette.monoFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  batches.forEach((batch, index) => {
    if (batch.chars.length === 0) return;
    ctx.fillStyle = index > ALPHA_LEVELS ? accent : palette.content;
    ctx.globalAlpha = (index % (ALPHA_LEVELS + 1)) / ALPHA_LEVELS;
    for (let i = 0; i < batch.chars.length; i++)
      ctx.fillText(batch.chars[i]!, batch.x[i]!, batch.y[i]!);
  });
  ctx.globalAlpha = 1;
}

/** Adds one shaded figure cell; `scale` dims it (the ghost at rest). */
function addFigureGlyph(
  batches: Batch[],
  shading: Shading,
  index: number,
  scale: number,
  x: number,
  y: number,
) {
  const tone = shading.tone[index]!;
  const cover = shading.cover[index]!;
  if (tone < 0 || cover <= 0.02) return;
  const fixed = shading.glyph[index]!;
  addGlyph(
    batches,
    shading.accent[index] === 1,
    glyphAlpha(tone) * cover * scale,
    fixed ? String.fromCharCode(fixed) : RAMP[rampIndex(tone, cover > 0.5 ? FIGURE_FLOOR : 0)]!,
    x,
    y,
  );
}

function createLayout(width: number, height: number): Layout | null {
  if (width < 2 || height < 2) return null;
  const fontSize = Math.max(
    MIN_MASK_FONT,
    Math.min((height * MASK_HEIGHT_SHARE) / GRID_HEIGHT, width / GRID_WIDTH),
  );
  const maskWidth = GRID_WIDTH * fontSize;
  const maskHeight = GRID_HEIGHT * fontSize;
  const maskX = (width - maskWidth) / 2;
  const maskY = (height - maskHeight) / 2;
  const box = MOUTH_BOX;
  return {
    fontSize,
    maskX,
    maskY,
    maskWidth,
    maskHeight,
    mouthX: maskX + box.col * fontSize * CELL_WIDTH,
    mouthY: maskY + box.row * fontSize * CELL_HEIGHT,
    mouthWidth: box.cols * fontSize * CELL_WIDTH,
    mouthHeight: box.rows * fontSize * CELL_HEIGHT,
  };
}

const inMouthBox = (col: number, row: number) => {
  const box = MOUTH_BOX;
  return col >= box.col && col < box.col + box.cols && row >= box.row && row < box.row + box.rows;
};

export function createAsciiMaskScene(
  palette: LiveBackgroundPalette,
  createLayer: LayerFactory = defaultLayerFactory,
): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let layout: Layout | null = null;
  let layers: Layers | null = null;
  /** The pixels last painted: unchanged inputs mean the canvas is left alone. */
  let painted: number | null = null;
  /** A pale accent on a light theme (or a dark one on a dark theme) falls back to content. */
  const eyeInk = accentInk(palette).color;

  const release = () => {
    if (!layers) return;
    for (const layer of [layers.background, layers.veil, layers.mask, ...layers.mouths]) {
      layer.width = 0;
      layer.height = 0;
    }
    layers = null;
  };

  const surfaceLayer = (cssWidth: number, cssHeight: number, ratio: number) => {
    const layer = createLayer(
      Math.max(1, Math.ceil(cssWidth * ratio)),
      Math.max(1, Math.ceil(cssHeight * ratio)),
    );
    const ctx = layer.getContext("2d") as LayerContext | null;
    ctx?.scale(ratio, ratio);
    return { layer, ctx };
  };

  /** Renders every glyph exactly once; draw() only blits these afterwards. */
  const build = (ratio: number) => {
    release();
    if (!layout) return;
    const { fontSize, maskX, maskY } = layout;
    const cellWidth = fontSize * CELL_WIDTH;
    const cellHeight = fontSize * CELL_HEIGHT;
    const { figure, mouths: mouthShading } = figureModel();

    // The room: the core's light falls on it, drawn on the figure's own grid so the ghost at rest
    // and the surfaced figure share every glyph position.
    const background = surfaceLayer(width, height, ratio);
    if (background.ctx) {
      const batches = createBatches();
      const firstCol = Math.floor(-maskX / cellWidth);
      const lastCol = Math.ceil((width - maskX) / cellWidth);
      const firstRow = Math.floor(-maskY / cellHeight);
      const lastRow = Math.ceil((height - maskY) / cellHeight);
      for (let row = firstRow; row < lastRow; row++) {
        const v = worldY(row);
        const y = maskY + (row + 0.5) * cellHeight;
        for (let col = firstCol; col < lastCol; col++) {
          const u = worldX(col);
          const x = maskX + (col + 0.5) * cellWidth;
          const inGrid = col >= 0 && col < COLS && row >= 0 && row < ROWS;
          const index = row * COLS + col;
          let behind = 1;
          let halo = 0;
          if (inGrid) {
            const cover = figure.tone[index]! >= 0 ? figure.cover[index]! : 0;
            if (cover > 0.5) {
              addFigureGlyph(batches, figure, index, GHOST, x, y);
              continue;
            }
            behind = 1 - cover;
            halo = figure.halo[index]!;
          }
          // The room around the core: its light blooms outward and fades long before the pane
          // edges. The room only uses the faintest marks, so every denser glyph is the machine.
          const spread = (u / 1.3) ** 2 + (v / 1.05) ** 2;
          const light =
            (0.2 * Math.exp(-1.4 * spread) + 0.22 * halo + (noise(col, row) - 0.5) * 0.06) *
            behind;
          const level = Math.min(BACKGROUND_TOP, rampIndex(light, 0));
          if (level === 0) continue;
          addGlyph(batches, false, 0.1 + 0.9 * light, RAMP[level]!, x, y);
        }
      }
      paintBatches(background.ctx, batches, fontSize, palette, eyeInk);
    }

    // Alpha-only veil, removed from the backlight beneath the figure; carries no color of its own.
    const veil = surfaceLayer(width, height, ratio);
    if (veil.ctx) {
      veil.ctx.fillStyle = palette.content;
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const index = row * COLS + col;
          if (figure.tone[index]! < 0) continue;
          const cover = figure.cover[index]!;
          if (cover <= 0.02) continue;
          veil.ctx.globalAlpha = cover;
          veil.ctx.fillRect(
            maskX + col * cellWidth,
            maskY + row * cellHeight,
            cellWidth + 0.5,
            cellHeight + 0.5,
          );
        }
      }
      veil.ctx.globalAlpha = 1;
    }

    const mask = surfaceLayer(layout.maskWidth, layout.maskHeight, ratio);
    if (mask.ctx) {
      const batches = createBatches();
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          if (inMouthBox(col, row)) continue;
          addFigureGlyph(
            batches,
            figure,
            row * COLS + col,
            1,
            (col + 0.5) * cellWidth,
            (row + 0.5) * cellHeight,
          );
        }
      }
      paintBatches(mask.ctx, batches, fontSize, palette, eyeInk);
    }

    const box = MOUTH_BOX;
    const mouths = mouthShading.map((shading) => {
      const patch = surfaceLayer(layout!.mouthWidth, layout!.mouthHeight, ratio);
      if (patch.ctx) {
        const batches = createBatches();
        for (let row = 0; row < box.rows; row++) {
          for (let col = 0; col < box.cols; col++) {
            addFigureGlyph(
              batches,
              shading,
              row * box.cols + col,
              1,
              (col + 0.5) * cellWidth,
              (row + 0.5) * cellHeight,
            );
          }
        }
        paintBatches(patch.ctx, batches, fontSize, palette, eyeInk);
      }
      return patch.layer;
    });
    layers = { ratio, background: background.layer, veil: veil.layer, mask: mask.layer, mouths };
  };

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(0, nextWidth);
      height = Math.max(0, nextHeight);
      layout = createLayout(width, height);
      // The host reassigns the canvas size, which wipes it: the next draw must paint.
      painted = null;
      release();
    },
    draw(ctx, time, _delta, signal) {
      if (!layout) return;
      const presence = Math.max(0, Math.min(1, signal.presence));
      const steps = Math.round(presence * PRESENCE_STEPS);
      const mouth = steps === 0 ? "closed" : asciiMouthAt(time, presence);
      const key = steps * MOUTH_NAMES.length + MOUTH_NAMES.indexOf(mouth);
      if (key === painted && layers) return;

      // The host's transform carries its (capped) pixel ratio: render layers at the same one.
      const scale = ctx.getTransform?.().a;
      const ratio = Math.min(
        scale && Number.isFinite(scale) && scale > 0 ? scale : 1,
        MAX_PIXEL_RATIO,
      );
      if (!layers || layers.ratio !== ratio) build(ratio);
      if (!layers) return;

      painted = key;
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.globalAlpha = BACKGROUND_ALPHA;
      ctx.drawImage(layers.background as CanvasImageSource, 0, 0, width, height);
      ctx.restore();
      if (steps === 0) return;
      // Eased, so the figure rises out of the ghost rather than switching on.
      const linear = steps / PRESENCE_STEPS;
      const alpha = linear * linear * (3 - 2 * linear);
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = alpha * VEIL_STRENGTH;
      ctx.drawImage(layers.veil as CanvasImageSource, 0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = alpha * MASK_ALPHA;
      ctx.drawImage(
        layers.mask as CanvasImageSource,
        layout.maskX,
        layout.maskY,
        layout.maskWidth,
        layout.maskHeight,
      );
      ctx.drawImage(
        layers.mouths[MOUTH_NAMES.indexOf(mouth)] as CanvasImageSource,
        layout.mouthX,
        layout.mouthY,
        layout.mouthWidth,
        layout.mouthHeight,
      );
      ctx.restore();
    },
    dispose() {
      release();
      painted = null;
    },
  };
}
