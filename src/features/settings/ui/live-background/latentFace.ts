import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

type Point = readonly [number, number];
type Stroke = { points: Point[]; weight: number; accent: boolean };
type Glyph = { x: number; y: number; char: string; alpha: number; accent: boolean };

/** Face coordinates have a fixed pose. The right temple dissolves into a few
 * marks; neither the silhouette nor the glyphs are randomized while replying. */
function curve(
  start: Point,
  controlA: Point,
  controlB: Point,
  end: Point,
  weight = 1,
  accent = false,
): Stroke {
  const points: Point[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const s = 1 - t;
    points.push([
      s ** 3 * start[0] +
        3 * s * s * t * controlA[0] +
        3 * s * t * t * controlB[0] +
        t ** 3 * end[0],
      s ** 3 * start[1] +
        3 * s * s * t * controlA[1] +
        3 * s * t * t * controlB[1] +
        t ** 3 * end[1],
    ]);
  }
  return { points, weight, accent };
}

const STROKES: readonly Stroke[] = [
  // Cranial outline and a deliberate, asymmetric jaw give the portrait its pose.
  curve([-0.73, -0.19], [-0.96, -1.49], [0.67, -1.65], [0.82, -0.45], 0.7),
  curve([-0.73, -0.19], [-0.73, 0.48], [-0.43, 1.08], [0.01, 1.2], 0.95),
  curve([0.01, 1.2], [0.39, 1.17], [0.72, 0.49], [0.74, -0.05], 0.55),
  // Brows and softly closed eyes. No pupils that blink or flash at the reader.
  curve([-0.59, -0.34], [-0.41, -0.46], [-0.22, -0.44], [-0.1, -0.31], 0.82),
  curve([0.14, -0.33], [0.34, -0.43], [0.52, -0.35], [0.59, -0.27], 0.67),
  curve([-0.56, -0.17], [-0.39, -0.04], [-0.25, -0.06], [-0.13, -0.18], 1.05, true),
  curve([0.18, -0.16], [0.31, -0.04], [0.46, -0.05], [0.56, -0.14], 0.8),
  // Bridge, tip and underside of the nose retain structure at thumbnail size.
  curve([0.02, -0.31], [-0.02, -0.05], [-0.08, 0.15], [-0.11, 0.3], 1, true),
  curve([-0.11, 0.3], [-0.04, 0.38], [0.13, 0.38], [0.2, 0.29], 0.9),
  curve([0.2, 0.29], [0.22, 0.2], [0.18, 0.08], [0.14, -0.02], 0.4),
  // Cheek planes. The lips are drawn separately so the portrait can speak.
  curve([-0.6, 0.1], [-0.49, 0.12], [-0.32, 0.25], [-0.23, 0.4], 0.55),
  curve([0.53, 0.12], [0.4, 0.16], [0.3, 0.31], [0.3, 0.44], 0.35),
  curve([-0.18, 1], [-0.03, 1.04], [0.11, 1.03], [0.2, 0.97], 0.45),
  // A few contour fragments suggest depth without filling the face with noise.
  curve([-0.55, -0.7], [-0.43, -1.06], [-0.03, -1.17], [0.29, -1.02], 0.35),
  curve([-0.64, 0.29], [-0.55, 0.55], [-0.4, 0.78], [-0.25, 0.86], 0.32),
];

function distanceToStroke(x: number, y: number, stroke: Stroke): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1]!;
    const b = stroke.points[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t =
      length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length));
    distance = Math.min(distance, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
  }
  return distance;
}

/** Integer coordinates seed layout only. No per-frame RNG, readbacks or glyph
 * replacements: typing cadence cannot make the face flicker. */
function grain(col: number, row: number): number {
  let value = Math.imul(col + 101, 374761393) ^ Math.imul(row + 67, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function createLatentFaceScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let fontSize = 5;
  let glyphs: Glyph[] = [];
  let scale = 0;
  let centerX = 0;
  let centerY = 0;

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(0, nextWidth);
      height = Math.max(0, nextHeight);
      glyphs = [];
      if (width === 0 || height === 0) return;

      scale = Math.min(width / 2.3, height / 3.1);
      // A fixed relative cell size bounds resize work even on very large panes.
      fontSize = Math.max(3, scale * 0.065);
      const stepX = fontSize * 0.66;
      const stepY = fontSize * 1.14;
      centerX = width * 0.5;
      centerY = height * 0.51;
      const cols = Math.ceil((scale * 2.1) / stepX);
      const rows = Math.ceil((scale * 2.9) / stepY);
      const thickness = Math.max(0.036, stepY / scale / 1.5);

      for (let row = 0; row <= rows; row++) {
        const y = -1.45 + (row * stepY) / scale;
        for (let col = 0; col <= cols; col++) {
          const x = -1.05 + (col * stepX) / scale;
          const seed = grain(col, row);
          let strength = 0;
          let accent = false;
          for (const stroke of STROKES) {
            const value =
              Math.max(0, 1 - distanceToStroke(x, y, stroke) / thickness) * stroke.weight;
            if (value > strength) {
              strength = value;
              accent = stroke.accent;
            }
          }

          // Sparse, fixed marks bridge the contours on the lit left cheek.
          const plane = Math.exp(-((x + 0.36) ** 2 / 0.035 + (y - 0.05) ** 2 / 0.8));
          if (seed > 0.8) strength = Math.max(strength, plane * 0.24);
          // Dissolve only the far edge; essential eye/nose/mouth shapes stay legible.
          if (x > 0.44 && seed < (x - 0.44) * 1.25) continue;
          if (strength < 0.12) continue;

          const char =
            strength > 0.62 ? (Math.abs(x) < 0.13 ? ":" : "=") : strength > 0.34 ? ":" : ".";
          glyphs.push({
            x: centerX + x * scale,
            y: centerY + y * scale,
            char,
            alpha: 0.16 + strength * 0.64,
            accent,
          });
        }
      }
    },
    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;
      // The shared driver already eases presence and reaches exact rest before
      // the canvas loop settles. A second filter would leave a residual pose.
      const presence = Math.max(0, Math.min(1, signal.presence));
      ctx.save();
      // Sparse signal contours connect the portrait to the pane edges rather
      // than leaving a small illustration floating inside an empty background.
      ctx.strokeStyle = palette.content;
      ctx.lineWidth = 0.75;
      for (let row = 0; row < 7; row++) {
        const y = height * (0.18 + row * 0.105);
        const lift = presence * Math.sin(time * 1.6 + row * 0.75) * height * 0.008;
        ctx.globalAlpha = 0.08 + presence * 0.05;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(side < 0 ? 0 : width, y);
          ctx.bezierCurveTo(
            centerX + side * scale * 1.5,
            y + lift,
            centerX + side * scale,
            y - lift,
            centerX + side * scale * 0.88,
            centerY + (y - centerY) * 0.68,
          );
          ctx.stroke();
        }
      }
      ctx.font = `${fontSize}px ${palette.monoFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const glyph of glyphs) {
        // A reply sends a slow light wave through the fixed facial features.
        const breath = glyph.accent
          ? presence * 0.12 * Math.sin(time * 1.8 + (glyph.y / Math.max(height, 1)) * 5)
          : 0;
        ctx.globalAlpha = glyph.alpha * (0.88 + presence * 0.08 + breath);
        ctx.fillStyle = glyph.accent ? palette.accent : palette.content;
        ctx.fillText(glyph.char, glyph.x, glyph.y);
      }
      // Deterministic syllables open, round and close the lips. The entire mouth
      // returns to the same resting pose when presence reaches zero.
      const syllable = time * 3.4;
      const opening = presence * Math.max(0, Math.sin(syllable * Math.PI)) ** 0.7;
      const roundness = (0.5 + 0.5 * Math.sin(time * 2.3)) * opening;
      const mouthWidth = scale * (0.27 - roundness * 0.09);
      const mouthHeight = scale * (0.025 + opening * 0.145);
      ctx.fillStyle = palette.accent;
      ctx.globalAlpha = 0.68 + presence * 0.2;
      for (let lip = 0; lip < 2; lip++) {
        for (let point = 0; point <= 18; point++) {
          const across = point / 18;
          const arc = Math.sin(across * Math.PI);
          ctx.fillText(
            point % 3 === 0 ? ":" : "=",
            centerX + (across * 2 - 1) * mouthWidth,
            centerY + scale * 0.67 + (lip === 0 ? -1 : 1) * mouthHeight * arc,
          );
        }
      }
      ctx.restore();
    },
  };
}
