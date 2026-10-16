import { createShaderLayer, rgbToVec3 } from "./gl";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

// A fine field of square pixels with gaps between them, shaded by a Bayer
// dither of a soft drifting field, so the resting pane reads as low-contrast
// shade. Each burst of speech energy (a rising edge in the signal) fires a
// ripple from a new spot; ripples expand, fade, and light the pixels they
// cross with the accent. Idle ripples are faint and rare.
const RIPPLE_SLOTS = 4;
const BURST_GAP = 0.3;
const IDLE_GAP = 3.5;
const BURST_RISE = 0.06;
/** Pixel pitch in CSS px, independent of pane size. */
const CELL_CSS = 7;

const fragment = `
uniform vec3 uContent;
uniform vec3 uAccent;
uniform float uPresence;
uniform float uEnergy;
uniform float uCssHeight;
uniform float uCell;
uniform vec4 uRipple0;
uniform vec4 uRipple1;
uniform vec4 uRipple2;
uniform vec4 uRipple3;

// Two-by-two Bayer threshold, 0-3.
float bayer2(vec2 a) {
  return a.x < 0.5 ? (a.y < 0.5 ? 0.0 : 3.0) : (a.y < 0.5 ? 2.0 : 1.0);
}

// Four-by-four ordered dither threshold in (0, 1).
float bayer4(vec2 p) {
  vec2 f = mod(floor(p), 4.0);
  float v = 4.0 * bayer2(mod(f, 2.0)) + bayer2(floor(f / 2.0));
  return (v + 0.5) / 16.0;
}

// A ripple packs (x, y, birth time, strength); x and y are 0-1 in the pane.
float ripple(vec2 q, float aspect, vec4 r) {
  if (r.w <= 0.0) return 0.0;
  float age = uTime - r.z;
  if (age < 0.0) return 0.0;
  vec2 origin = vec2(r.x * aspect, r.y);
  float radius = age * 0.2;
  float d = length(q - origin);
  float offset = (d - radius) / 0.045;
  float ring = exp(-offset * offset);
  return ring * exp(-age * 0.5) * r.w;
}

vec4 shade(vec2 pixel) {
  vec2 res = uResolution;
  float aspect = res.x / res.y;
  // Pixel pitch in render px: the CSS size is fixed, so the grid stays fine on any pane.
  float cell = max(2.0, uCell * res.y / uCssHeight);
  vec2 id = floor(pixel / cell);
  vec2 center = (id + 0.5) * cell;
  // Height units, origin at the top-left, matching the ripple origins.
  vec2 q = center / res.y;

  // A slow drifting field gives the resting pattern its soft shape.
  float field = 0.5 + 0.3 * sin(q.x * 4.0 * aspect + uTime * 0.22 + sin(q.y * 3.0 - uTime * 0.17) * 1.6)
    + 0.2 * cos(q.y * 5.0 - uTime * 0.14 + q.x * 2.0);
  float wave = ripple(q, aspect, uRipple0) + ripple(q, aspect, uRipple1)
    + ripple(q, aspect, uRipple2) + ripple(q, aspect, uRipple3);
  float lit01 = clamp(wave, 0.0, 1.0);

  // Dither: a pixel lights when its level beats its ordered threshold, so density reads as shade.
  float level = clamp(0.22 + 0.34 * field + 0.1 * uPresence + 0.05 * uEnergy, 0.0, 1.0);
  float shade = step(bayer4(id), level);

  // Lit pixels get a little larger, and ripples fill the cell fully.
  float fill = 0.58 + 0.2 * lit01;
  vec2 d = abs(pixel - center) / (cell * 0.5);
  float inside = 1.0 - smoothstep(fill - 0.1, fill, max(d.x, d.y));

  float base = shade * (0.2 + 0.3 * level) * inside;
  float alpha = clamp(base + lit01 * 1.4 * inside, 0.0, 1.0);
  vec3 ink = mix(uContent, uAccent, clamp(lit01 * 1.5, 0.0, 1.0));
  return vec4(ink * alpha, alpha);
}
`;

export function createPixelBlastScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const content = rgbToVec3(palette.contentRgb);
  const accent = rgbToVec3(palette.accentRgb);
  // One layer per scene: disposing a pane releases only its own reference.
  const layer = createShaderLayer({ fragment });
  const ripples: number[][] = Array.from({ length: RIPPLE_SLOTS }, () => [0, 0, 0, 0]);
  let nextSlot = 0;
  let spawned = 0;
  let lastEnergy = 0;
  let lastBurst = Number.NEGATIVE_INFINITY;
  let lastIdle = Number.NEGATIVE_INFINITY;
  let width = 0;
  let height = 0;

  /** Overwrites the oldest slot. The spot sequence is deterministic, not random per frame. */
  const spawn = (birth: number, strength: number) => {
    spawned += 1;
    ripples[nextSlot] = [
      0.15 + 0.7 * ((spawned * 0.618034) % 1),
      0.2 + 0.6 * ((spawned * 0.381966) % 1),
      birth,
      strength,
    ];
    nextSlot = (nextSlot + 1) % RIPPLE_SLOTS;
  };

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
    },
    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      // A rising edge in energy marks a new burst of speech.
      const rise = signal.energy - lastEnergy;
      lastEnergy = signal.energy;
      if (rise > BURST_RISE && time - lastBurst > BURST_GAP) {
        lastBurst = time;
        spawn(time, 0.45 + 0.55 * signal.energy);
      } else if (time - lastIdle > IDLE_GAP) {
        // Idle ripples start a second in the past so the still frame shows one.
        lastIdle = time;
        spawn(time - 1, 0.2);
      }
      layer.render(ctx, time, width, height, {
        uContent: content,
        uAccent: accent,
        uPresence: signal.presence,
        uEnergy: signal.energy,
        uCssHeight: height,
        uCell: CELL_CSS,
        uRipple0: ripples[0],
        uRipple1: ripples[1],
        uRipple2: ripples[2],
        uRipple3: ripples[3],
      });
    },
    dispose() {
      layer.dispose();
    },
  };
}
