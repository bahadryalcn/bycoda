import { ASCII_MASK_ART } from "./asciiMaskArt";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** Glyph cell: 0.62em wide, 1.3em tall, matching the art's source preview. */
const CELL_WIDTH = 0.62;
const CELL_HEIGHT = 1.3;
/** Same cap the host canvas uses for its backing store. */
const MAX_PIXEL_RATIO = 1.5;
/** The mask fills this share of the pane height, but glyphs never shrink below the minimum:
 * a very narrow pane crops the mask instead of making it unreadable. */
const MASK_HEIGHT_SHARE = 0.78;
const MIN_MASK_FONT = 6;
/** The scene sits behind the conversation, so it is capped well below the art's own alphas. */
const BACKGROUND_ALPHA = 0.55;
const MASK_ALPHA = 0.85;
/** The mask is invisible at rest; it speaks only once the reply is clearly under way. */
const SPEAK_THRESHOLD = 0.6;
const SYLLABLES_PER_SECOND = 3.5;
/** Presence is quantized so a slow fade repaints in a bounded number of steps. */
const PRESENCE_STEPS = 24;
/** Share of the background removed behind the mask, so the glyphs stay legible. */
const VEIL_STRENGTH = 0.75;

type MouthName = keyof typeof ASCII_MASK_ART.mouths;
const MOUTH_NAMES: readonly MouthName[] = [
  "closed",
  "slight",
  "half",
  "open",
  "round",
  "wide",
  "press",
];
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

type Grid = { cols: number; rows: number; chars: readonly string[]; levels: readonly string[] };
type Layers = {
  ratio: number;
  background: Layer;
  veil: Layer;
  mask: Layer;
  mouths: Layer[];
};
type Layout = {
  fontSize: number;
  backgroundFont: number;
  /** Mask rectangle and mouth origin inside it, in CSS pixels. */
  maskX: number;
  maskY: number;
  maskWidth: number;
  maskHeight: number;
  mouthX: number;
  mouthY: number;
  mouthWidth: number;
  mouthHeight: number;
};

/** Integer hash: the vowel sequence is fixed for a given time, never random per frame. */
function hash(value: number): number {
  let h = Math.imul(value + 0x9e3779b9, 374761393);
  h = Math.imul(h ^ (h >>> 15), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The mouth is a pure function of `time` and presence: closed unless the reply is under way,
 * then a syllable rhythm of soft release, held vowel and release, with pauses and lip closures. */
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

function drawGrid(
  ctx: LayerContext,
  grid: Grid,
  fontSize: number,
  palette: LiveBackgroundPalette,
  originX: number,
  originY: number,
  clipWidth: number,
  clipHeight: number,
) {
  const cellWidth = fontSize * CELL_WIDTH;
  const cellHeight = fontSize * CELL_HEIGHT;
  ctx.font = `${fontSize}px ${palette.monoFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const alphas = ASCII_MASK_ART.alphas;
  // One style change per level code, not per glyph.
  for (const code of "abcdefABCDEF") {
    const accent = code < "a";
    const alpha = alphas[code.toLowerCase().charCodeAt(0) - 97];
    if (alpha === undefined) continue;
    ctx.fillStyle = accent ? palette.accent : palette.content;
    ctx.globalAlpha = alpha;
    for (let row = 0; row < grid.rows; row++) {
      const levels = grid.levels[row] ?? "";
      const chars = grid.chars[row] ?? "";
      const y = originY + (row + 0.5) * cellHeight;
      if (y < -cellHeight || y > clipHeight + cellHeight) continue;
      for (let col = 0; col < levels.length; col++) {
        if (levels[col] !== code) continue;
        const x = originX + (col + 0.5) * cellWidth;
        if (x < -cellWidth || x > clipWidth + cellWidth) continue;
        const char = chars[col];
        if (char && char !== " ") ctx.fillText(char, x, y);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function createLayout(width: number, height: number): Layout | null {
  if (width < 2 || height < 2) return null;
  const art = ASCII_MASK_ART;
  // The gradient covers the whole pane, centered; the mask sits in the middle, behind the text.
  const backgroundFont = Math.max(
    width / (art.background.cols * CELL_WIDTH),
    height / (art.background.rows * CELL_HEIGHT),
  );
  const fontSize = Math.max(
    MIN_MASK_FONT,
    Math.min(
      (height * MASK_HEIGHT_SHARE) / (art.mask.rows * CELL_HEIGHT),
      width / (art.mask.cols * CELL_WIDTH),
    ),
  );
  const maskWidth = art.mask.cols * fontSize * CELL_WIDTH;
  const maskHeight = art.mask.rows * fontSize * CELL_HEIGHT;
  const maskX = (width - maskWidth) / 2;
  const maskY = (height - maskHeight) / 2;
  const box = art.mouthBox;
  return {
    fontSize,
    backgroundFont,
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

  const release = () => {
    if (!layers) return;
    for (const layer of [layers.background, layers.veil, layers.mask, ...layers.mouths]) {
      layer.width = 0;
      layer.height = 0;
    }
    layers = null;
  };

  const surface = (cssWidth: number, cssHeight: number, ratio: number) => {
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
    const art = ASCII_MASK_ART;
    const background = surface(width, height, ratio);
    if (background.ctx) {
      const cols = art.background.cols * layout.backgroundFont * CELL_WIDTH;
      const rows = art.background.rows * layout.backgroundFont * CELL_HEIGHT;
      drawGrid(
        background.ctx,
        art.background,
        layout.backgroundFont,
        palette,
        (width - cols) / 2,
        (height - rows) / 2,
        width,
        height,
      );
    }
    // Alpha-only veil, removed from the background beneath the mask; carries no color of its own.
    const veil = surface(width, height, ratio);
    if (veil.ctx) {
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.max(layout.maskWidth, layout.maskHeight) / 2;
      const gradient = veil.ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.12);
      gradient.addColorStop(0, palette.content);
      gradient.addColorStop(1, "transparent");
      veil.ctx.fillStyle = gradient;
      veil.ctx.fillRect(0, 0, width, height);
    }
    const mask = surface(layout.maskWidth, layout.maskHeight, ratio);
    if (mask.ctx) {
      drawGrid(
        mask.ctx,
        art.mask,
        layout.fontSize,
        palette,
        0,
        0,
        layout.maskWidth,
        layout.maskHeight,
      );
    }
    const mouths = MOUTH_NAMES.map((name) => {
      const patch = surface(layout!.mouthWidth, layout!.mouthHeight, ratio);
      if (patch.ctx) {
        const grid: Grid = {
          cols: art.mouthBox.cols,
          rows: art.mouthBox.rows,
          ...art.mouths[name],
        };
        drawGrid(
          patch.ctx,
          grid,
          layout!.fontSize,
          palette,
          0,
          0,
          layout!.mouthWidth,
          layout!.mouthHeight,
        );
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
      const alpha = steps / PRESENCE_STEPS;
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
