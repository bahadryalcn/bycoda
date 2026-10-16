import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

const LINE_GAP = 7;
/** Sweeps per second when idle; a reply sweeps faster. */
const IDLE_SPEED = 0.09;
/** Phase starts mid-sweep so a still frame already shows a lit trail. */
const START_PHASE = 0.35;

/**
 * A horizontal scan beam moving down the pane over a field of hairlines. Lines
 * the beam has already passed light up in the accent and fade behind it, and the
 * scanned area takes a faint tint. Idle: one slow sweep. While the reply streams
 * the beam speeds up, brightens with each burst, and the scanned area fills in.
 */
export function createScannerScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let phase = START_PHASE;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
    },
    draw(ctx, _time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (height <= 0) return;

      const presence = signal.presence;
      const energy = Math.min(1, signal.energy) * presence;
      const speed = IDLE_SPEED + 0.2 * presence + 0.45 * energy;
      phase = (phase + Math.min(delta, 0.1) * speed) % 1;
      const beamY = phase * height;
      const trail = height * 0.22;

      // The scanned area takes a faint tint behind the beam.
      if (presence > 0) {
        ctx.globalAlpha = 0.03 + 0.03 * energy;
        ctx.fillStyle = palette.accent;
        ctx.fillRect(0, 0, width, beamY);
      }

      for (let y = LINE_GAP / 2; y < height; y += LINE_GAP) {
        const behind = beamY - y;
        const lit = behind >= 0 ? presence * Math.exp(-behind / trail) : 0;
        ctx.fillStyle = lit > 0.15 ? palette.accent : palette.content;
        ctx.globalAlpha = 0.07 + 0.4 * lit;
        ctx.fillRect(0, y, width, 1);
      }

      // The beam: a soft band with a bright core.
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = 0.07 + 0.08 * presence;
      ctx.fillRect(0, beamY - 6, width, 12);
      ctx.globalAlpha = 0.4 + 0.45 * energy;
      ctx.fillRect(0, beamY - 0.75, width, 1.5);
      ctx.globalAlpha = 1;
    },
  };
}
