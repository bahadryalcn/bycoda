import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

const CELL_W = 14;
const CELL_H = 20;
const SLAT_W = 5;
/** Largest tilt in radians; past this a slat is almost edge-on and fades out. */
const MAX_TILT = 1.3;

/**
 * Rows of thin slats that tilt like venetian blinds as a swell travels across
 * them. Idle: a slow, low swell. While the reply streams the swell grows taller
 * and faster, and each burst of speech sends a ripple out from the centre.
 */
export function createMicroSlatsScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let phase = 0;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      cols = Math.ceil(width / CELL_W);
      rows = Math.ceil(height / CELL_H);
    },
    draw(ctx, time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (cols === 0 || rows === 0) return;

      const energy = Math.min(1, signal.energy) * signal.presence;
      const amplitude = 0.3 + 0.7 * energy;
      // Phase is integrated so a change in speed never makes the slats jump.
      phase += Math.min(delta, 0.1) * (0.5 + 1.4 * energy);

      const centreCol = cols / 2;
      const centreRow = rows / 2;
      const ripple = 0.6 * energy;
      ctx.lineWidth = SLAT_W;
      for (let row = 0; row < rows; row++) {
        const y = row * CELL_H;
        for (let col = 0; col < cols; col++) {
          const x = col * CELL_W;
          const swell =
            Math.sin(col * 0.42 + row * 0.22 + phase) +
            0.6 * Math.sin(col * 0.18 - row * 0.5 - phase * 0.7 + 1.3);
          const radius = Math.hypot(col - centreCol, (row - centreRow) * 1.6);
          const wave = Math.sin(radius * 0.55 - phase * 2.4 + time * 0.2);
          const tilt = Math.max(
            -MAX_TILT,
            Math.min(MAX_TILT, amplitude * swell * 0.55 + ripple * wave * Math.exp(-radius * 0.06)),
          );
          // Foreshortening: a slat tilted toward the viewer shows less of itself.
          const facing = Math.cos(tilt);
          const slatHeight = CELL_H * 0.78 * Math.max(0.12, facing);
          // Slats that face up catch the light in the accent colour.
          const glint = Math.max(0, Math.sin(tilt));
          const lean = Math.sin(tilt) * SLAT_W * 0.3;
          ctx.fillStyle = glint > 0.45 ? palette.accent : palette.content;
          ctx.globalAlpha =
            0.1 + 0.12 * facing * facing + 0.3 * glint * glint * (0.4 + 0.6 * signal.presence);
          ctx.fillRect(
            x + (CELL_W - SLAT_W) / 2 + lean,
            y + (CELL_H - slatHeight) / 2,
            SLAT_W,
            slatHeight,
          );
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
