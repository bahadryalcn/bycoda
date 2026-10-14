/** `presence` fades the lips in and out; `open` is how far they part right now. */
export type Mouth = { presence: number; open: number };

export const CLOSED_MOUTH: Mouth = { presence: 0, open: 0 };

/**
 * Turns streamed text into lip movement. Each burst of characters adds energy
 * that decays quickly; a syllable rhythm opens and closes the lips while
 * energy remains. A negative length means nothing is streaming.
 */
export function createMouthDriver() {
  let energy = 0;
  let presence = 0;
  let length = -1;
  let open = 0;
  return {
    update(time: number, delta: number, textLength: number): Mouth {
      if (length >= 0 && textLength > length) {
        energy = Math.min(1, energy + (textLength - length) / 24);
      }
      length = textLength;
      energy *= Math.exp(-delta * 2.6);
      const talking = energy > 0.03;
      presence = talking
        ? Math.min(1, presence + delta * 2.5)
        : Math.max(0, presence - delta * 0.7);
      // Two incommensurate rhythms read as syllables rather than a metronome.
      const syllable =
        0.5 + 0.3 * Math.sin(time * 9.3) + 0.2 * Math.sin(time * 15.1 + Math.sin(time * 2.1) * 3);
      const target = talking ? Math.min(1, energy * 1.5) * Math.max(0.08, syllable) : 0;
      // Lips have mass: ease toward the target instead of snapping.
      open += (target - open) * Math.min(1, delta * 18);
      return { presence, open };
    },
  };
}

/**
 * The mouth is drawn in a unit space: corners at x = ±1, the seam at y = 0,
 * y grows downward. Shapes follow a cupid's-bow upper lip and a fuller lower
 * lip; opening raises the upper inner edge a little and drops the lower one more.
 */
function lipPaths(open: number) {
  const corner = 1 - 0.08 * open;
  const upperInner = 0.03 - 0.22 * open;
  const lowerInner = 0.03 + 0.42 * open;
  const lowerOuter = 0.5 + 0.42 * open;

  const upper = new Path2D();
  upper.moveTo(-corner, 0);
  upper.bezierCurveTo(-0.72, -0.1, -0.46, -0.4, -0.22, -0.37);
  upper.bezierCurveTo(-0.12, -0.36, -0.05, -0.26, 0, -0.26);
  upper.bezierCurveTo(0.05, -0.26, 0.12, -0.36, 0.22, -0.37);
  upper.bezierCurveTo(0.46, -0.4, 0.72, -0.1, corner, 0);
  upper.bezierCurveTo(0.5, upperInner + 0.02, -0.5, upperInner + 0.02, -corner, 0);
  upper.closePath();

  const lower = new Path2D();
  lower.moveTo(-corner, 0);
  lower.bezierCurveTo(-0.5, lowerInner, 0.5, lowerInner, corner, 0);
  lower.bezierCurveTo(0.8, 0.22 + 0.3 * open, 0.45, lowerOuter, 0, lowerOuter);
  lower.bezierCurveTo(-0.45, lowerOuter, -0.8, 0.22 + 0.3 * open, -corner, 0);
  lower.closePath();

  const cavity = new Path2D();
  cavity.moveTo(-corner, 0);
  cavity.bezierCurveTo(-0.5, upperInner + 0.02, 0.5, upperInner + 0.02, corner, 0);
  cavity.bezierCurveTo(0.5, lowerInner, -0.5, lowerInner, -corner, 0);
  cavity.closePath();

  return { upper, lower, cavity, upperInner, lowerInner };
}

export type MouthMask = {
  /** Brightness of the lips, teeth and tongue per sample, 0-1. */
  light: Float32Array;
  /** How strongly the scene behind is darkened per sample, 0-1. */
  dark: Float32Array;
  cols: number;
  rows: number;
};

/**
 * Rasterizes the shaded mouth into one sample per grid cell. Only the alpha
 * channel is read back, so the token color used to paint it does not matter.
 */
export function createMouthMask() {
  const lightCanvas = document.createElement("canvas");
  const darkCanvas = document.createElement("canvas");
  const light = lightCanvas.getContext("2d", { willReadFrequently: true });
  const dark = darkCanvas.getContext("2d", { willReadFrequently: true });
  const mask: MouthMask = {
    light: new Float32Array(0),
    dark: new Float32Array(0),
    cols: 0,
    rows: 0,
  };

  return {
    /**
     * `cellW`/`cellH` map grid samples to CSS pixels; the mouth is centred in
     * the `width` x `height` area.
     */
    render(
      cols: number,
      rows: number,
      cellW: number,
      cellH: number,
      width: number,
      height: number,
      open: number,
      paint: string,
    ): MouthMask {
      if (!light || !dark) return mask;
      if (mask.cols !== cols || mask.rows !== rows) {
        lightCanvas.width = darkCanvas.width = cols;
        lightCanvas.height = darkCanvas.height = rows;
        mask.light = new Float32Array(cols * rows);
        mask.dark = new Float32Array(cols * rows);
        mask.cols = cols;
        mask.rows = rows;
      }
      const scale = Math.min(width * 0.3, height * 0.5);
      for (const ctx of [light, dark]) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cols, rows);
        ctx.setTransform(
          scale / cellW,
          0,
          0,
          scale / cellH,
          width / 2 / cellW,
          (height * 0.46) / cellH,
        );
        ctx.fillStyle = paint;
      }
      const { upper, lower, cavity, upperInner, lowerInner } = lipPaths(open);

      // A soft halo and the open mouth darken whatever the scene draws there.
      const halo = dark.createRadialGradient(0, 0.08, 0.2, 0, 0.08, 1.35);
      halo.addColorStop(0, paint);
      halo.addColorStop(1, "transparent");
      dark.globalAlpha = 0.75;
      dark.fillStyle = halo;
      dark.beginPath();
      dark.ellipse(0, 0.08, 1.35, 0.85, 0, 0, Math.PI * 2);
      dark.fill();
      dark.globalAlpha = 1;
      dark.fillStyle = paint;
      dark.fill(upper);
      dark.fill(lower);
      dark.fill(cavity);

      // Upper lip: in shadow, lighter toward the seam.
      light.save();
      light.clip(upper);
      const upperShade = light.createLinearGradient(0, -0.4, 0, 0.02);
      upperShade.addColorStop(0, "transparent");
      upperShade.addColorStop(1, paint);
      light.globalAlpha = 0.45;
      light.fill(upper);
      light.globalAlpha = 0.4;
      light.fillStyle = upperShade;
      light.fill(upper);
      light.restore();

      // Lower lip: fuller and lit, with a highlight just below centre.
      light.save();
      light.clip(lower);
      light.fillStyle = paint;
      light.globalAlpha = 0.55;
      light.fill(lower);
      const cy = (lowerInner + 0.5 + 0.42 * open) / 2;
      const highlight = light.createRadialGradient(0, cy - 0.03, 0, 0, cy, 0.7);
      highlight.addColorStop(0, paint);
      highlight.addColorStop(1, "transparent");
      light.globalAlpha = 0.45;
      light.fillStyle = highlight;
      light.fill(lower);
      light.restore();

      // Inside the mouth: a row of upper teeth and a dim tongue.
      if (open > 0.15) {
        light.save();
        light.clip(cavity);
        light.fillStyle = paint;
        light.globalAlpha = Math.min(0.7, (open - 0.15) * 2);
        light.fillRect(-0.62, upperInner - 0.05, 1.24, 0.06 + 0.1 * open);
        light.globalAlpha = 0.22;
        light.beginPath();
        light.ellipse(0, lowerInner + 0.02, 0.5, 0.16 * open + 0.04, 0, 0, Math.PI * 2);
        light.fill();
        light.restore();
      }
      light.globalAlpha = 1;

      const lightData = light.getImageData(0, 0, cols, rows).data;
      const darkData = dark.getImageData(0, 0, cols, rows).data;
      for (let i = 0; i < mask.light.length; i++) {
        mask.light[i] = lightData[i * 4 + 3] / 255;
        mask.dark[i] = darkData[i * 4 + 3] / 255;
      }
      return mask;
    },
  };
}

/** Characters ordered by ink coverage, for shading the mouth in text. */
export const SHADE_RAMP = ".,:;irsXA253hMHGS#9B&@";

/** Mouth as points of light, for scenes drawn from stars and glow. */
export function drawDotMouth(
  ctx: CanvasRenderingContext2D,
  mask: ReturnType<typeof createMouthMask>,
  width: number,
  height: number,
  mouth: Mouth,
  time: number,
  color: string,
) {
  if (mouth.presence < 0.01) return;
  const step = 5;
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const { light, dark } = mask.render(cols, rows, step, step, width, height, mouth.open, color);
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = color;
  for (let i = 0; i < dark.length; i++) {
    if (dark[i] < 0.02) continue;
    const col = i % cols;
    ctx.globalAlpha = mouth.presence * dark[i] * 0.6;
    ctx.fillRect(col * step, ((i - col) / cols) * step, step, step);
  }
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < light.length; i++) {
    const value = light[i];
    if (value < 0.04) continue;
    const col = i % cols;
    const row = (i - col) / cols;
    // A fixed per-cell hash breaks the grid so the points read as stars.
    const hash = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
    const jitter = hash - Math.floor(hash);
    const twinkle = 0.7 + 0.3 * Math.sin(time * 4 + jitter * 40);
    const size = 0.9 + 2.4 * value * (0.6 + 0.8 * jitter);
    ctx.globalAlpha = mouth.presence * Math.min(1, value * 1.9) * twinkle;
    ctx.fillRect(
      col * step + jitter * (step - size),
      row * step + ((jitter * 7) % 1) * (step - size),
      size,
      size,
    );
  }
  ctx.globalAlpha = 1;
}
