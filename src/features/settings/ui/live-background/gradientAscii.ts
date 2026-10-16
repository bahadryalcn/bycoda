import { createMouthMask, SHADE_RAMP } from "./mouth";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** Glyph size bounds in CSS px. Glyphs scale with pane height: short panes get finer characters. */
const SIZE_MAX = 13;
const SIZE_MIN = 7;
/** Pane rows the gradient aims for: glyph size is height / this, clamped to the bounds. */
const SIZE_ROWS = 14;
const CELL_RATIO_W = 0.62;
const CELL_RATIO_H = 1.3;
/** Characters ordered by weight; the space is the empty cell. */
const RAMP = " .:-=+*#%@";
/** Background weight ceiling: most glyphs stay light, only blob cores reach the dense end. */
const BG_WEIGHT_MAX = 0.5;
/** Background alpha: a faint floor plus a span that scales with weight. */
const BG_ALPHA_FLOOR = 0.1;
const BG_ALPHA_SPAN = 0.22;
/** Blob strength above which a background glyph takes the accent tint. */
const ACCENT_CORE = 0.9;
/** Dark halo: how much the gradient recedes around the face, and how far it reaches. */
const HALO_DIM = 0.85;
const HALO_REACH = 0.32;
/** While speaking, the whole gradient steps back so the face leads. */
const SPEAKING_DIM = 0.3;
/** Face glyph levels, as indices into SHADE_RAMP: a clean seven-step ramp of fixed glyphs. */
const FACE_LEVELS = [2, 4, 6, 9, 12, 16, 21];
const FACE_ALPHA_FLOOR = 0.7;
/** The face keeps at least this many rows; its glyphs never shrink below the size. */
const FACE_MIN_ROWS = 30;
const FACE_MIN_SIZE = 4;
/** Blob falloff (squared distance in height units) and the number of drifting blobs. */
const BLOB_SPREAD = 0.2;
const BLOB_COUNT = 3;

/**
 * Gradient ASCII: a slowly moving gradient set as characters, with the speaking
 * face shaped in the same glyphs (like code rain's face). Idle, three soft blobs
 * drift across the pane over a faint wave; only blob cores take the accent tint
 * and the rest stays content-coloured. Speaking bends the gradient around the
 * face, darkens it into a halo that recedes with distance, and draws the face in
 * brighter accent glyphs so the face is the focal point.
 */
export function createGradientAsciiScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const mouthMask = createMouthMask();
  let width = 0;
  let height = 0;
  let size = SIZE_MAX;
  let cellW = 0;
  let cellH = 0;
  let cols = 0;
  let rows = 0;
  /** Strongest blob at the last sampled point; read right after `field()`. */
  let tint = 0;

  /**
   * A drifting gradient in 0-1 at CSS px (x, y). Three gaussian blobs move on
   * slow, incommensurate orbits; a faint wave keeps the field from looking flat.
   */
  const field = (x: number, y: number, time: number): number => {
    const unit = 1 / height;
    const nx = x * unit;
    const ny = y * unit;
    const aspect = width * unit;
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < BLOB_COUNT; i++) {
      const phase = i * 2.1;
      const bx = aspect * (0.5 + 0.34 * Math.sin(time * (0.17 + i * 0.05) + phase));
      const by = 0.5 + 0.3 * Math.cos(time * (0.13 + i * 0.04) + phase * 1.7);
      const dx = nx - bx;
      const dy = ny - by;
      const g = Math.exp(-(dx * dx + dy * dy) / BLOB_SPREAD);
      sum += g;
      if (g > peak) peak = g;
    }
    tint = peak;
    const wave = 0.5 + 0.5 * Math.sin(nx * 5.5 + time * 0.4 + Math.sin(ny * 4 - time * 0.3) * 1.5);
    return Math.min(1, 0.1 + 0.16 * wave + 0.85 * Math.min(1, sum));
  };

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, height / SIZE_ROWS));
      cellW = size * CELL_RATIO_W;
      cellH = size * CELL_RATIO_H;
      cols = Math.ceil(width / cellW);
      rows = Math.ceil(height / cellH);
    },
    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;
      const presence = signal.presence;
      const energy = signal.energy * presence;
      // Short panes would leave the face a few glyphs tall, so it gets its own
      // finer grid, as code rain does.
      const faceSize = Math.max(
        FACE_MIN_SIZE,
        Math.min(size, height / FACE_MIN_ROWS / CELL_RATIO_H),
      );
      const faceCellW = faceSize * CELL_RATIO_W;
      const faceCellH = faceSize * CELL_RATIO_H;
      const faceCols = Math.ceil(width / faceCellW);
      const faceRows = Math.ceil(height / faceCellH);
      const mask =
        presence > 0.01
          ? mouthMask.render(
              faceCols,
              faceRows,
              faceCellW,
              faceCellH,
              width,
              height,
              signal.open,
              palette.accent,
            )
          : null;

      // The face's centre and size in CSS px, matching where the mask draws it.
      const scale = Math.min(width * 0.36, (height * 0.92) / 2.75);
      const cx = width / 2;
      const cy = height * 0.5 - scale * 0.03;
      const rx = scale * 1.05;
      const ry = scale * 1.4;

      ctx.textBaseline = "top";
      ctx.font = `${size}px ${palette.monoFont}`;
      let fill = "";
      for (let row = 0; row < rows; row++) {
        const py = row * cellH + cellH / 2;
        for (let col = 0; col < cols; col++) {
          const px = col * cellW + cellW / 2;
          let sampleX = px;
          let sampleY = py;
          let dark = 0;
          let vignette = 1;
          if (mask) {
            const ex = (px - cx) / rx;
            const ey = (py - cy) / ry;
            const distance = Math.sqrt(ex * ex + ey * ey);
            // Lens: the gradient is pushed outward around the face, so it bends.
            const lens = presence * 0.25 * Math.exp(-distance * 0.8);
            sampleX = px + (px - cx) * lens;
            sampleY = py + (py - cy) * lens;
            const fx = Math.min(faceCols - 1, Math.floor(px / faceCellW));
            const fy = Math.min(faceRows - 1, Math.floor(py / faceCellH));
            dark = mask.dark[fy * faceCols + fx];
            // Just outside the face the gradient recedes into a dark halo, which
            // fades out with distance so the pane keeps its gradient at the edges.
            const outside = Math.max(0, distance - 1);
            vignette = 1 - HALO_DIM * presence * Math.exp(-(outside * outside) / HALO_REACH);
          }
          const v = field(sampleX, sampleY, time);
          const blob = tint;
          // Dense glyphs only at blob cores; energy adds a little life. The face's
          // own dark mask removes most of the gradient behind it.
          const weight = Math.min(
            1,
            (Math.pow(v, 1.6) * BG_WEIGHT_MAX + blob * blob * 0.12 + energy * v * 0.12) *
              (1 - 0.85 * presence * dark) *
              vignette *
              (1 - SPEAKING_DIM * presence),
          );
          const index = Math.floor(weight * (RAMP.length - 1));
          if (index === 0) continue;
          const want = blob > ACCENT_CORE ? palette.accent : palette.content;
          if (want !== fill) {
            ctx.fillStyle = want;
            fill = want;
          }
          ctx.globalAlpha = BG_ALPHA_FLOOR + BG_ALPHA_SPAN * weight;
          ctx.fillText(RAMP[index], col * cellW, row * cellH);
        }
      }

      if (mask) {
        // The face is drawn in accent glyphs at higher alpha than any background
        // glyph, so it stays the brightest thing in the pane. No per-frame jitter:
        // only the lips and the halo move.
        ctx.font = `${faceSize}px ${palette.monoFont}`;
        ctx.fillStyle = palette.accent;
        for (let cell = 0; cell < mask.light.length; cell++) {
          const value = mask.light[cell];
          if (value < 0.05) continue;
          const col = cell % faceCols;
          const row = (cell - col) / faceCols;
          const level = Math.min(FACE_LEVELS.length - 1, Math.floor(value * FACE_LEVELS.length));
          ctx.globalAlpha = presence * (FACE_ALPHA_FLOOR + (1 - FACE_ALPHA_FLOOR) * value);
          ctx.fillText(SHADE_RAMP[FACE_LEVELS[level]], col * faceCellW, row * faceCellH);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
