import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** Grid pitch in CSS pixels. */
const SPACING = 15;
/** Physics step cap: long pauses and the reduced-motion still frame stay stable. */
const MAX_STEP = 0.05;
/** Spring that returns each dot to rest: stiffness (1/s^2) and damping (1/s). */
const STIFFNESS = 60;
const DAMPING = 9;
/** Largest offset the attention point pushes a dot, in CSS pixels. */
const MAX_PUSH = 6;
/** Shockwave travel speed, lifetime, the band width that kicks dots and the kick strength. */
const RING_SPEED = 260;
const RING_LIFE = 1.6;
const RING_WIDTH = 30;
const RING_IMPULSE = 700;
const MAX_RINGS = 4;
const RING_COOLDOWN = 0.2;
/** Energy must climb this much between frames to count as a new burst of speech. */
const BURST_RISE = 0.06;

type Ring = { x: number; y: number; age: number };

/**
 * A grid of dots that the reply disturbs. An attention point wanders across the
 * pane while the AI is replying and pushes nearby dots aside; each new burst of
 * speech sends a ring outward from it. Idle, the dots only ripple slowly.
 */
export function createDotGridScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let baseX = new Float32Array(0);
  let baseY = new Float32Array(0);
  let offX = new Float32Array(0);
  let offY = new Float32Array(0);
  let velX = new Float32Array(0);
  let velY = new Float32Array(0);
  let rings: Ring[] = [];
  let energy = 0;
  let cooldown = 0;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      cols = Math.floor(width / SPACING) + 1;
      rows = Math.floor(height / SPACING) + 1;
      const count = cols * rows;
      baseX = new Float32Array(count);
      baseY = new Float32Array(count);
      offX = new Float32Array(count);
      offY = new Float32Array(count);
      velX = new Float32Array(count);
      velY = new Float32Array(count);
      rings = [];
      // Centre the grid so the margins on both sides match.
      const left = (width - (cols - 1) * SPACING) / 2;
      const top = (height - (rows - 1) * SPACING) / 2;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          baseX[i] = left + col * SPACING;
          baseY[i] = top + row * SPACING;
        }
      }
    },
    draw(ctx, time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      const dt = Math.min(Math.max(delta, 0), MAX_STEP);
      const { presence } = signal;
      const rise = signal.energy - energy;
      energy = signal.energy;
      cooldown = Math.max(0, cooldown - dt);

      // The attention point drifts in a slow figure eight across the pane.
      const ax = width * (0.5 + 0.32 * Math.sin(time * 0.23));
      const ay = height * (0.5 + 0.28 * Math.sin(time * 0.37 + 1.3));
      const reach = Math.min(width, height) * 0.36;
      if (presence > 0.2 && rise > BURST_RISE && cooldown === 0 && rings.length < MAX_RINGS) {
        rings.push({ x: ax, y: ay, age: 0 });
        cooldown = RING_COOLDOWN;
      }
      rings = rings.filter((ring) => {
        ring.age += dt;
        return ring.age < RING_LIFE;
      });

      const pull = presence * (0.6 + 0.4 * signal.energy);
      ctx.fillStyle = palette.content;
      for (let i = 0; i < baseX.length; i++) {
        const bx = baseX[i];
        const by = baseY[i];

        let targetX = 0;
        let targetY = 0;
        let lift = 0;
        if (pull > 0.001) {
          const dx = bx - ax;
          const dy = by - ay;
          const d = Math.hypot(dx, dy);
          if (d < reach) {
            const f = 1 - d / reach;
            const strength = f * f * pull;
            const inv = 1 / (d || 1);
            targetX = dx * inv * strength * MAX_PUSH;
            targetY = dy * inv * strength * MAX_PUSH;
            lift = strength;
          }
        }

        let shock = 0;
        for (const ring of rings) {
          const dx = bx - ring.x;
          const dy = by - ring.y;
          const d = Math.hypot(dx, dy) || 1;
          const band = 1 - Math.abs(d - ring.age * RING_SPEED) / RING_WIDTH;
          if (band <= 0) continue;
          const w = band * (1 - ring.age / RING_LIFE) * (0.4 + 0.6 * signal.energy);
          shock += w;
          // The ring's crest kicks dots outward; the spring pulls them back.
          const kick = w * RING_IMPULSE * dt;
          velX[i] += (dx / d) * kick;
          velY[i] += (dy / d) * kick;
        }

        // Semi-implicit spring toward the push target.
        velX[i] += ((targetX - offX[i]) * STIFFNESS - velX[i] * DAMPING) * dt;
        velY[i] += ((targetY - offY[i]) * STIFFNESS - velY[i] * DAMPING) * dt;
        offX[i] += velX[i] * dt;
        offY[i] += velY[i] * dt;

        // Idle ripple keeps the grid populated; speech lifts the dots it touches.
        const ripple = 0.5 + 0.5 * Math.sin(bx * 0.02 + by * 0.014 - time * 0.6);
        const level = (0.3 + 0.2 * ripple) * (0.75 + 0.25 * presence);
        const alpha = Math.min(1, level + lift * 0.5 + shock * 0.5);
        const r = 1.2 + Math.min(1, lift + shock) * 1.1;
        ctx.globalAlpha = alpha;
        ctx.fillRect(bx + offX[i] - r, by + offY[i] - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    },
  };
}
