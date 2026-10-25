import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** Restores the earlier reply-driven dot field with analytical ripples instead
 * of per-dot springs and allocated shockwave lists. Work stays bounded on 4K panes. */
const MAX_DOTS = 1800;
const MIN_SPACING = 24;

export function createDotGridScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let positions = new Float32Array(0);
  return {
    resize(w, h) {
      width = Math.max(0, w);
      height = Math.max(0, h);
      if (!width || !height) {
        positions = new Float32Array(0);
        return;
      }
      const spacing = Math.max(MIN_SPACING, Math.sqrt((width * height) / MAX_DOTS));
      const cols = Math.min(MAX_DOTS, Math.max(1, Math.floor(width / spacing)));
      const rows = Math.max(1, Math.min(Math.floor(MAX_DOTS / cols), Math.floor(height / spacing)));
      positions = new Float32Array(cols * rows * 2);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = (row * cols + col) * 2;
          positions[i] = ((col + 0.5) * width) / cols;
          positions[i + 1] = ((row + 0.5) * height) / rows;
        }
      }
    },
    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      const presence = Math.max(0, Math.min(1, signal.presence));
      const centerX = width * (0.5 + presence * 0.2 * Math.sin(time * 0.3));
      const centerY = height * (0.5 + presence * 0.15 * Math.cos(time * 0.4));
      const reach = Math.max(1, Math.min(width, height) * 0.8);
      ctx.fillStyle = palette.accent;
      for (let i = 0; i < positions.length; i += 2) {
        const x = positions[i]!;
        const y = positions[i + 1]!;
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.hypot(dx, dy);
        const falloff = Math.max(0, 1 - distance / reach);
        const wave = Math.sin(distance * 0.035 - time * 3.6);
        const push = presence * wave * falloff * 10;
        const size = 1.2 + presence * falloff * (0.8 + wave * 0.6);
        ctx.globalAlpha = 0.18 + presence * falloff * (0.3 + wave * 0.16);
        ctx.fillRect(
          x + (dx / (distance || 1)) * push - size,
          y + (dy / (distance || 1)) * push - size,
          size * 2,
          size * 2,
        );
      }
      ctx.globalAlpha = 1;
    },
  };
}
