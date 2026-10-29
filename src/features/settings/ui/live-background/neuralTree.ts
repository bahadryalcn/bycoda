import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/**
 * A luminous dendrite: one deterministic branching structure grows from the
 * lower edge of the pane and spreads its finest branches toward the sides.
 * The resting artwork is painted once into an offscreen layer; while the AI
 * replies, a fixed set of pulses travels from the trunk along chosen routes
 * and blooms at their synapses. Nothing grows over time.
 */

type Rgb = readonly [number, number, number];

/** Branch geometry in normalized tree units: x right, y up, trunk base at 0,0. */
type Branch = {
  x0: number;
  y0: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x1: number;
  y1: number;
  depth: number;
  parent: number;
  root: boolean;
};

const CROWN_DEPTH = 7;
const ROOT_DEPTH = 4;
const SEED = 0x2b7e1516;
const ROUTE_COUNT = 9;
const SAMPLES = 9;
const CYCLE_SECONDS = 3.6;
const TRAVEL = 0.82;
/** Resting layers larger than this are drawn directly instead of cached. */
const MAX_CACHE_PIXELS = 4_200_000;

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function growTree(): Branch[] {
  const rand = random(SEED);
  const branches: Branch[] = [];
  const grow = (
    x: number,
    y: number,
    angle: number,
    length: number,
    depth: number,
    parent: number,
    root: boolean,
    maxDepth: number,
  ) => {
    const bend = (rand() - 0.5) * (root ? 0.5 : 0.42);
    const startAngle = angle + bend;
    const endAngle = angle - bend * 0.7 + (rand() - 0.5) * 0.16;
    const x1 = x + Math.sin(angle) * length;
    const y1 = y + Math.cos(angle) * length;
    const index = branches.length;
    branches.push({
      x0: x,
      y0: y,
      c1x: x + Math.sin(startAngle) * length * 0.38,
      c1y: y + Math.cos(startAngle) * length * 0.38,
      c2x: x1 - Math.sin(endAngle) * length * 0.36,
      c2y: y1 - Math.cos(endAngle) * length * 0.36,
      x1,
      y1,
      depth,
      parent,
      root,
    });
    if (depth >= maxDepth) return;
    const count = depth === 0 && !root ? 2 : rand() < (root ? 0.25 : 0.3) ? 3 : 2;
    const spread = root ? 0.4 : depth === 0 ? 0.5 : depth === 1 ? 0.52 : 0.3 + depth * 0.02;
    for (let child = 0; child < count; child++) {
      const offset = (child / (count - 1) - 0.5) * 2 * spread;
      // A vase-shaped crown leans outward, leaving the reading column lighter.
      const lean = root ? 0 : Math.sign(x1 || offset) * 0.05 * Math.min(depth, 2);
      let next = endAngle + offset + lean + (rand() - 0.5) * 0.22;
      // Roots stay low; the crown is drawn gently upward instead of piling up at a limit.
      next = root
        ? Math.sign(next) * Math.max(1.45, Math.min(2.2, Math.abs(next)))
        : next * 0.9;
      if (!root) next = Math.max(-1.5, Math.min(1.5, next));
      const shrink = root ? 0.66 + rand() * 0.1 : 0.72 + rand() * 0.1;
      grow(x1, y1, next, length * shrink, depth + 1, index, root, maxDepth);
    }
  };
  grow(0, 0, 0, 0.17, 0, -1, false, CROWN_DEPTH);
  // Short roots anchor the trunk along the lower edge.
  for (const side of [-1, 1]) {
    for (const lean of [1.6, 1.95]) {
      grow(side * 0.01, 0.02, side * lean, 0.19, 1, -1, true, ROOT_DEPTH);
    }
  }
  return branches;
}

const BRANCHES = growTree();

/** Crown tips spread evenly across the canopy, each traced back to the trunk. */
function chooseRoutes(): number[][] {
  const tips: { index: number; angle: number }[] = [];
  BRANCHES.forEach((branch, index) => {
    if (!branch.root && branch.depth === CROWN_DEPTH) {
      tips.push({ index, angle: Math.atan2(branch.x1, branch.y1) });
    }
  });
  tips.sort((a, b) => a.angle - b.angle);
  const routes: number[][] = [];
  for (let route = 0; route < ROUTE_COUNT; route++) {
    const tip = tips[Math.round(((route + 0.5) / ROUTE_COUNT) * (tips.length - 1))]!;
    const chain: number[] = [];
    for (let index = tip.index; index >= 0; index = BRANCHES[index]!.parent) chain.unshift(index);
    routes.push(chain);
  }
  return routes;
}

const ROUTES = chooseRoutes();
// Launch order alternates sides so the light never sweeps in one direction.
const ROUTE_ORDER = [4, 1, 7, 2, 6, 0, 5, 8, 3];

/** Resolves any CSS color the browser understands into sRGB channels. */
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

/**
 * Content is designed to contrast with the pane, so its opposite approximates
 * the background. A pale accent on a light theme falls back to content ink.
 */
function readableAgainstBackground(accent: Rgb | null, content: Rgb | null | undefined) {
  if (!accent || !content) return true;
  const background = relativeLuminance(content) > 0.4 ? 0.012 : 0.98;
  const own = relativeLuminance(accent);
  return (Math.max(own, background) + 0.05) / (Math.min(own, background) + 0.05) >= 3;
}

/** A soft gaussian-like light, drawn once and stamped with drawImage. */
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

export function createNeuralTreeScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  let width = 0;
  let height = 0;
  // Pixel geometry: 8 numbers per branch (start, two controls, end).
  const geometry = new Float64Array(BRANCHES.length * 8);
  // Each route is sampled into a polyline with cumulative lengths.
  const routePoints = ROUTES.map((chain) => new Float64Array(chain.length * SAMPLES * 2 + 2));
  const routeLengths = ROUTES.map((chain) => new Float64Array(chain.length * SAMPLES + 1));
  let unit = 1;
  let cache: HTMLCanvasElement | null = null;
  let cacheKey = "";
  let accentRgb: Rgb | null | undefined;
  let contentRgb: Rgb | null | undefined;
  let accentGlow: HTMLCanvasElement | null = null;
  let accentReadable = true;
  // Scratch output of pointAt, kept outside the frame loop to avoid allocation.
  let px = 0;
  let py = 0;

  const layout = () => {
    // Tree units map to pixels; wide panes stretch the crown toward both sides.
    unit = Math.min(height * 1.08, width * 0.62);
    const stretch = Math.max(1, Math.min(1.9, width / Math.max(1, height * 1.12)));
    const cx = width / 2;
    const base = height - Math.min(height * 0.04, unit * 0.03);
    BRANCHES.forEach((branch, index) => {
      const o = index * 8;
      geometry[o] = cx + branch.x0 * unit * stretch;
      geometry[o + 1] = base - branch.y0 * unit;
      geometry[o + 2] = cx + branch.c1x * unit * stretch;
      geometry[o + 3] = base - branch.c1y * unit;
      geometry[o + 4] = cx + branch.c2x * unit * stretch;
      geometry[o + 5] = base - branch.c2y * unit;
      geometry[o + 6] = cx + branch.x1 * unit * stretch;
      geometry[o + 7] = base - branch.y1 * unit;
    });
    ROUTES.forEach((chain, route) => {
      const points = routePoints[route]!;
      const lengths = routeLengths[route]!;
      let n = 0;
      points[0] = geometry[chain[0]! * 8]!;
      points[1] = geometry[chain[0]! * 8 + 1]!;
      lengths[0] = 0;
      for (const index of chain) {
        const o = index * 8;
        for (let s = 1; s <= SAMPLES; s++) {
          const t = s / SAMPLES;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const c = 3 * u * t * t;
          const d = t * t * t;
          const x = a * geometry[o]! + b * geometry[o + 2]! + c * geometry[o + 4]! + d * geometry[o + 6]!;
          const y =
            a * geometry[o + 1]! + b * geometry[o + 3]! + c * geometry[o + 5]! + d * geometry[o + 7]!;
          n++;
          points[n * 2] = x;
          points[n * 2 + 1] = y;
          lengths[n] = lengths[n - 1]! + Math.hypot(x - points[n * 2 - 2]!, y - points[n * 2 - 1]!);
        }
      }
    });
  };

  /** Writes the point at arc length `distance` of a route into px/py; returns its sample index. */
  const pointAt = (route: number, distance: number) => {
    const points = routePoints[route]!;
    const lengths = routeLengths[route]!;
    const last = lengths.length - 1;
    if (distance <= 0) {
      px = points[0]!;
      py = points[1]!;
      return 0;
    }
    if (distance >= lengths[last]!) {
      px = points[last * 2]!;
      py = points[last * 2 + 1]!;
      return last;
    }
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (lengths[mid]! <= distance) low = mid;
      else high = mid;
    }
    const span = lengths[high]! - lengths[low]! || 1;
    const t = (distance - lengths[low]!) / span;
    px = points[low * 2]! + (points[high * 2]! - points[low * 2]!) * t;
    py = points[low * 2 + 1]! + (points[high * 2 + 1]! - points[low * 2 + 1]!) * t;
    return low;
  };

  const traceBranches = (ctx: CanvasRenderingContext2D, depth: number, root: boolean) => {
    ctx.beginPath();
    BRANCHES.forEach((branch, index) => {
      if (branch.depth !== depth || branch.root !== root) return;
      const o = index * 8;
      ctx.moveTo(geometry[o]!, geometry[o + 1]!);
      ctx.bezierCurveTo(
        geometry[o + 2]!,
        geometry[o + 3]!,
        geometry[o + 4]!,
        geometry[o + 5]!,
        geometry[o + 6]!,
        geometry[o + 7]!,
      );
    });
  };

  const branchWidth = (depth: number) => Math.max(0.5, (unit / 260) * 2.3 * 0.66 ** depth);

  /** The resting artwork. `rich` adds gradients, glows and reading-column relief. */
  const paintStatic = (ctx: CanvasRenderingContext2D, rich: boolean) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const cx = width / 2;

    if (rich && accentRgb) {
      // A faint accent atmosphere low in the pane gives the structure depth.
      ctx.save();
      ctx.translate(cx, height * 0.98);
      ctx.scale(Math.max(1, width / Math.max(1, height)) * 0.9, 0.62);
      const radius = height * 0.95;
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      halo.addColorStop(0, rgba(accentRgb, 0.16));
      halo.addColorStop(0.35, rgba(accentRgb, 0.07));
      halo.addColorStop(1, rgba(accentRgb, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }

    ctx.strokeStyle = palette.content;
    for (let depth = 1; depth <= ROOT_DEPTH; depth++) {
      traceBranches(ctx, depth, true);
      ctx.globalAlpha = 0.42 - depth * 0.08;
      ctx.lineWidth = branchWidth(depth + 1);
      ctx.stroke();
    }
    for (let depth = 0; depth <= CROWN_DEPTH; depth++) {
      traceBranches(ctx, depth, false);
      ctx.globalAlpha = 0.64 - depth * 0.035;
      ctx.lineWidth = branchWidth(depth);
      ctx.stroke();
    }

    // Synapses: quiet content points at every tip, accent light at a few.
    const dot = Math.max(0.8, unit / 520);
    ctx.fillStyle = palette.content;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    BRANCHES.forEach((branch, index) => {
      if (branch.root || branch.depth < CROWN_DEPTH - 1) return;
      const o = index * 8 + 6;
      ctx.moveTo(geometry[o]! + dot, geometry[o + 1]!);
      ctx.arc(geometry[o]!, geometry[o + 1]!, dot, 0, Math.PI * 2);
    });
    ctx.fill();

    const glow = rich ? accentGlow : null;
    BRANCHES.forEach((branch, index) => {
      if (branch.root || branch.depth !== CROWN_DEPTH || index % 5 !== 0) return;
      const x = geometry[index * 8 + 6]!;
      const y = geometry[index * 8 + 7]!;
      if (glow) {
        const size = Math.max(14, unit * 0.05);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(glow, x - size / 2, y - size / 2, size, size);
      }
    });
    ctx.fillStyle = palette.accent;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    BRANCHES.forEach((branch, index) => {
      if (branch.root || branch.depth !== CROWN_DEPTH || index % 5 !== 0) return;
      const o = index * 8 + 6;
      ctx.moveTo(geometry[o]! + dot * 1.4, geometry[o + 1]!);
      ctx.arc(geometry[o]!, geometry[o + 1]!, dot * 1.4, 0, Math.PI * 2);
    });
    ctx.fill();
    ctx.globalAlpha = 1;

    if (rich) {
      // Reading-column relief: soften whatever crosses the centre of the chat.
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.translate(cx, height * 0.36);
      const rx = Math.min(width * 0.36, 30 * 16);
      const ry = height * 0.62;
      ctx.scale(rx / ry, 1);
      const relief = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
      relief.addColorStop(0, "rgba(0,0,0,0.55)");
      relief.addColorStop(0.55, "rgba(0,0,0,0.32)");
      relief.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = relief;
      ctx.fillRect(-ry, -ry, ry * 2, ry * 2);
      ctx.restore();
    }
  };

  /** Bounded cache of the resting layer at the destination's backing resolution. */
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

  /** A tapered trail from `from` to `to` along a route, as one polyline. */
  const strokeRoute = (ctx: CanvasRenderingContext2D, route: number, from: number, to: number) => {
    const points = routePoints[route]!;
    const lengths = routeLengths[route]!;
    let index = pointAt(route, from);
    ctx.beginPath();
    ctx.moveTo(px, py);
    while (index + 1 < lengths.length && lengths[index + 1]! < to) {
      index++;
      ctx.lineTo(points[index * 2]!, points[index * 2 + 1]!);
    }
    pointAt(route, to);
    ctx.lineTo(px, py);
    ctx.stroke();
  };

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(0, nextWidth);
      height = Math.max(0, nextHeight);
      cacheKey = "";
      if (width > 0 && height > 0) layout();
    },

    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (width <= 0 || height <= 0) return;

      const layer = cachedLayer(ctx);
      if (layer) ctx.drawImage(layer, 0, 0, width, height);
      else paintStatic(ctx, false);

      const presence = Math.max(0, Math.min(1, signal.presence));
      if (presence <= 0.002) return;
      const energy = Math.max(0, Math.min(1, signal.energy ?? 0));
      const glow = layer ? accentGlow : null;
      const strength = presence * (0.82 + energy * 0.18);
      const head = Math.max(1.1, unit / 300);

      // Light adds up on dark themes; on light themes it stays an ordinary tint.
      const additive = layer !== null && contentRgb != null && relativeLuminance(contentRgb) > 0.4;
      if (additive) ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const ink = accentReadable ? palette.accent : palette.content;
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      for (let slot = 0; slot < ROUTE_COUNT; slot++) {
        const route = ROUTE_ORDER[slot]!;
        const lengths = routeLengths[route]!;
        const total = lengths[lengths.length - 1]!;
        const cycle = (((time / CYCLE_SECONDS + slot / ROUTE_COUNT) % 1) + 1) % 1;
        if (cycle < TRAVEL) {
          // Ease out of the trunk, glide through the canopy, settle at the tip.
          const t = cycle / TRAVEL;
          const eased = t * t * (3 - 2 * t) * 0.65 + t * 0.35;
          const distance = eased * total;
          const fadeIn = Math.min(1, t * 6);
          const tail = total * 0.2;
          // The branch the light has passed keeps a faint glow, then a bright tapered tail.
          ctx.globalAlpha = strength * fadeIn * 0.16;
          ctx.lineWidth = head * 0.9;
          strokeRoute(ctx, route, 0, distance);
          for (let part = 0; part < 3; part++) {
            ctx.globalAlpha = strength * fadeIn * (0.18 + part * 0.22);
            ctx.lineWidth = head * (0.9 + part * 0.35);
            strokeRoute(
              ctx,
              route,
              distance - tail * (1 - part / 3),
              distance - tail * (1 - (part + 1) / 3),
            );
          }
          pointAt(route, distance);
          if (glow) {
            const size = head * 22;
            ctx.globalAlpha = strength * fadeIn * 0.9;
            ctx.drawImage(glow, px - size / 2, py - size / 2, size, size);
          }
          ctx.globalAlpha = strength * fadeIn;
          ctx.beginPath();
          ctx.arc(px, py, head * 1.2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Arrival: the synapse blooms and the route's afterglow fades out.
          const fade = 1 - (cycle - TRAVEL) / (1 - TRAVEL);
          const bloom = fade * fade;
          ctx.globalAlpha = strength * bloom * 0.16;
          ctx.lineWidth = head * 0.9;
          strokeRoute(ctx, route, 0, total);
          pointAt(route, total);
          if (glow) {
            const size = head * (22 + (1 - fade) * 18);
            ctx.globalAlpha = strength * bloom * 0.95;
            ctx.drawImage(glow, px - size / 2, py - size / 2, size, size);
          }
          ctx.globalAlpha = strength * bloom;
          ctx.beginPath();
          ctx.arc(px, py, head * (1.2 + (1 - fade)), 0, Math.PI * 2);
          ctx.fill();
        }
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
