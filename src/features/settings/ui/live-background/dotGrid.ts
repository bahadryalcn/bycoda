import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** A precise halftone field. At rest the dot tone (size and alpha) is a fixed
 * composition: calm behind the reading column, fuller toward the side margins
 * and the lower corners, with dots growing toward the bottom for a sense of
 * depth. While the AI replies, concentric ripples rise from beneath the
 * conversation with a bright leading edge and a soft trailing decay. Every
 * per-dot term is precomputed on resize; a frame only evaluates the ripple. */
const MAX_DOTS = 1800;
const MIN_SPACING = 22;
/** x, y, rest alpha, rest size, ripple weight, distance, unit dx, unit dy. */
const STRIDE = 8;
const RIPPLE_SPEED = 120; // px per second
const RIPPLE_WAVELENGTH = 230; // px between rings
const RIPPLE_DECAY = 2.6; // how fast the trail behind a ring's edge fades
const RIPPLE_RAMP = 0.07; // softened leading edge, as a fraction of a wavelength
/** Ring dots between these crest levels carry the accent; the edge itself uses content. */
const GLOW_FROM = 0.14;
const EDGE_FROM = 0.62;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Approximate perceptual lightness (0-1) of a resolved CSS color, or null. */
export function lightness(color: string): number | null {
  const numbers = color.match(/-?\d*\.?\d+(?:e-?\d+)?%?/gi);
  if (!numbers || numbers.length < 3) return null;
  const value = (token: string, scale: number) =>
    token.endsWith("%") ? parseFloat(token) / 100 : parseFloat(token) / scale;
  const lower = color.trimStart().toLowerCase();
  if (lower.startsWith("oklab") || lower.startsWith("oklch")) return clamp01(value(numbers[0]!, 1));
  let rgb: [number, number, number];
  if (lower.startsWith("rgb")) {
    rgb = [value(numbers[0]!, 255), value(numbers[1]!, 255), value(numbers[2]!, 255)];
  } else if (lower.startsWith("color(srgb")) {
    rgb = [value(numbers[0]!, 1), value(numbers[1]!, 1), value(numbers[2]!, 1)];
  } else {
    return null;
  }
  const linear = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return Math.cbrt(0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!);
}

/**
 * The ink for accent highlights. A pale accent on a light theme (or a dark one on
 * a dark theme) would read as a hole in the artwork, so highlights then fall back
 * to the content color. `gain` lifts accents whose contrast is a little lower
 * than the content's. Unknown color formats keep the accent unchanged.
 */
export function accentInk(palette: LiveBackgroundPalette): { color: string; gain: number } {
  const content = lightness(palette.content);
  const accent = lightness(palette.accent);
  if (content === null || accent === null) return { color: palette.accent, gain: 1 };
  // Content is light on dark themes and dark on light themes.
  const background = content > 0.5 ? 0.18 : 0.97;
  const ratio = Math.abs(accent - background) / Math.max(0.05, Math.abs(content - background));
  if (ratio < 0.45) return { color: palette.content, gain: 1 };
  return { color: palette.accent, gain: Math.min(1.5, 1 / Math.min(1, ratio)) };
}

export function createDotGridScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let dots = new Float32Array(0);
  let count = 0;
  const ink = accentInk(palette);
  return {
    resize(w, h) {
      width = Math.max(0, w);
      height = Math.max(0, h);
      if (!width || !height) {
        dots = new Float32Array(0);
        count = 0;
        return;
      }
      const spacing = Math.max(MIN_SPACING, Math.sqrt((width * height) / MAX_DOTS));
      const cols = Math.min(MAX_DOTS, Math.max(1, Math.floor(width / spacing)));
      const rows = Math.max(1, Math.min(Math.floor(MAX_DOTS / cols), Math.floor(height / spacing)));
      const stepX = width / cols;
      const stepY = height / rows;
      count = cols * rows;
      dots = new Float32Array(count * STRIDE);
      const centerX = width / 2;
      // The reading column is at most ~56rem; narrow panes are almost all column.
      const column = Math.min(width * 0.3, 440);
      const originY = height * 1.04;
      const reach = Math.max(1, Math.hypot(centerX, originY));
      const glow = Math.max(1, Math.max(width, height) * 0.62);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = (row * cols + col) * STRIDE;
          const x = Math.round((col + 0.5) * stepX);
          const y = Math.round((row + 0.5) * stepY);
          const depth = y / height; // 0 far (top) .. 1 near (bottom)
          const side = smoothstep(column * 0.55, column * 1.3, Math.abs(x - centerX));
          // Two soft pools of tone in the lower corners give the field a focal shape.
          const left = Math.hypot(x, height - y) / glow;
          const right = Math.hypot(width - x, height - y) / glow;
          const pool = Math.exp(-left * left * 1.6) + Math.exp(-right * right * 1.6);
          // The top edge recedes; the bottom stays grounded.
          const horizon = smoothstep(0, 0.35, depth);
          const tone = clamp01(
            (0.05 + side * (0.22 + 0.38 * depth) + 0.55 * clamp01(pool)) * (0.4 + 0.6 * horizon),
          );
          const dx = x - centerX;
          const dy = y - originY;
          const distance = Math.hypot(dx, dy);
          dots[i] = x;
          dots[i + 1] = y;
          dots[i + 2] = 0.14 + 0.52 * tone;
          // Halftone: tone is carried mostly by dot size, like a printed screen.
          dots[i + 3] = 0.7 + 2.7 * Math.pow(tone, 1.25);
          // Ripples stay quieter over the text and fade as they travel outward.
          dots[i + 4] = (0.45 + 0.55 * side) * (1 - 0.35 * (distance / reach));
          dots[i + 5] = distance;
          dots[i + 6] = dx / (distance || 1);
          dots[i + 7] = dy / (distance || 1);
        }
      }
    },
    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (!count) return;
      const presence = clamp01(signal.presence);
      const energy = clamp01(signal.energy ?? 0);
      const amplitude = presence * (0.8 + 0.35 * energy);
      const travel = (time * RIPPLE_SPEED) / RIPPLE_WAVELENGTH;
      const inverseWavelength = 1 / RIPPLE_WAVELENGTH;
      let glowing = false;
      ctx.fillStyle = palette.content;
      for (let i = 0; i < dots.length; i += STRIDE) {
        let x = dots[i]!;
        let y = dots[i + 1]!;
        let alpha = dots[i + 2]!;
        let size = dots[i + 3]!;
        let crest = 0;
        if (amplitude > 0) {
          // phase 0 sits just inside a ring's outer edge and grows toward the source.
          let phase = travel - dots[i + 5]! * inverseWavelength;
          phase -= Math.floor(phase);
          const lead = phase < RIPPLE_RAMP ? phase / RIPPLE_RAMP : 1;
          const weight = amplitude * dots[i + 4]!;
          crest = Math.exp(-RIPPLE_DECAY * phase) * lead * weight;
          // The field recedes a little so each ring's bright edge reads clearly.
          alpha = alpha * (1 - 0.45 * weight) + crest * 1.1;
          size += crest * 2.8;
          x += dots[i + 6]! * crest * 7;
          y += dots[i + 7]! * crest * 7;
        }
        // Trailing ring dots glow in the accent; rest dots and the edge use content.
        const glow = crest > GLOW_FROM && crest <= EDGE_FROM;
        if (glow !== glowing) {
          glowing = glow;
          ctx.fillStyle = glow ? ink.color : palette.content;
        }
        if (glow) alpha *= ink.gain;
        ctx.globalAlpha = alpha > 1 ? 1 : alpha;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    },
  };
}
