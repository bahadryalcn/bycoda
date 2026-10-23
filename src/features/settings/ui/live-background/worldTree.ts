import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

const SIZE = 1000;
const STEP_X = 7;
const STEP_Y = 10;
const COLS = Math.floor(SIZE / STEP_X);
const ROWS = Math.floor(SIZE / STEP_Y);
const CODE = "{}[]<>01#=";
const LEAVES = "*+o.:'";
/** Sap pulses travelling along the tree at once. */
const WAVES = 2.2;
const MOTES = 34;
/** The cached glyph layer never exceeds this many device pixels per design unit. */
const MAX_LAYER_SCALE = 1.75;
const BASE = { x: 500, y: 752 };
const CROWN = { x: 500, y: 330, rx: 440, ry: 300 };
const ROOTS = { x: 500, y: 760, rx: 420, ry: 185 };

type Kind = 0 | 1 | 2;
const WOOD: Kind = 0;
const ROOT: Kind = 1;
const LEAF: Kind = 2;
const EMPTY = 255;

type Sample = {
  x: number;
  y: number;
  r: number;
  s: number;
  angle: number;
  kind: Kind;
};
type Cell = {
  x: number;
  y: number;
  glyph: string;
  weight: number;
  flow: number;
  phase: number;
};
type Cluster = { x: number; y: number; flow: number; phase: number };
type Path = { points: Float32Array; lengths: Float32Array; total: number };
type Mote = { path: Path; phase: number; rate: number };
/** A world and the branch or root tip it hangs from. */
type World = { x: number; y: number; tx: number; ty: number };

function seededRandom() {
  let seed = 0x79676764;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function inside(area: typeof CROWN, x: number, y: number) {
  return ((x - area.x) / area.rx) ** 2 + ((y - area.y) / area.ry) ** 2 <= 1;
}

/** Samples a cubic curve every few units, carrying radius and distance along the tree. */
function sampleCubic(
  points: readonly number[],
  r0: number,
  r1: number,
  s0: number,
  direction: number,
  kind: Kind,
): Sample[] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = points;
  const at = (t: number) => {
    const u = 1 - t;
    return [
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    ];
  };
  const steps = Math.max(4, Math.ceil(Math.hypot(x3 - x0, y3 - y0) / 3));
  const samples: Sample[] = [];
  let [px, py] = at(0);
  let s = s0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = at(t);
    s += Math.hypot(x - px, y - py) * direction;
    samples.push({
      x,
      y,
      r: r0 + (r1 - r0) * t,
      s,
      angle: i === 0 ? Math.atan2(y1 - y0, x1 - x0) : Math.atan2(y - py, x - px),
      kind,
    });
    px = x;
    py = y;
  }
  return samples;
}

function toPath(points: { x: number; y: number }[]): Path {
  const coords = new Float32Array(points.length * 2);
  const lengths = new Float32Array(points.length);
  let total = 0;
  points.forEach((point, i) => {
    coords[i * 2] = point.x;
    coords[i * 2 + 1] = point.y;
    if (i > 0) total += Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y);
    lengths[i] = total;
  });
  return { points: coords, lengths, total };
}

function pointOnPath(path: Path, progress: number): [number, number] {
  const target = progress * path.total;
  const { lengths, points } = path;
  let low = 0;
  let high = lengths.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (lengths[mid] < target) low = mid;
    else high = mid;
  }
  const span = lengths[high] - lengths[low] || 1;
  const t = Math.min(1, Math.max(0, (target - lengths[low]) / span));
  return [
    points[low * 2] + (points[high * 2] - points[low * 2]) * t,
    points[low * 2 + 1] + (points[high * 2 + 1] - points[low * 2 + 1]) * t,
  ];
}

/** Stroke direction as the ASCII line that best follows it; y grows downward. */
function lineGlyph(angle: number) {
  const t = ((angle % Math.PI) + Math.PI) % Math.PI;
  if (t < Math.PI / 8 || t > (7 * Math.PI) / 8) return "-";
  if (t < (3 * Math.PI) / 8) return "\\";
  if (t < (5 * Math.PI) / 8) return "|";
  return "/";
}

/** Original code artwork: a rounded crown, a braided trunk and spreading roots.
 * Inspired by Yggdrasil's connections between the heavens, living world and roots.
 * Geometry and glyphs are seeded, so previews, resize and reduced motion show the same tree.
 */
function growTree() {
  const random = seededRandom();
  const samples: Sample[] = [];
  const crownPaths: { x: number; y: number }[][] = [];
  const rootPaths: { x: number; y: number }[][] = [];
  const clusters: Cluster[] = [];

  const grow = (
    from: Sample,
    angle: number,
    length: number,
    radius: number,
    depth: number,
    trail: { x: number; y: number }[],
    root: boolean,
  ) => {
    const area = root ? ROOTS : CROWN;
    // Tips stay inside the crown and root envelopes, which gives the tree its silhouette.
    let ex = from.x + Math.cos(angle) * length;
    let ey = from.y + Math.sin(angle) * length;
    while (!inside(area, ex, ey) && length > 10) {
      length *= 0.86;
      ex = from.x + Math.cos(angle) * length;
      ey = from.y + Math.sin(angle) * length;
    }
    const bend = (random() - 0.5) * length * 0.6;
    const segment = sampleCubic(
      [
        from.x,
        from.y,
        from.x + Math.cos(angle) * length * 0.35 - Math.sin(angle) * bend,
        from.y + Math.sin(angle) * length * 0.35 + Math.cos(angle) * bend,
        ex - Math.cos(angle) * length * 0.2,
        ey - Math.sin(angle) * length * 0.2,
        ex,
        ey,
      ],
      radius,
      radius * 0.64,
      from.s,
      root ? -1 : 1,
      root ? ROOT : WOOD,
    );
    samples.push(...segment);
    const path = trail.concat(segment.filter((_, i) => i % 3 === 0));
    const end = segment[segment.length - 1];
    if (!root && depth <= 1) {
      clusters.push({
        x: end.x,
        y: end.y,
        flow: end.s,
        phase: random() * Math.PI * 2,
      });
      // Loose leaf clusters leave negative space between the branches, not a solid canopy.
      for (let i = 0; i < (depth === 0 ? 7 : 4); i++) {
        samples.push({
          x: end.x + (random() - 0.5) * 46,
          y: end.y + (random() - 0.6) * 30,
          r: 3 + random() * 4,
          s: end.s,
          angle: 0,
          kind: LEAF,
        });
      }
    }
    if (depth === 0) {
      (root ? rootPaths : crownPaths).push(path);
      return;
    }
    const spread = root ? 0.4 : 0.5;
    for (const side of [-1, 1]) {
      let next = angle + side * (spread + random() * 0.24);
      // Crown twigs reach upwards; roots reach out and down.
      if (!root) next = Math.max(-Math.PI + 0.1, Math.min(-0.1, next));
      else next = Math.max(0.08, Math.min(Math.PI - 0.08, next));
      grow(end, next, length * (0.62 + random() * 0.12), radius * 0.64, depth - 1, path, root);
    }
  };

  // Braided strands flare at the base and twist around each other up to the crown.
  let core: Sample[] = [];
  for (const offset of [-16, 16, -6, 6, 0]) {
    const strand = sampleCubic(
      [
        BASE.x + offset * 2.6,
        BASE.y + 8,
        BASE.x - offset * 1.7,
        620,
        BASE.x + offset * 1.7,
        470,
        BASE.x + offset * 0.4,
        352,
      ],
      offset === 0 ? 16 : 13,
      6,
      0,
      1,
      WOOD,
    );
    samples.push(...strand);
    core = strand;
  }
  const trunkTrail = (index: number) => core.slice(0, index + 1).filter((_, i) => i % 3 === 0);
  for (const [at, angle, length] of [
    [0.4, -2.82, 200],
    [0.45, -0.32, 200],
    [0.6, -2.5, 180],
    [0.65, -0.64, 180],
    [0.8, -2.14, 165],
    [0.83, -1.0, 165],
    [1, -1.57, 150],
  ]) {
    const index = Math.min(core.length - 1, Math.round(at * (core.length - 1)));
    grow(core[index], angle, length, 9, 4, trunkTrail(index), false);
  }
  const base = core[0];
  for (const [angle, length] of [
    [2.78, 175],
    [2.15, 140],
    [1.57, 118],
    [1.0, 140],
    [0.36, 175],
  ]) {
    grow(base, angle, length, 11, 3, [{ x: base.x, y: base.y }], true);
  }

  // Flow runs from the root tips (0) through the trunk to the crown tips (1).
  let low = Infinity;
  let high = -Infinity;
  for (const sample of samples) {
    low = Math.min(low, sample.s);
    high = Math.max(high, sample.s);
  }
  const normal = (s: number) => (s - low) / (high - low || 1);

  // Rasterize the strokes into one sample per text cell.
  const cover = new Float32Array(COLS * ROWS);
  const flow = new Float32Array(COLS * ROWS).fill(Infinity);
  const angle = new Float32Array(COLS * ROWS);
  const kind = new Uint8Array(COLS * ROWS).fill(EMPTY);
  for (const sample of samples) {
    const r = Math.max(sample.r, 4);
    const c0 = Math.max(0, Math.floor((sample.x - r) / STEP_X));
    const c1 = Math.min(COLS - 1, Math.ceil((sample.x + r) / STEP_X));
    const r0 = Math.max(0, Math.floor((sample.y - r) / STEP_Y));
    const r1 = Math.min(ROWS - 1, Math.ceil((sample.y + r) / STEP_Y));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const d = Math.hypot((col + 0.5) * STEP_X - sample.x, (row + 0.5) * STEP_Y - sample.y);
        const amount = Math.min(1, Math.max(0, (r - d) / 4 + 0.5));
        if (amount <= 0) continue;
        const i = row * COLS + col;
        flow[i] = Math.min(flow[i], normal(sample.s));
        // Wood wins over leaves so branches stay legible through the canopy.
        const previous = kind[i];
        const takes =
          previous === EMPTY ||
          (sample.kind === LEAF
            ? previous === LEAF && amount > cover[i]
            : previous === LEAF || amount > cover[i]);
        if (takes) {
          kind[i] = sample.kind;
          angle[i] = sample.angle;
        }
        cover[i] = Math.max(cover[i], amount);
      }
    }
  }

  const cells: Cell[] = [];
  for (let i = 0; i < cover.length; i++) {
    if (cover[i] < 0.2) continue;
    const thick = cover[i] > 0.9 && random() < 0.55;
    let glyph: string;
    if (kind[i] === LEAF) glyph = LEAVES[Math.floor(random() * LEAVES.length)];
    else if (thick || random() < 0.22) glyph = CODE[Math.floor(random() * CODE.length)];
    else glyph = lineGlyph(angle[i]);
    cells.push({
      x: (i % COLS) * STEP_X + STEP_X / 2,
      y: Math.floor(i / COLS) * STEP_Y + STEP_Y / 2,
      glyph,
      weight: cover[i] * (kind[i] === LEAF ? 0.55 : 0.75 + random() * 0.25),
      flow: flow[i],
      phase: random() * Math.PI * 2,
    });
  }

  // Motes climb from a root tip through the trunk to a branch tip.
  const motes: Mote[] = [];
  for (let i = 0; i < MOTES; i++) {
    const rootPath = rootPaths[Math.floor(random() * rootPaths.length)];
    const crownPath = crownPaths[Math.floor(random() * crownPaths.length)];
    motes.push({
      path: toPath([...rootPath].reverse().concat(crownPath)),
      phase: random(),
      rate: 0.75 + random() * 0.5,
    });
  }

  // Nine worlds: three around the crown, three at the middle, three among the roots.
  // Midgard sits on the trunk itself; the others hang from the nearest tip.
  const tips = [...crownPaths, ...rootPaths].map((path) => path[path.length - 1]);
  const worlds: World[] = [
    [130, 150],
    [500, 22],
    [870, 150],
    [56, 520],
    [500, 640],
    [944, 520],
    [210, 905],
    [500, 972],
    [790, 905],
  ].map(([x, y]) => {
    if (x === BASE.x && y > CROWN.y && y < BASE.y) return { x, y, tx: x, ty: y };
    let nearest = tips[0];
    for (const tip of tips) {
      if (Math.hypot(tip.x - x, tip.y - y) < Math.hypot(nearest.x - x, nearest.y - y)) {
        nearest = tip;
      }
    }
    return { x, y, tx: nearest.x, ty: nearest.y };
  });

  return {
    cells,
    clusters: clusters.map((cluster) => ({
      ...cluster,
      flow: normal(cluster.flow),
    })),
    motes,
    worlds,
  };
}

/** A soft round glow in one color, drawn scaled wherever light gathers. */
function glowSprite(color: string) {
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 64;
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, color);
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  return sprite;
}

export function createWorldTreeScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const tree = growTree();
  const sap = palette.signal ?? palette.accent;
  const spectrum = palette.spectrum ?? palette.accent;
  const sapGlow = glowSprite(sap);
  const worldGlow = glowSprite(spectrum);
  let layer: { canvas: HTMLCanvasElement; scale: number } | null = null;
  let width = 0;
  let height = 0;
  // Accumulated phases let speed follow activity without jumps.
  let flowTime = 0;
  let moteTime = 0;

  /** The resting tree, cached at the pane's device resolution so glyphs stay crisp. */
  const restingLayer = (scale: number) => {
    const target = Math.min(MAX_LAYER_SCALE, Math.max(0.1, scale));
    if (layer && Math.abs(layer.scale - target) < 0.05) return layer.canvas;
    const canvas = layer?.canvas ?? document.createElement("canvas");
    canvas.width = canvas.height = Math.ceil(SIZE * target);
    const ctx = canvas.getContext("2d");
    layer = { canvas, scale: target };
    if (!ctx) return canvas;
    ctx.setTransform(target, 0, 0, target, 0, 0);
    ctx.font = `10px ${palette.monoFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = palette.content;
    for (const cell of tree.cells) {
      ctx.globalAlpha = 0.2 + cell.weight * 0.55;
      ctx.fillText(cell.glyph, cell.x, cell.y);
    }
    return canvas;
  };

  const glow = (
    ctx: CanvasRenderingContext2D,
    sprite: HTMLCanvasElement,
    x: number,
    y: number,
    radius: number,
    alpha: number,
  ) => {
    if (alpha < 0.01) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  };

  return {
    resize(w, h) {
      width = w;
      height = h;
    },
    draw(ctx, time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (width <= 0 || height <= 0) return;
      const presence = signal.presence;
      const energy = signal.energy;
      const step = Math.min(delta, 1);
      // At rest sap creeps; a running turn sends it up the tree, streamed text speeds it further.
      flowTime += step * (0.04 + presence * 0.22 + energy * 0.35);
      moteTime += step * (0.03 + presence * 0.09 + energy * 0.12);
      const scale = Math.min(width / 1040, height / 1040);
      const ratio = ctx.getTransform().a || 1;

      ctx.save();
      ctx.translate(width * 0.5, height * 0.5);
      ctx.scale(scale, scale);
      // A slow breath at rest; activity adds a restrained sway.
      ctx.transform(1, 0, Math.sin(time * 0.4) * (0.003 + energy * 0.006), 1, 0, 0);
      ctx.translate(-SIZE / 2, -SIZE / 2);

      // The crown and the roots glow softly while the AI works.
      const breath = 0.5 + 0.5 * Math.sin(time * 0.9);
      glow(ctx, worldGlow, 500, 330, 470, 0.05 + presence * (0.08 + breath * 0.04) + energy * 0.1);
      glow(ctx, sapGlow, BASE.x, BASE.y, 200, 0.03 + presence * 0.08 + energy * 0.08);

      // Faint threads tie the nine worlds to the nearest branch or root.
      ctx.strokeStyle = spectrum;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.07 + presence * 0.1;
      ctx.beginPath();
      for (const world of tree.worlds) {
        ctx.moveTo(world.tx, world.ty);
        ctx.lineTo(world.x, world.y);
      }
      ctx.stroke();

      ctx.globalAlpha = 0.6 + presence * 0.2;
      ctx.drawImage(restingLayer(scale * ratio), 0, 0, SIZE, SIZE);

      // Sap pulses rise from the roots through the trunk into the branches.
      ctx.font = `10px ${palette.monoFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = sap;
      const pulse = 0.1 + presence * 0.6 + energy * 0.5;
      for (const cell of tree.cells) {
        const wave = Math.pow(
          0.5 + 0.5 * Math.cos(Math.PI * 2 * (cell.flow * WAVES - flowTime)),
          12,
        );
        const flicker = energy * 0.22 * Math.max(0, Math.sin(time * 3.1 + cell.phase * 5) - 0.6);
        const strength = wave * pulse + flicker;
        if (strength < 0.05) continue;
        ctx.globalAlpha = Math.min(1, strength * (0.5 + cell.weight * 0.6));
        // Symbols change in the brightest light while text streams; the tree shape stays stable.
        const glyph =
          energy > 0.2 && wave > 0.5
            ? CODE[(Math.floor(time * 8 + cell.phase * 3) + cell.y) % CODE.length]
            : cell.glyph;
        ctx.fillText(glyph, cell.x, cell.y);
      }

      // Leaves bloom as the sap reaches them and twinkle while text streams.
      for (const cluster of tree.clusters) {
        const arrival = Math.pow(
          0.5 + 0.5 * Math.cos(Math.PI * 2 * (cluster.flow * WAVES - flowTime)),
          6,
        );
        const twinkle = 0.5 + 0.5 * Math.sin(time * 2.3 + cluster.phase * 4);
        const light = arrival * (0.06 + presence * 0.4 + energy * 0.3) + energy * twinkle * 0.2;
        glow(ctx, sapGlow, cluster.x, cluster.y, 12 + light * 18, light * 0.45);
      }

      // Motes of light climb the tree while the AI works.
      const visible = 0.04 + presence * 0.6 + energy * 0.5;
      ctx.fillStyle = sap;
      for (const mote of tree.motes) {
        const progress = (mote.phase + moteTime * mote.rate) % 1;
        const alpha = visible * Math.sin(Math.PI * progress);
        if (alpha < 0.02) continue;
        const [x, y] = pointOnPath(mote.path, progress);
        glow(ctx, sapGlow, x, y, 10, alpha * 0.7);
        ctx.globalAlpha = Math.min(1, alpha * 1.2);
        ctx.fillRect(x - 1.25, y - 1.25, 2.5, 2.5);
      }

      // The nine worlds kindle one after another while the AI works.
      ctx.strokeStyle = spectrum;
      ctx.lineWidth = 1.4;
      tree.worlds.forEach((world, i) => {
        const kindle = 0.5 + 0.5 * Math.sin(time * 1.2 - i * 0.7);
        const light = 0.14 + presence * (0.25 + kindle * 0.35) + energy * 0.25;
        glow(ctx, worldGlow, world.x, world.y, 16 + light * 22, light * 0.7);
        ctx.globalAlpha = Math.min(1, 0.25 + light);
        ctx.beginPath();
        ctx.arc(world.x, world.y, 6, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    },
  };
}
