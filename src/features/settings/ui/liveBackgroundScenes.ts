import type { LiveBackground } from "../model/liveBackground";
import { createMouthMask, drawDotMouth, SHADE_RAMP, type Mouth } from "./liveBackgroundMouth";

export { CLOSED_MOUTH, createMouthDriver, type Mouth } from "./liveBackgroundMouth";

/** Colors are resolved theme tokens; channels are 0-255 for ImageData scenes. */
export type LiveBackgroundPalette = {
  content: string;
  accent: string;
  contentRgb: readonly [number, number, number];
  accentRgb: readonly [number, number, number];
  monoFont: string;
};

export type LiveBackgroundScene = {
  resize(width: number, height: number): void;
  /** `time` and `delta` are seconds. Drawing happens in CSS pixels. */
  draw(ctx: CanvasRenderingContext2D, time: number, delta: number, mouth: Mouth): void;
};

const TAU = Math.PI * 2;

export function createLiveBackgroundScene(
  kind: Exclude<LiveBackground, "none">,
  palette: LiveBackgroundPalette,
): LiveBackgroundScene {
  switch (kind) {
    case "code-rain":
      return codeRain(palette);
    case "galaxy":
      return galaxy(palette);
    case "water":
      return water(palette);
    case "aurora":
      return aurora(palette);
  }
}

function lowResCanvas(width: number, height: number, scale: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width / scale));
  canvas.height = Math.max(1, Math.ceil(height / scale));
  return canvas;
}

const GLYPHS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function codeRain(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const size = 13;
  const cellW = Math.round(size * 0.66);
  const cellH = Math.round(size * 1.3);
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let glyphs = new Uint8Array(0);
  const mouthMask = createMouthMask();
  let heads = new Float32Array(0);
  let speeds = new Float32Array(0);
  let trails = new Float32Array(0);
  let flickerDebt = 0;

  const resetColumn = (col: number, start: number) => {
    heads[col] = start;
    speeds[col] = 3 + Math.random() * 11;
    trails[col] = 6 + Math.random() * 18;
  };

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      cols = Math.ceil(width / cellW);
      rows = Math.ceil(height / cellH);
      glyphs = new Uint8Array(cols * rows);
      for (let i = 0; i < glyphs.length; i++) glyphs[i] = Math.floor(Math.random() * GLYPHS.length);
      heads = new Float32Array(cols);
      speeds = new Float32Array(cols);
      trails = new Float32Array(cols);
      for (let col = 0; col < cols; col++) resetColumn(col, Math.random() * rows * 2 - rows);
    },
    draw(ctx, time, delta, mouth) {
      ctx.clearRect(0, 0, width, height);
      const speaking = mouth.presence > 0.01;
      const faceCols = cols;
      const faceRows = rows;
      const mask = speaking
        ? mouthMask.render(
            faceCols,
            faceRows,
            cellW,
            cellH,
            width,
            height,
            mouth.open,
            palette.accent,
          )
        : null;
      // Rain cells over the face give way to it; around the face the rain dims.
      const shade = (cell: number) => {
        if (!mask) return 1;
        const col = cell % cols;
        const x = Math.min(faceCols - 1, Math.floor(((col + 0.5) * cellW) / cellW));
        const y = Math.min(faceRows - 1, Math.floor((((cell - col) / cols + 0.5) * cellH) / cellH));
        const face = y * faceCols + x;
        return 1 - mouth.presence * Math.max(mask.dark[face] * 0.92, mask.light[face]);
      };
      flickerDebt += glyphs.length * delta * 0.35;
      while (flickerDebt >= 1) {
        flickerDebt -= 1;
        glyphs[Math.floor(Math.random() * glyphs.length)] = Math.floor(
          Math.random() * GLYPHS.length,
        );
      }
      for (let col = 0; col < cols; col++) {
        heads[col] += speeds[col] * delta;
        if (heads[col] - trails[col] > rows) resetColumn(col, -Math.random() * rows * 0.5);
      }
      ctx.font = `${size}px ${palette.monoFont}`;
      ctx.textBaseline = "top";

      // Slow interference keeps patches of the grid brighter than others.
      ctx.fillStyle = palette.content;
      for (let row = 0; row < rows; row++) {
        const rowWave = Math.cos(row * 0.13 - time * 0.17);
        for (let col = 0; col < cols; col++) {
          const field = 0.5 + 0.5 * Math.sin(col * 0.07 + time * 0.21) * rowWave;
          const alpha = (0.06 + 0.3 * field * field) * shade(row * cols + col);
          if (alpha < 0.08) continue;
          ctx.globalAlpha = alpha;
          ctx.fillText(GLYPHS[glyphs[row * cols + col]], col * cellW, row * cellH);
        }
      }

      ctx.fillStyle = palette.accent;
      for (let col = 0; col < cols; col++) {
        const head = heads[col];
        const trail = trails[col];
        const first = Math.max(0, Math.ceil(head - trail));
        const last = Math.min(rows - 1, Math.floor(head));
        for (let row = first; row <= last; row++) {
          const fade = 1 - (head - row) / trail;
          ctx.globalAlpha = (row === last ? 1 : fade * fade * 0.85) * shade(row * cols + col);
          ctx.fillText(GLYPHS[glyphs[row * cols + col]], col * cellW, row * cellH);
        }
      }

      // The face is ASCII-shaded: denser characters where it is brighter. A slow
      // per-cell jitter keeps the characters shimmering like the rain around them.
      if (mask) {
        const tick = Math.floor(time * 4);
        for (let cell = 0; cell < mask.light.length; cell++) {
          const value = mask.light[cell];
          if (value < 0.05) continue;
          const col = cell % faceCols;
          const row = (cell - col) / faceCols;
          const noise = Math.sin(col * 12.9898 + row * 78.233 + tick * 0.37) * 43758.5453;
          const jitter = Math.floor((noise - Math.floor(noise)) * 3) - 1;
          const index = Math.min(
            SHADE_RAMP.length - 1,
            Math.max(0, Math.floor(value * SHADE_RAMP.length) + jitter),
          );
          ctx.globalAlpha = mouth.presence * (0.3 + 0.7 * value);
          ctx.fillText(SHADE_RAMP[index], col * cellW, row * cellH);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}

/**
 * Density-wave galaxy (after beltoforion's spiral galaxy renderer): every star
 * moves on an ellipse whose tilt grows with its radius, so the arms emerge
 * where neighbouring orbits crowd together. Radii follow a de Vaucouleurs-like
 * bulge plus an exponential disk. Light is accumulated at half resolution,
 * bloomed, tone-mapped and colored from the theme tokens: the old core takes
 * the content color, the young outer arms the accent.
 */
function galaxy(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const scale = 2;
  const bloomScale = 4;
  const mouthMask = createMouthMask();
  let width = 0;
  let height = 0;
  let bw = 0;
  let bh = 0;
  let low: HTMLCanvasElement | null = null;
  let lowCtx: CanvasRenderingContext2D | null = null;
  let image: ImageData | null = null;
  let core = new Float32Array(0);
  let arms = new Float32Array(0);
  let bloomCore = new Float32Array(0);
  let bloomArms = new Float32Array(0);
  let scratch = new Float32Array(0);
  let sw = 0;
  let sh = 0;
  let count = 0;
  let semi = new Float32Array(0);
  let theta = new Float32Array(0);
  let omega = new Float32Array(0);
  let brightness = new Float32Array(0);
  let youth = new Float32Array(0);
  let scatterX = new Float32Array(0);
  let scatterY = new Float32Array(0);
  let field: { x: number; y: number; size: number; phase: number }[] = [];
  let radius = 0;

  const coreRadius = () => radius * 0.18;
  const eccentricity = (a: number) => {
    const rc = coreRadius();
    if (a < rc) return 1 + (a / rc) * (0.6 - 1);
    if (a < radius) return 0.6 + ((a - rc) / (radius - rc)) * (0.78 - 0.6);
    if (a < radius * 2) return 0.78 + ((a - radius) / radius) * (1 - 0.78);
    return 1;
  };

  const blur = (data: Float32Array) => {
    // Two box passes per axis approximate a gaussian.
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          let sum = 0;
          for (let k = -2; k <= 2; k++) sum += data[y * sw + Math.min(sw - 1, Math.max(0, x + k))];
          scratch[y * sw + x] = sum / 5;
        }
      }
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          let sum = 0;
          for (let k = -2; k <= 2; k++)
            sum += scratch[Math.min(sh - 1, Math.max(0, y + k)) * sw + x];
          data[y * sw + x] = sum / 5;
        }
      }
    }
  };

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      low = lowResCanvas(width, height, scale);
      lowCtx = low.getContext("2d");
      bw = low.width;
      bh = low.height;
      image = lowCtx?.createImageData(bw, bh) ?? null;
      core = new Float32Array(bw * bh);
      arms = new Float32Array(bw * bh);
      sw = Math.ceil(bw / bloomScale);
      sh = Math.ceil(bh / bloomScale);
      bloomCore = new Float32Array(sw * sh);
      bloomArms = new Float32Array(sw * sh);
      scratch = new Float32Array(sw * sh);

      radius = Math.min(bw * 0.4, bh * 0.75);
      count = Math.round(Math.min(16000, Math.max(5000, (bw * bh) / 14)));
      semi = new Float32Array(count);
      theta = new Float32Array(count);
      omega = new Float32Array(count);
      brightness = new Float32Array(count);
      youth = new Float32Array(count);
      scatterX = new Float32Array(count);
      scatterY = new Float32Array(count);
      const rc = coreRadius();
      const diskScale = radius * 0.45;
      const diskLimit = 1 - Math.exp(-(radius * 1.6) / diskScale);
      for (let i = 0; i < count; i++) {
        const bulge = Math.random() < 0.1;
        const a = bulge
          ? rc * 1.5 * Math.pow(Math.random(), 2.6)
          : -diskScale * Math.log(1 - Math.random() * diskLimit);
        semi[i] = a;
        theta[i] = Math.random() * TAU;
        // Rises like a solid body in the core, then flattens (an Sb rotation curve).
        omega[i] = (0.045 * radius * Math.min(1, a / rc)) / Math.max(a, rc * 0.4);
        brightness[i] = (bulge ? 0.22 : 0.42) + 0.7 * Math.pow(Math.random(), 4);
        // Scatter around the orbit widens the arms into soft bands.
        const spread = radius * (0.015 + 0.05 * Math.min(1, a / radius));
        scatterX[i] = (Math.random() + Math.random() + Math.random() - 1.5) * spread;
        scatterY[i] = (Math.random() + Math.random() + Math.random() - 1.5) * spread;
        youth[i] = Math.min(1, Math.max(0, a / radius - 0.15 + (Math.random() - 0.5) * 0.5));
      }
      field = Array.from({ length: Math.round((width * height) / 3500) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 0.6 + Math.random() * 0.9,
        phase: Math.random() * TAU,
      }));
    },
    draw(ctx, time, delta, mouth) {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = palette.content;
      for (const star of field) {
        ctx.globalAlpha = 0.2 + 0.2 * Math.sin(time * 1.1 + star.phase);
        ctx.fillRect(star.x, star.y, star.size, star.size);
      }
      ctx.globalAlpha = 1;
      if (!low || !lowCtx || !image) return;

      core.fill(0);
      arms.fill(0);
      const cx = bw / 2;
      const cy = bh / 2;
      const view = -0.42;
      const cosView = Math.cos(view);
      const sinView = Math.sin(view);
      const twist = 5.6 / radius;
      for (let i = 0; i < count; i++) {
        const a = semi[i];
        theta[i] += omega[i] * delta;
        const b = a * eccentricity(a);
        const tilt = a * twist;
        const ex = a * Math.cos(theta[i]);
        const ey = b * Math.sin(theta[i]);
        const gx = ex * Math.cos(tilt) - ey * Math.sin(tilt) + scatterX[i];
        // Seen at an inclination, the disk flattens vertically.
        const gy = (ex * Math.sin(tilt) + ey * Math.cos(tilt) + scatterY[i]) * 0.58;
        const px = Math.round(cx + gx * cosView - gy * sinView);
        const py = Math.round(cy + gx * sinView + gy * cosView);
        if (px < 0 || py < 0 || px >= bw || py >= bh) continue;
        const index = py * bw + px;
        const light = brightness[i];
        core[index] += light * (1 - youth[i]);
        arms[index] += light * youth[i];
      }

      bloomCore.fill(0);
      bloomArms.fill(0);
      for (let y = 0; y < bh; y++) {
        const row = Math.min(sh - 1, Math.floor(y / bloomScale)) * sw;
        for (let x = 0; x < bw; x++) {
          const target = row + Math.min(sw - 1, Math.floor(x / bloomScale));
          bloomCore[target] += core[y * bw + x];
          bloomArms[target] += arms[y * bw + x];
        }
      }
      blur(bloomCore);
      blur(bloomArms);

      const [cr, cg, cb] = palette.contentRgb;
      const [ar, ag, ab] = palette.accentRgb;
      const data = image.data;
      const glow = 0.14;
      for (let y = 0; y < bh; y++) {
        const fy = Math.min(sh - 1.001, y / bloomScale);
        const y0 = Math.floor(fy);
        const ty = fy - y0;
        for (let x = 0; x < bw; x++) {
          const fx = Math.min(sw - 1.001, x / bloomScale);
          const x0 = Math.floor(fx);
          const tx = fx - x0;
          const i00 = y0 * sw + x0;
          const w00 = (1 - tx) * (1 - ty);
          const w01 = tx * (1 - ty);
          const w10 = (1 - tx) * ty;
          const w11 = tx * ty;
          const i = y * bw + x;
          const old =
            core[i] +
            (bloomCore[i00] * w00 +
              bloomCore[i00 + 1] * w01 +
              bloomCore[i00 + sw] * w10 +
              bloomCore[i00 + sw + 1] * w11) *
              glow;
          const young =
            arms[i] +
            (bloomArms[i00] * w00 +
              bloomArms[i00 + 1] * w01 +
              bloomArms[i00 + sw] * w10 +
              bloomArms[i00 + sw + 1] * w11) *
              glow;
          const total = old + young;
          const o = i * 4;
          if (total < 0.004) {
            data[o + 3] = 0;
            continue;
          }
          data[o] = (cr * old + ar * young) / total;
          data[o + 1] = (cg * old + ag * young) / total;
          data[o + 2] = (cb * old + ab * young) / total;
          // Exponential tone mapping keeps the dense core from clipping hard.
          data[o + 3] = 255 * (1 - Math.exp(-total * 0.9));
        }
      }
      lowCtx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(low, 0, 0, width, height);
      drawDotMouth(ctx, mouthMask, width, height, mouth, time, palette.accent);
    },
  };
}

function water(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const mouthMask = createMouthMask();
  const life = 4.5;
  let width = 0;
  let height = 0;
  let ripples: { x: number; y: number; born: number; speed: number }[] = [];
  let nextDrop = 0;
  let caustics: HTMLCanvasElement | null = null;
  let causticsCtx: CanvasRenderingContext2D | null = null;
  let image: ImageData | null = null;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      ripples = [];
      nextDrop = 0;
      caustics = lowResCanvas(width, height, 10);
      causticsCtx = caustics.getContext("2d");
      image = causticsCtx?.createImageData(caustics.width, caustics.height) ?? null;
    },
    draw(ctx, time, _delta, mouth) {
      ctx.clearRect(0, 0, width, height);
      if (caustics && causticsCtx && image) {
        const [r, g, b] = palette.accentRgb;
        const data = image.data;
        const w = caustics.width;
        const h = caustics.height;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const v =
              Math.sin(x * 0.21 + time * 0.7) +
              Math.sin(y * 0.27 - time * 0.5) +
              Math.sin((x + y) * 0.15 + time * 0.4) +
              Math.sin(Math.hypot(x - w / 2, y - h / 2) * 0.18 - time * 0.9);
            const light = Math.max(0, 1 - Math.abs(v) * 0.9);
            const i = (y * w + x) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = light * light * 110;
          }
        }
        causticsCtx.putImageData(image, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(caustics, 0, 0, width, height);
      }

      if (time >= nextDrop) {
        ripples.push({
          x: Math.random() * width,
          y: Math.random() * height,
          born: time,
          speed: 45 + Math.random() * 40,
        });
        nextDrop = time + 0.35 + Math.random() * 0.9;
      }
      ripples = ripples.filter((ripple) => time - ripple.born < life);
      ctx.lineWidth = 1.2;
      for (const ripple of ripples) {
        const age = time - ripple.born;
        const fade = Math.pow(1 - age / life, 1.6);
        for (let ring = 0; ring < 3; ring++) {
          const radius = age * ripple.speed - ring * 14;
          if (radius <= 0) continue;
          ctx.strokeStyle = ring === 0 ? palette.accent : palette.content;
          ctx.globalAlpha = fade * (ring === 0 ? 0.9 : 0.45 / ring);
          ctx.beginPath();
          ctx.ellipse(ripple.x, ripple.y, radius, radius * 0.45, 0, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      drawDotMouth(ctx, mouthMask, width, height, mouth, time, palette.content);
    },
  };
}

function aurora(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const mouthMask = createMouthMask();
  const scale = 6;
  let width = 0;
  let height = 0;
  let low: HTMLCanvasElement | null = null;
  let lowCtx: CanvasRenderingContext2D | null = null;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      low = lowResCanvas(width, height, scale);
      lowCtx = low.getContext("2d");
    },
    draw(ctx, time, _delta, mouth) {
      ctx.clearRect(0, 0, width, height);
      if (!low || !lowCtx) return;
      const w = low.width;
      const h = low.height;
      lowCtx.clearRect(0, 0, w, h);
      lowCtx.globalCompositeOperation = "lighter";
      for (let band = 0; band < 3; band++) {
        lowCtx.fillStyle = band === 1 ? palette.content : palette.accent;
        const base = h * (0.22 + band * 0.16);
        const amplitude = h * (0.07 + band * 0.02);
        for (let x = 0; x < w; x++) {
          const y =
            base +
            Math.sin(x * 0.035 + time * 0.25 + band * 1.7) * amplitude +
            Math.sin(x * 0.011 - time * 0.13 + band) * amplitude * 1.4;
          const curtain = 0.5 + 0.5 * Math.sin(x * 0.09 + time * 0.6 + band * 2.3);
          const tall = h * (0.12 + 0.1 * curtain);
          lowCtx.globalAlpha = (band === 1 ? 0.12 : 0.22) * (0.4 + 0.6 * curtain);
          lowCtx.fillRect(x, y - tall, 1, tall);
          lowCtx.globalAlpha *= 0.5;
          lowCtx.fillRect(x, y - tall * 1.8, 1, tall * 0.8);
        }
      }
      lowCtx.globalCompositeOperation = "source-over";
      lowCtx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(low, 0, 0, width, height);
      drawDotMouth(ctx, mouthMask, width, height, mouth, time, palette.content);
    },
  };
}
