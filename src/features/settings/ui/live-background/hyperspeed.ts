import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/**
 * Light trails on a road seen from a low camera. Streaks run along the ground
 * toward the horizon, so they converge on a vanishing point and grow as they
 * come near. Content-colored trails run down the left lanes, accent-colored
 * ones down the right. Idle is a slow cruise; speech rushes the streaks past.
 */
const STREAKS = 220;
/** Streaks respawn at the far end once they pass the near plane (the camera is at depth 0). */
const NEAR = 0.7;
const FAR = 9;
/** Depth units per second while idle: a slow cruise. */
const CRUISE = 0.9;
/** Camera height above the road and the horizon line, in pane-height units. */
const CAMERA = 0.62;
const HORIZON = 0.4;
/** Share of streaks that stay visible when idle; speech fills in the rest. */
const BASE_DENSITY = 0.55;
/** Depth bands (near, middle, far) set stroke weight and brightness. */
const BAND_EDGE = [2.5, 5];
const BAND_WIDTH = [2, 1.4, 1];
const BAND_ALPHA = [1, 0.7, 0.45];
const MAX_STEP = 0.05;

export function createHyperspeedScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let lateral = new Float32Array(0);
  let depth = new Float32Array(0);
  let tailFactor = new Float32Array(0);
  let energy = 0;
  let flash = 0;

  const spawn = (i: number, z: number) => {
    // Lanes sit to either side of the centre line, away from the camera's axis.
    const side = Math.random() < 0.5 ? -1 : 1;
    lateral[i] = side * (0.25 + Math.random() * 1.3);
    depth[i] = z;
    tailFactor[i] = 0.6 + Math.random() * 1.2;
  };

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      lateral = new Float32Array(STREAKS);
      depth = new Float32Array(STREAKS);
      tailFactor = new Float32Array(STREAKS);
      // Spread the depths over the whole range so the first frame is already full.
      for (let i = 0; i < STREAKS; i++) spawn(i, NEAR + Math.random() * (FAR - NEAR));
    },
    draw(ctx, _time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (width <= 0 || height <= 0) return;
      const dt = Math.min(Math.max(delta, 0), MAX_STEP);
      const { presence } = signal;
      const rise = signal.energy - energy;
      energy = signal.energy;
      if (rise > 0.05) flash = Math.min(1, flash + rise * 2);
      flash *= Math.exp(-dt * 3);

      const speed = CRUISE + presence * (0.8 + 2.2 * signal.energy) + flash * 0.8;
      const active = Math.round(STREAKS * (BASE_DENSITY + (1 - BASE_DENSITY) * presence));
      const focal = height * 0.9;
      const cx = width / 2;
      const horizon = height * HORIZON;
      const scale = Math.min(1.6, Math.max(1, height / 150));

      // Ground-plane projection: lateral offset shrinks with depth, and so does the
      // drop below the horizon, which is what makes the lanes converge.
      const project = (x: number, z: number) => [
        cx + (x * focal) / z,
        horizon + (CAMERA * focal) / z,
      ];

      for (let i = 0; i < STREAKS; i++) {
        depth[i] -= speed * dt;
        if (depth[i] < NEAR) spawn(i, FAR * (0.75 + Math.random() * 0.25));
      }

      // Horizon line, brighter with speech: the road's edge where the trails vanish.
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = 0.12 + 0.18 * presence + 0.2 * flash;
      ctx.fillRect(0, horizon - 0.5, width, 1);

      // Eight batched strokes: stream (content or accent) times depth band.
      for (let group = 0; group < 6; group++) {
        const accent = group >= 3;
        const band = group % 3;
        ctx.beginPath();
        for (let i = 0; i < active; i++) {
          if (lateral[i] > 0 !== accent) continue;
          const z = depth[i];
          const b = z < BAND_EDGE[0] ? 0 : z < BAND_EDGE[1] ? 1 : 2;
          if (b !== band) continue;
          const tail = tailFactor[i] * (0.15 + speed * 0.5);
          const [x0, y0] = project(lateral[i], z);
          const [x1, y1] = project(lateral[i], z + tail);
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
        ctx.strokeStyle = accent ? palette.accent : palette.content;
        ctx.lineWidth = BAND_WIDTH[band] * scale;
        ctx.globalAlpha = Math.min(
          1,
          (accent ? 0.7 : 0.5) * BAND_ALPHA[band] * (0.6 + 0.4 * presence) + flash * 0.2,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };
}
