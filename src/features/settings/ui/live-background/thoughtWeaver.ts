import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/**
 * Woven ribbons drift through the lower pane. Each ribbon is made of fine
 * warp threads with weft crossing them, and it turns slowly over its length
 * so the cloth shows depth and a satin sheen. The resting artwork is painted
 * once into an offscreen layer. While the AI replies, a small light shuttle
 * travels along the front ribbon and stitches a glowing weft through it. The
 * clock is integrated from presence, so pausing never makes the shuttle jump.
 */

type Rgb = readonly [number, number, number];

type Ribbon = {
  /** Vertical centre and two gentle waves, as fractions of the pane height. */
  y: number;
  waves: readonly (readonly [amplitude: number, frequency: number, offset: number])[];
  /** Half-width relative to the pane height. */
  width: number;
  /** Twist angle at the left edge and its change across the pane. */
  twist: number;
  turn: number;
  alpha: number;
  accentEvery: number;
};

const RIBBONS: readonly Ribbon[] = [
  // A far ribbon crosses behind the front one, so the pair reads as woven.
  {
    y: 0.71,
    waves: [
      [-0.085, 0.62, 2.6],
      [0.02, 1.7, 0.4],
    ],
    width: 0.07,
    twist: 2.2,
    turn: -4.1,
    alpha: 0.5,
    accentEvery: 0,
  },
  {
    y: 0.73,
    waves: [
      [0.095, 0.75, 0.9],
      [0.022, 1.6, 2.0],
    ],
    width: 0.12,
    twist: 0.62,
    turn: 5.3,
    alpha: 1,
    accentEvery: 9,
  },
];
const FRONT = RIBBONS.length - 1;

type Shuttle = { ribbon: number; start: number; rate: number; sway: number; level: number };

/** The front shuttle rests left of the reading column; a quieter one rests at the right. */
const SHUTTLES: readonly Shuttle[] = [
  { ribbon: 0, start: 0.86, rate: -0.03, sway: 2.1, level: 0.6 },
  { ribbon: FRONT, start: 0.17, rate: 0.042, sway: 2.6, level: 1 },
];

/** Thread counts: detailed when cached, lighter when drawn directly every frame. */
const RICH = { warp: 30, samples: 360, weftStep: 2 };
const DIRECT = { warp: 10, samples: 56, weftStep: 1 };
const BINS = 8;
const TRAIL = 48;
const MAX_CACHE_PIXELS = 4_200_000;

function readRgb(color: string): Rgb | null {
  if (typeof document === "undefined") return null;
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  return [data[0]!, data[1]!, data[2]!];
}

const rgba = ([r, g, b]: Rgb, alpha: number) => `rgba(${r},${g},${b},${alpha})`;
const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const relativeLuminance = ([r, g, b]: Rgb) =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** A pale accent on a light theme falls back to content ink for the shuttle. */
function readableAgainstBackground(accent: Rgb | null, content: Rgb | null | undefined) {
  if (!accent || !content) return true;
  const background = relativeLuminance(content) > 0.4 ? 0.012 : 0.98;
  const own = relativeLuminance(accent);
  return (Math.max(own, background) + 0.05) / (Math.min(own, background) + 0.05) >= 3;
}

function createGlow(rgb: Rgb): HTMLCanvasElement | null {
  const size = 96;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const stops: readonly (readonly [number, number])[] = [
    [0, 1],
    [0.08, 0.78],
    [0.2, 0.36],
    [0.38, 0.13],
    [0.62, 0.035],
    [1, 0],
  ];
  for (const [offset, alpha] of stops) gradient.addColorStop(offset, rgba(rgb, alpha));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

export function createThoughtWeaverScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  let phase = 0;
  let cache: HTMLCanvasElement | null = null;
  let cacheKey = "";
  let accentRgb: Rgb | null | undefined;
  let contentRgb: Rgb | null | undefined;
  let accentGlow: HTMLCanvasElement | null = null;
  let accentReadable = true;
  // Scratch outputs, reused to avoid per-frame allocation.
  let fx = 0;
  let fy = 0;
  let fnx = 0;
  let fny = 0;
  let ftheta = 0;
  let fcos = 1;
  let fsin = 0;
  let px = 0;
  let py = 0;

  /** Centre, normal and twist of a ribbon at s ∈ [0, 1] across the pane. */
  const frame = (ribbon: Ribbon, s: number) => {
    let y = ribbon.y;
    let slope = 0;
    for (const [amplitude, frequency, offset] of ribbon.waves) {
      const angle = Math.PI * 2 * frequency * s + offset;
      y += amplitude * Math.sin(angle);
      slope += amplitude * Math.PI * 2 * frequency * Math.cos(angle);
    }
    const dx = width * 1.16;
    const dy = height * slope;
    const length = Math.hypot(dx, dy) || 1;
    fx = width * (-0.08 + 1.16 * s);
    fy = height * y;
    fnx = -dy / length;
    fny = dx / length;
    ftheta = ribbon.twist + ribbon.turn * s;
    fcos = Math.cos(ftheta);
    fsin = Math.sin(ftheta);
  };

  /** Position of thread offset k ∈ [-1, 1] across the ribbon at the current frame. */
  const across = (ribbon: Ribbon, k: number) => {
    const half = height * ribbon.width;
    px = fx + fnx * half * k * fcos;
    py = fy + fny * half * k * fcos - half * k * fsin * 0.42;
  };

  /** Cloth facing the viewer is brighter; the turned-away side is quieter. */
  const facing = (k: number) => {
    // A narrow satin highlight drifts across the threads as the ribbon turns.
    const sheen = Math.max(0, Math.cos(ftheta - 0.7 + k * 0.5)) ** 8;
    return (0.28 + 0.72 * Math.abs(fcos)) * (fcos >= 0 ? 1 : 0.62) + sheen * 0.45;
  };

  const paintRibbon = (ctx: CanvasRenderingContext2D, ribbon: Ribbon, rich: boolean) => {
    const { warp, samples, weftStep } = rich ? RICH : DIRECT;
    const edgeFade = (s: number) => Math.min(1, s / 0.06, (1 - s) / 0.06);

    // Warp threads run along the ribbon; segments are grouped into alpha bins.
    ctx.strokeStyle = palette.content;
    ctx.lineWidth = rich ? 0.7 : 0.8;
    const peak = 0.6 * ribbon.alpha;
    for (let bin = 1; bin <= BINS; bin++) {
      ctx.beginPath();
      let any = false;
      for (let thread = 0; thread < warp; thread++) {
        const k = (thread / (warp - 1)) * 2 - 1;
        const selvedge = thread === 0 || thread === warp - 1 ? 1.35 : 1;
        let open = false;
        for (let step = 0; step < samples; step++) {
          const s = (step + 0.5) / samples;
          frame(ribbon, s);
          const alpha = Math.min(1, facing(k) * selvedge * edgeFade(s));
          if (Math.max(1, Math.round(alpha * BINS)) !== bin || alpha < 0.02) {
            open = false;
            continue;
          }
          if (!open) {
            frame(ribbon, step / samples);
            across(ribbon, k);
            ctx.moveTo(px, py);
            open = true;
          }
          frame(ribbon, (step + 1) / samples);
          across(ribbon, k);
          ctx.lineTo(px, py);
          any = true;
        }
      }
      if (!any) continue;
      ctx.globalAlpha = (bin / BINS) * peak;
      ctx.stroke();
    }

    // Weft threads cross the ribbon; a few carry the accent as a woven stripe.
    for (const accent of [false, true]) {
      if (accent && !ribbon.accentEvery) continue;
      ctx.strokeStyle = accent ? palette.accent : palette.content;
      const weftPeak = (accent ? 0.7 : 0.3) * ribbon.alpha;
      for (let bin = 1; bin <= BINS; bin++) {
        ctx.beginPath();
        let any = false;
        for (let step = 0, index = 0; step <= samples; step += weftStep, index++) {
          const stripe = ribbon.accentEvery > 0 && index % ribbon.accentEvery === 0;
          if (stripe !== accent) continue;
          const s = step / samples;
          frame(ribbon, s);
          const alternate = index % 2 === 0 ? 1 : 0.6;
          const alpha = Math.min(1, facing(0) * alternate * edgeFade(s));
          if (Math.max(1, Math.round(alpha * BINS)) !== bin || alpha < 0.02) continue;
          across(ribbon, -1);
          ctx.moveTo(px, py);
          across(ribbon, 1);
          ctx.lineTo(px, py);
          any = true;
        }
        if (!any) continue;
        ctx.globalAlpha = (bin / BINS) * weftPeak;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  };

  const paintStatic = (ctx: CanvasRenderingContext2D, rich: boolean) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (rich && accentRgb) {
      // Low accent light pools beneath the cloth.
      const front = RIBBONS[FRONT]!;
      ctx.save();
      ctx.translate(width / 2, height * front.y);
      ctx.scale(Math.max(1.4, (width / Math.max(1, height)) * 1.05), 0.42);
      const radius = height * 0.8;
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      halo.addColorStop(0, rgba(accentRgb, 0.13));
      halo.addColorStop(0.45, rgba(accentRgb, 0.05));
      halo.addColorStop(1, rgba(accentRgb, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }
    for (const ribbon of RIBBONS) paintRibbon(ctx, ribbon, rich);
  };

  const cachedLayer = (ctx: CanvasRenderingContext2D): HTMLCanvasElement | null => {
    if (typeof document === "undefined") return null;
    const backing = (ctx as { canvas?: { width?: unknown } }).canvas;
    if (!backing || typeof backing.width !== "number" || backing.width <= 0) return null;
    const ratio = backing.width / width;
    const cacheWidth = Math.round(width * ratio);
    const cacheHeight = Math.round(height * ratio);
    if (cacheWidth * cacheHeight > MAX_CACHE_PIXELS) return null;
    const key = `${cacheWidth}x${cacheHeight}`;
    if (cache && cacheKey === key) return cache;
    if (accentRgb === undefined) accentRgb = readRgb(palette.accent);
    if (contentRgb === undefined) contentRgb = readRgb(palette.content);
    if (!accentGlow && accentRgb) accentGlow = createGlow(accentRgb);
    accentReadable = readableAgainstBackground(accentRgb, contentRgb);
    cache ??= document.createElement("canvas");
    cache.width = cacheWidth;
    cache.height = cacheHeight;
    const layer = cache.getContext("2d");
    if (!layer) return null;
    layer.setTransform(ratio, 0, 0, ratio, 0, 0);
    layer.clearRect(0, 0, width, height);
    paintStatic(layer, true);
    cacheKey = key;
    return cache;
  };

  /**
   * Where a shuttle is at a given clock value: along its ribbon and across its
   * weave. Both shuttles wrap beyond the pane's edges, never inside it.
   */
  const shuttleAt = (shuttle: Shuttle, clock: number) => {
    const travel = (((shuttle.start + clock * shuttle.rate) % 1) + 1) % 1;
    const s = 0.02 + travel * 0.98;
    const ribbon = RIBBONS[shuttle.ribbon]!;
    frame(ribbon, s);
    across(ribbon, Math.sin(clock * shuttle.sway + shuttle.start * 9) * 0.92);
    return s;
  };

  /** The stitched thread: the shuttle's most recent passes, fading behind it, then its light. */
  const paintShuttle = (
    ctx: CanvasRenderingContext2D,
    shuttle: Shuttle,
    level: number,
    scale: number,
    glow: HTMLCanvasElement | null,
  ) => {
    const groups = 6;
    const per = TRAIL / groups;
    let previous = shuttleAt(shuttle, phase);
    const headX = px;
    const headY = py;
    let lastX = px;
    let lastY = py;
    for (let group = 0; group < groups; group++) {
      ctx.globalAlpha = level * (1 - group / groups) ** 1.4;
      ctx.lineWidth = (2 - group * 0.22) * scale;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      for (let point = 1; point <= per; point++) {
        const s = shuttleAt(shuttle, phase - ((group * per + point) / TRAIL) * 3.4);
        if (Math.abs(s - previous) > 0.1) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        previous = s;
      }
      lastX = px;
      lastY = py;
      ctx.stroke();
    }
    const size = 110 * scale;
    if (glow) {
      ctx.globalAlpha = level * 0.85;
      ctx.drawImage(glow, headX - size / 2, headY - size / 2, size, size);
    }
    ctx.globalAlpha = Math.min(1, level * 1.15);
    ctx.beginPath();
    ctx.arc(headX, headY, 2.6 * scale, 0, Math.PI * 2);
    ctx.fill();
  };

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(0, nextWidth);
      height = Math.max(0, nextHeight);
      cacheKey = "";
    },

    draw(ctx, _time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (width <= 0 || height <= 0) return;

      const presence = Math.max(0, Math.min(1, signal.presence));
      const energy = Math.max(0, Math.min(1, signal.energy ?? 0));
      const dt = Number.isFinite(delta) ? Math.max(0, Math.min(0.1, delta)) : 0;
      phase += dt * presence * (1 + energy * 0.3);

      const layer = cachedLayer(ctx);
      if (layer) ctx.drawImage(layer, 0, 0, width, height);
      else paintStatic(ctx, false);
      const glow = layer ? accentGlow : null;
      const scale = Math.max(0.6, Math.min(width, height * 1.6) / 1000);
      const additive = layer !== null && contentRgb != null && relativeLuminance(contentRgb) > 0.4;
      const ink = accentReadable ? palette.accent : palette.content;

      if (additive) ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      for (const shuttle of SHUTTLES) {
        paintShuttle(ctx, shuttle, (0.3 + presence * 0.62) * shuttle.level, scale, glow);
      }
      if (additive) ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    },

    dispose() {
      if (cache) {
        cache.width = 0;
        cache.height = 0;
      }
      cache = null;
      accentGlow = null;
    },
  };
}
