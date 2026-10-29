import { accentInk } from "./dotGrid";
import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** Code-flavoured glyphs, all ASCII so every monospace font renders them. */
const GLYPHS = "0123456789abcdef{}[]()<>=+-*/;:_|&!?#%$~";
/** Streams of characters in three depth layers. Far streams are small, dim and
 * slow; near streams are larger, brighter and faster, and keep to the side
 * margins so the reading column stays calm. Each stream is a rigid strip with
 * a bright head and a fading tail that drifts down while the AI replies and
 * holds still at rest. All placement is computed on resize; drawing allocates
 * nothing and the number of glyphs per frame is bounded by the layer budgets. */
type Layer = {
  font: number;
  /** Line advance relative to the font size. */
  leading: number;
  trail: number;
  /** Desired average distance between streams, in CSS pixels. */
  spacing: number;
  /** Rows per second at full presence. */
  speed: number;
  alpha: number;
  /** Relative stream density behind the reading column (sides are 1). */
  center: number;
  /** Maximum glyphs this layer may draw in one frame. */
  budget: number;
  /** Far layers use the neutral content tone (atmospheric haze). */
  hazy: boolean;
};

const LAYERS: readonly Layer[] = [
  {
    font: 10,
    leading: 1.2,
    trail: 12,
    spacing: 18,
    speed: 2.2,
    alpha: 0.55,
    center: 0.28,
    budget: 540,
    hazy: true,
  },
  {
    font: 13,
    leading: 1.18,
    trail: 15,
    spacing: 34,
    speed: 3.3,
    alpha: 0.8,
    center: 0.14,
    budget: 480,
    hazy: false,
  },
  {
    font: 17,
    leading: 1.15,
    trail: 17,
    spacing: 70,
    speed: 4.8,
    alpha: 1,
    center: 0.04,
    budget: 374,
    hazy: false,
  },
];
/** x, phase, speed multiplier, trail length, seed, column weight, wrap gap. */
const STRIDE = 7;
const BINS = 256;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
/** Deterministic integer hash mapped to [0, 1). */
function hash(value: number): number {
  let x = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function createCodeRainScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let clock = 0;
  const fonts = LAYERS.map((layer) => `${layer.font}px ${palette.monoFont}`);
  const streams = LAYERS.map(() => new Float32Array(0));
  const counts = LAYERS.map(() => 0);
  const cdf = new Float32Array(BINS + 1);
  const ink = accentInk(palette);

  /** Stream density across the pane: calm over the reading column. */
  const weightAt = (x: number, center: number) => {
    const column = Math.min(width * 0.3, 440);
    const side = smoothstep(column * 0.5, column * 1.25, Math.abs(x - width / 2));
    return center + (1 - center) * side;
  };

  return {
    resize(w, h) {
      width = Math.max(0, w);
      height = Math.max(0, h);
      clock = 0;
      for (let l = 0; l < LAYERS.length; l++) {
        const layer = LAYERS[l]!;
        if (!width || !height) {
          streams[l] = new Float32Array(0);
          counts[l] = 0;
          continue;
        }
        // Inverse-CDF placement: an exact stream count that follows the weight.
        cdf[0] = 0;
        let mass = 0;
        for (let b = 0; b < BINS; b++) {
          mass += weightAt(((b + 0.5) / BINS) * width, layer.center);
          cdf[b + 1] = mass;
        }
        const desired = Math.max(1, Math.round((width * (mass / BINS)) / layer.spacing));
        const count = Math.min(desired, Math.floor(layer.budget / (layer.trail + 3)));
        const data = new Float32Array(count * STRIDE);
        let bin = 0;
        for (let s = 0; s < count; s++) {
          const seed = l * 7919 + s * 131 + 17;
          const target = ((s + 0.5 + (hash(seed) - 0.5) * 0.7) / count) * mass;
          while (bin < BINS - 1 && cdf[bin + 1]! < target) bin++;
          const span = cdf[bin + 1]! - cdf[bin]! || 1;
          const x = ((bin + (target - cdf[bin]!) / span) / BINS) * width;
          const i = s * STRIDE;
          data[i] = Math.round(x);
          data[i + 1] = hash(seed + 1);
          data[i + 2] = 0.75 + hash(seed + 2) * 0.5;
          data[i + 3] = layer.trail - 3 + Math.floor(hash(seed + 3) * 7);
          data[i + 4] = seed;
          data[i + 5] = weightAt(x, 0.22);
          data[i + 6] = hash(seed + 4) * 0.6;
        }
        streams[l] = data;
        counts[l] = count;
      }
    },
    draw(ctx, _time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (!width || !height) return;
      const presence = clamp01(signal.presence);
      const energy = clamp01(signal.energy ?? 0);
      const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
      clock += dt * presence * (1 + 0.45 * energy);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const glyphCount = GLYPHS.length;
      const fadeTop = height * 0.1;
      for (let l = 0; l < LAYERS.length; l++) {
        const layer = LAYERS[l]!;
        const data = streams[l]!;
        const count = counts[l]!;
        if (!count) continue;
        const cell = layer.font * layer.leading;
        const rows = height / cell;
        const flicker = Math.floor(clock * 9);
        ctx.font = fonts[l]!;
        // Pass 0 paints the tails, pass 1 the heads, so colors switch twice per layer.
        for (let pass = 0; pass < 2; pass++) {
          const tinted = pass === 0 && !layer.hazy;
          const gain = tinted ? ink.gain : 1;
          ctx.fillStyle = tinted ? ink.color : palette.content;
          for (let s = 0; s < count; s++) {
            const i = s * STRIDE;
            const x = data[i]!;
            const trail = data[i + 3]!;
            const seed = data[i + 4]!;
            const column = data[i + 5]!;
            const period = rows + trail + rows * data[i + 6]! + 2;
            let head = data[i + 1]! * period + clock * layer.speed * data[i + 2]!;
            head -= Math.floor(head / period) * period;
            const from = pass === 0 ? 1 : 0;
            const to = pass === 0 ? trail : 1;
            for (let j = from; j < to; j++) {
              const y = Math.round((head - j) * cell);
              if (y < -cell || y > height + cell) continue;
              const fade = j === 0 ? 1 : 0.85 * Math.pow(1 - j / trail, 1.15);
              const depth = 0.6 + 0.4 * (y / height);
              const edge = fadeTop > 0 && y < fadeTop ? clamp01(y / fadeTop) : 1;
              const alpha = layer.alpha * gain * fade * depth * edge * (0.32 + 0.68 * column);
              if (alpha < 0.004) continue;
              // A few glyphs (and every head) mutate while the reply streams.
              const mutate = j === 0 || hash(seed * 31 + j) < 0.18 ? flicker + j * 3 : 0;
              const glyph = Math.floor(hash(seed * 53 + j * 7 + mutate) * glyphCount);
              ctx.globalAlpha = alpha > 1 ? 1 : alpha;
              ctx.fillText(GLYPHS[glyph]!, x, y);
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
