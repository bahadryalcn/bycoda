import { createMouthMask, SHADE_RAMP } from "./mouth";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

const GLYPHS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** The face keeps at least this many rows; its glyphs never shrink below the size. */
const FACE_MIN_ROWS = 30;
const FACE_MIN_SIZE = 4;

export function createCodeRainScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const size = 13;
  const cellW = Math.round(size * 0.66);
  const cellH = Math.round(size * 1.3);
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let glyphs = new Uint8Array(0);
  const mouthMask = createMouthMask();
  let heads = new Float32Array(0);
  let speeds = new Float32Array(0);
  let trails = new Float32Array(0);
  let flickerDebt = 0;

  const resetColumn = (col: number, start: number) => {
    heads[col] = start;
    speeds[col] = 3 + Math.random() * 11;
    trails[col] = 6 + Math.random() * 18;
  };

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      cols = Math.ceil(width / cellW);
      rows = Math.ceil(height / cellH);
      glyphs = new Uint8Array(cols * rows);
      for (let i = 0; i < glyphs.length; i++) glyphs[i] = Math.floor(Math.random() * GLYPHS.length);
      heads = new Float32Array(cols);
      speeds = new Float32Array(cols);
      trails = new Float32Array(cols);
      for (let col = 0; col < cols; col++) resetColumn(col, Math.random() * rows * 2 - rows);
    },
    draw(ctx, time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      const speaking = signal.presence > 0.01;
      // Short panes would leave the face only a few rain rows tall, so it gets
      // its own finer grid with enough rows to read brow, nose and lips.
      const faceSize = Math.max(FACE_MIN_SIZE, Math.min(size, height / FACE_MIN_ROWS / 1.3));
      const faceCellW = faceSize * 0.66;
      const faceCellH = faceSize * 1.3;
      const faceCols = Math.ceil(width / faceCellW);
      const faceRows = Math.ceil(height / faceCellH);
      const mask = speaking
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
      // Rain cells over the face give way to it; around the face the rain dims.
      const shade = (cell: number) => {
        if (!mask) return 1;
        const col = cell % cols;
        const x = Math.min(faceCols - 1, Math.floor(((col + 0.5) * cellW) / faceCellW));
        const y = Math.min(
          faceRows - 1,
          Math.floor((((cell - col) / cols + 0.5) * cellH) / faceCellH),
        );
        const face = y * faceCols + x;
        return 1 - signal.presence * Math.max(mask.dark[face] * 0.92, mask.light[face]);
      };
      flickerDebt += glyphs.length * delta * 0.35;
      while (flickerDebt >= 1) {
        flickerDebt -= 1;
        glyphs[Math.floor(Math.random() * glyphs.length)] = Math.floor(
          Math.random() * GLYPHS.length,
        );
      }
      for (let col = 0; col < cols; col++) {
        heads[col] += speeds[col] * delta;
        if (heads[col] - trails[col] > rows) resetColumn(col, -Math.random() * rows * 0.5);
      }
      ctx.font = `${size}px ${palette.monoFont}`;
      ctx.textBaseline = "top";

      // Slow interference keeps patches of the grid brighter than others.
      ctx.fillStyle = palette.content;
      for (let row = 0; row < rows; row++) {
        const rowWave = Math.cos(row * 0.13 - time * 0.17);
        for (let col = 0; col < cols; col++) {
          const field = 0.5 + 0.5 * Math.sin(col * 0.07 + time * 0.21) * rowWave;
          const alpha = (0.06 + 0.3 * field * field) * shade(row * cols + col);
          if (alpha < 0.08) continue;
          ctx.globalAlpha = alpha;
          ctx.fillText(GLYPHS[glyphs[row * cols + col]], col * cellW, row * cellH);
        }
      }

      ctx.fillStyle = palette.accent;
      for (let col = 0; col < cols; col++) {
        const head = heads[col];
        const trail = trails[col];
        const first = Math.max(0, Math.ceil(head - trail));
        const last = Math.min(rows - 1, Math.floor(head));
        for (let row = first; row <= last; row++) {
          const fade = 1 - (head - row) / trail;
          ctx.globalAlpha = (row === last ? 1 : fade * fade * 0.85) * shade(row * cols + col);
          ctx.fillText(GLYPHS[glyphs[row * cols + col]], col * cellW, row * cellH);
        }
      }

      // The face is ASCII-shaded: denser characters where it is brighter. A slow
      // per-cell jitter keeps the characters shimmering like the rain around them.
      if (mask) {
        ctx.font = `${faceSize}px ${palette.monoFont}`;
        const tick = Math.floor(time * 4);
        for (let cell = 0; cell < mask.light.length; cell++) {
          const value = mask.light[cell];
          if (value < 0.05) continue;
          const col = cell % faceCols;
          const row = (cell - col) / faceCols;
          const noise = Math.sin(col * 12.9898 + row * 78.233 + tick * 0.37) * 43758.5453;
          const jitter = Math.floor((noise - Math.floor(noise)) * 3) - 1;
          const index = Math.min(
            SHADE_RAMP.length - 1,
            Math.max(0, Math.floor(value * SHADE_RAMP.length) + jitter),
          );
          // Brighter than the rain so the face carries through the layer's opacity.
          ctx.globalAlpha = signal.presence * (0.4 + 0.6 * value);
          ctx.fillText(SHADE_RAMP[index], col * faceCellW, row * faceCellH);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
