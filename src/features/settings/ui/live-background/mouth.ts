import type { LiveSignal } from "./types";

export const CLOSED_SIGNAL: LiveSignal = { presence: 0, open: 0, energy: 0 };

/**
 * Turns streamed text into a `LiveSignal`. Each burst of characters adds energy
 * that decays quickly; a syllable rhythm opens and closes the lips while
 * energy remains. A negative length means nothing is streaming.
 */
export function createLiveSignalDriver() {
  let energy = 0;
  let presence = 0;
  let length = -1;
  let open = 0;
  return {
    update(time: number, delta: number, textLength: number): LiveSignal {
      if (length >= 0 && textLength > length) {
        energy = Math.min(1, energy + (textLength - length) / 24);
      }
      length = textLength;
      energy *= Math.exp(-delta * 2.6);
      const talking = energy > 0.03;
      // The face stays for the whole reply; only the lips rest between bursts.
      presence =
        talking || length >= 0
          ? Math.min(1, presence + delta * 2.5)
          : Math.max(0, presence - delta * 0.7);
      // Two incommensurate rhythms read as syllables rather than a metronome.
      const syllable =
        0.5 + 0.3 * Math.sin(time * 9.3) + 0.2 * Math.sin(time * 15.1 + Math.sin(time * 2.1) * 3);
      const target = talking ? Math.min(1, energy * 1.5) * Math.max(0.08, syllable) : 0;
      // Lips have mass: ease toward the target instead of snapping.
      open += (target - open) * Math.min(1, delta * 18);
      return { presence, open, energy };
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
  /** Brightness of the face (brow, nose, cheeks, lips, teeth) per sample, 0-1. */
  light: Float32Array;
  /** How strongly the scene behind is darkened per sample, 0-1. */
  dark: Float32Array;
  cols: number;
  rows: number;
};

/**
 * Rasterizes the speaking face into one sample per grid cell, the way a face
 * appears in embers: highlights on the brow, nose, cheekbones, lips and chin,
 * shadows in the eye sockets, beside the nose and inside the mouth. Only the
 * alpha channel is read back, so the token color used to paint it does not matter.
 *
 * Face units: the face is 2 wide at the cheekbones, the eye line sits near
 * y = -0.22 and the chin near y = 1.3; y grows downward.
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

  /** A soft elliptical glow, strongest at its centre. */
  const blob = (
    ctx: CanvasRenderingContext2D,
    paint: string,
    x: number,
    y: number,
    rx: number,
    ry: number,
    alpha: number,
    rotation = 0,
  ) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(rx, ry);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, paint);
    glow.addColorStop(1, "transparent");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /** A soft stroke along a curve, for folds and ridges. */
  const crease = (
    ctx: CanvasRenderingContext2D,
    paint: string,
    points: number[],
    width: number,
    alpha: number,
  ) => {
    ctx.save();
    ctx.strokeStyle = paint;
    ctx.lineCap = "round";
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    ctx.quadraticCurveTo(points[2], points[3], points[4], points[5]);
    ctx.stroke();
    ctx.restore();
  };

  return {
    /**
     * `cellW`/`cellH` map grid samples to CSS pixels; the face is centred in
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
      const scale = Math.min(width * 0.36, (height * 0.92) / 2.75);
      for (const ctx of [light, dark]) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cols, rows);
        ctx.setTransform(
          scale / cellW,
          0,
          0,
          scale / cellH,
          width / 2 / cellW,
          (height * 0.5 - scale * 0.08) / cellH,
        );
        ctx.fillStyle = paint;
      }

      // Speaking drops the jaw and lifts the brows a little.
      const jaw = 0.16 * open;
      const brow = -0.03 * open;
      const mouthY = 0.74 + jaw * 0.35;

      // Shadow layer: the face replaces the scene, with a soft falloff around it.
      blob(dark, paint, 0, 0.05, 1.45, 1.75, 0.8);
      dark.globalAlpha = 0.85;
      dark.beginPath();
      dark.ellipse(0, 0.05 + jaw * 0.5, 1, 1.3 + jaw * 0.5, 0, 0, Math.PI * 2);
      dark.fill();
      dark.globalAlpha = 1;

      // Light layer, broad to fine. The whole face carries a faint base glow.
      blob(light, paint, 0, 0.05 + jaw * 0.5, 1.05, 1.4 + jaw * 0.5, 0.16);
      // Forehead and brow ridge.
      blob(light, paint, 0, -0.78 + brow, 0.75, 0.38, 0.55);
      blob(light, paint, -0.36, -0.44 + brow, 0.36, 0.11, 0.95, 0.12);
      blob(light, paint, 0.36, -0.44 + brow, 0.36, 0.11, 0.95, -0.12);
      // Nose: bridge, tip and the wings of the nostrils.
      blob(light, paint, 0, -0.06, 0.085, 0.4, 0.9);
      blob(light, paint, 0, 0.36, 0.16, 0.13, 0.95);
      blob(light, paint, -0.16, 0.42, 0.09, 0.08, 0.6);
      blob(light, paint, 0.16, 0.42, 0.09, 0.08, 0.6);
      // Cheekbones and the lower lids beneath the sockets.
      blob(light, paint, -0.56, 0.12, 0.3, 0.22, 0.8, -0.3);
      blob(light, paint, 0.56, 0.12, 0.3, 0.22, 0.8, 0.3);
      crease(light, paint, [-0.6, -0.12, -0.38, -0.05, -0.16, -0.13], 0.06, 0.5);
      crease(light, paint, [0.6, -0.12, 0.38, -0.05, 0.16, -0.13], 0.06, 0.5);
      // Upper-lip area and chin.
      blob(light, paint, 0, mouthY - 0.2, 0.32, 0.08, 0.45);
      blob(light, paint, 0, 1.08 + jaw, 0.3, 0.2, 0.85);
      blob(light, paint, -0.6, 0.85 + jaw * 0.6, 0.25, 0.3, 0.3, 0.4);
      blob(light, paint, 0.6, 0.85 + jaw * 0.6, 0.25, 0.3, 0.3, -0.4);

      // Shadows cut into the light: sockets, beside and under the nose, folds.
      light.globalCompositeOperation = "destination-out";
      blob(light, paint, -0.37, -0.24 + brow * 0.5, 0.28, 0.17, 1);
      blob(light, paint, 0.37, -0.24 + brow * 0.5, 0.28, 0.17, 1);
      blob(light, paint, -0.15, 0.08, 0.06, 0.26, 0.55);
      blob(light, paint, 0.15, 0.08, 0.06, 0.26, 0.55);
      blob(light, paint, -0.08, 0.475, 0.045, 0.03, 0.9);
      blob(light, paint, 0.08, 0.475, 0.045, 0.03, 0.9);
      blob(light, paint, 0, 0.53, 0.18, 0.05, 0.6);
      crease(light, paint, [-0.24, 0.42, -0.4, 0.62, -0.46, mouthY + 0.12], 0.05, 0.6);
      crease(light, paint, [0.24, 0.42, 0.4, 0.62, 0.46, mouthY + 0.12], 0.05, 0.6);
      blob(light, paint, 0, mouthY + 0.27 + jaw * 0.5, 0.22, 0.06, 0.5);
      light.globalCompositeOperation = "source-over";

      // The mouth itself, scaled into the face.
      const lipScale = 0.42;
      for (const ctx of [light, dark]) {
        ctx.save();
        ctx.translate(0, mouthY);
        ctx.scale(lipScale, lipScale);
      }
      const { upper, lower, cavity, upperInner, lowerInner } = lipPaths(open);
      light.globalCompositeOperation = "destination-out";
      light.globalAlpha = 1;
      light.fill(cavity);
      light.globalCompositeOperation = "source-over";

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
      light.globalAlpha = 0.6;
      light.fill(lower);
      const cy = (lowerInner + 0.5 + 0.42 * open) / 2;
      const highlight = light.createRadialGradient(0, cy - 0.03, 0, 0, cy, 0.7);
      highlight.addColorStop(0, paint);
      highlight.addColorStop(1, "transparent");
      light.globalAlpha = 0.4;
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
      light.restore();
      dark.restore();
      light.globalAlpha = 1;

      const lightData = light.getImageData(0, 0, cols, rows).data;
      const darkData = dark.getImageData(0, 0, cols, rows).data;
      for (let i = 0; i < mask.light.length; i++) {
        // A contrast curve keeps faint base glow quiet and lets highlights carry the shape.
        mask.light[i] = Math.min(1, Math.max(0, (lightData[i * 4 + 3] / 255 - 0.08) / 0.72));
        mask.dark[i] = darkData[i * 4 + 3] / 255;
      }
      return mask;
    },
  };
}

/** Characters ordered by ink coverage, for shading the mouth in text. */
export const SHADE_RAMP = ".,:;irsXA253hMHGS#9B&@";
