import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

const GLYPHS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** The previous rain's face mask is now its own scene. This field needs no
 * ImageData, offscreen surfaces, per-frame randomness or additional dependencies. */
const MAX_CELLS = 1400;

export function createCodeRainScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let cellWidth = 0;
  let cellHeight = 0;
  let clock = 0;
  return {
    resize(w, h) {
      width = Math.max(0, w);
      height = Math.max(0, h);
      const spacing = Math.max(18, Math.sqrt((width * height) / MAX_CELLS));
      cols = width > 0 ? Math.min(MAX_CELLS, Math.max(1, Math.floor(width / spacing))) : 0;
      rows =
        height > 0 && cols > 0
          ? Math.max(1, Math.min(Math.floor(MAX_CELLS / cols), Math.floor(height / spacing)))
          : 0;
      cellWidth = width / Math.max(1, cols);
      cellHeight = height / Math.max(1, rows);
      clock = 0;
    },
    draw(ctx, _time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (!cols || !rows) return;
      const presence = Math.max(0, Math.min(1, signal.presence));
      clock += Math.max(0, Math.min(delta, 0.1)) * presence;
      ctx.font = `${Math.min(14, cellHeight * 0.65)}px ${palette.monoFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let col = 0; col < cols; col++) {
        const speed = 3 + ((col * 13) % 7);
        const head = (col * 17.17 + clock * speed) % (rows + 12);
        const trail = 6 + (col % 7);
        for (let row = 0; row < rows; row++) {
          const distance = (head - row + rows + 12) % (rows + 12);
          const glow = Math.max(0, 1 - distance / trail);
          const index = (col * 31 + row * 17) % GLYPHS.length;
          ctx.fillStyle = glow > 0.3 ? palette.accent : palette.content;
          ctx.globalAlpha = 0.07 + glow * (0.13 + presence * 0.5);
          ctx.fillText(GLYPHS[index]!, (col + 0.5) * cellWidth, (row + 0.5) * cellHeight);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
