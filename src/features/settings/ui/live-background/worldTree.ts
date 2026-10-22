import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

const SIZE = 1000;
const GLYPHS = "01{}[]<>/\\|:;=+*";
const STEP_X = 7;
const STEP_Y = 10;
type Cell = { x: number; y: number; glyph: string; weight: number; phase: number };

function seededRandom() {
  let seed = 0x79676764;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Original code artwork: a broad crown, intertwined trunk and three spreading root systems.
 * Inspired by Yggdrasil's connections between the heavens, living world and roots.
 * Geometry and glyphs are seeded, so previews, resize and reduced motion show the same tree.
 */
function buildTree(palette: LiveBackgroundPalette) {
  const mask = document.createElement("canvas");
  mask.width = mask.height = SIZE;
  const ctx = mask.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { cells: [] as Cell[], image: mask };
  const random = seededRandom();
  ctx.strokeStyle = ctx.fillStyle = palette.content;
  ctx.lineCap = "round";

  const branch = (
    x: number,
    y: number,
    angle: number,
    length: number,
    thickness: number,
    depth: number,
    root = false,
  ) => {
    const bend = (random() - 0.5) * length * 0.7;
    const ex = Math.max(48, Math.min(952, x + Math.cos(angle) * length));
    const ey = Math.max(65, Math.min(945, y + Math.sin(angle) * length));
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + Math.cos(angle) * length * 0.35 - Math.sin(angle) * bend,
      y + Math.sin(angle) * length * 0.35 + Math.cos(angle) * bend,
      ex - Math.cos(angle) * length * 0.2,
      ey - Math.sin(angle) * length * 0.2,
      ex,
      ey,
    );
    ctx.stroke();
    if (depth === 0) {
      if (!root) {
        // Loose clusters leave negative space between the branches, rather than a solid canopy.
        for (let i = 0; i < 9; i++) {
          ctx.beginPath();
          ctx.ellipse(
            ex + (random() - 0.5) * 44,
            ey + (random() - 0.5) * 26,
            3 + random() * 5,
            2 + random() * 3,
            random() * Math.PI,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      return;
    }
    const spread = root ? 0.38 : 0.52;
    for (const side of [-1, 1]) {
      let nextAngle = angle + side * (spread + random() * 0.23);
      // Crown twigs reach upwards; roots reach out and down.
      if (!root) nextAngle = Math.max(-Math.PI + 0.12, Math.min(-0.12, nextAngle));
      else nextAngle = Math.max(0.12, Math.min(Math.PI - 0.12, nextAngle));
      branch(
        ex,
        ey,
        nextAngle,
        length * (0.61 + random() * 0.13),
        thickness * 0.62,
        depth - 1,
        root,
      );
    }
  };

  // Two twisting strands meet in the crown and separate into three large roots.
  for (const offset of [-12, 12]) {
    ctx.lineWidth = 32;
    ctx.beginPath();
    ctx.moveTo(500 + offset, 732);
    ctx.bezierCurveTo(425 - offset, 610, 565 + offset, 500, 494 + offset, 341);
    ctx.stroke();
  }
  for (const [x, y, angle, length] of [
    [486, 564, -2.74, 170],
    [510, 542, -0.37, 168],
    [502, 459, -2.48, 157],
    [505, 438, -0.71, 159],
    [491, 356, -2.09, 135],
    [512, 351, -1.05, 140],
    [497, 342, -1.56, 143],
  ])
    branch(x, y, angle, length, 16, 4);
  for (const [angle, length] of [
    [2.65, 177],
    [1.58, 135],
    [0.5, 179],
  ]) {
    branch(500, 717, angle, length, 24, 4, true);
  }

  const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const cells: Cell[] = [];
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.font = `10px ${palette.monoFont}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let y = STEP_Y; y < SIZE; y += STEP_Y) {
    for (let x = STEP_X; x < SIZE; x += STEP_X) {
      const coverage = pixels[(y * SIZE + x) * 4 + 3] / 255;
      if (coverage < 0.16) continue;
      const cell = {
        x,
        y,
        glyph: GLYPHS[Math.floor(random() * GLYPHS.length)],
        weight: coverage * (0.5 + random() * 0.5),
        phase: random() * Math.PI * 2,
      };
      cells.push(cell);
      ctx.globalAlpha = 0.35 + cell.weight * 0.55;
      ctx.fillText(cell.glyph, x, y);
    }
  }
  ctx.globalAlpha = 1;
  return { cells, image: mask };
}

export function createWorldTreeScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const tree = buildTree(palette);
  let width = 0;
  let height = 0;
  return {
    resize(w, h) {
      width = w;
      height = h;
    },
    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (width <= 0 || height <= 0) return;
      const scale = Math.min(width / 1040, height / 1040);
      const energy = signal.presence * signal.energy;
      ctx.save();
      ctx.translate(width * 0.5, height * 0.5);
      ctx.scale(scale, scale);
      // A slow breath at rest. Streamed text adds a restrained sway and rising sap pulses.
      ctx.transform(1, 0, Math.sin(time * 0.4) * (0.003 + energy * 0.008), 1, 0, 0);
      ctx.translate(-SIZE / 2, -SIZE / 2);
      ctx.globalAlpha = 0.68 + signal.presence * 0.2;
      ctx.drawImage(tree.image, 0, 0);
      ctx.font = `10px ${palette.monoFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = palette.signal ?? palette.accent;
      for (const cell of tree.cells) {
        const wave = Math.pow(
          0.5 +
            0.5 *
              Math.sin(
                cell.y * 0.025 +
                  time * (1.2 + signal.presence * 2.3) +
                  Math.abs(cell.x - 500) * 0.006,
              ),
          10,
        );
        const shimmer = 0.5 + 0.5 * Math.sin(time * 0.7 + cell.phase);
        const strength = wave * (0.13 + signal.presence * 0.5 + energy * 0.4);
        if (strength < 0.075) continue;
        ctx.globalAlpha = Math.min(1, strength * (0.5 + cell.weight * 0.5));
        // Changing symbols follow the energy wave; the underlying tree stays stable.
        const glyph =
          energy > 0.25 && shimmer > 0.75
            ? GLYPHS[(Math.floor(time * 7 + cell.phase) + cell.y) % GLYPHS.length]
            : cell.glyph;
        ctx.fillText(glyph, cell.x, cell.y);
      }
      // Nine quiet lights represent the worlds connected by the tree.
      for (let i = 0; i < 9; i++) {
        const angle = -Math.PI + (i * Math.PI * 2) / 9;
        const x = 500 + Math.cos(angle) * 382;
        const y = 480 + Math.sin(angle) * 355;
        ctx.globalAlpha = 0.2 + signal.presence * (0.25 + 0.25 * Math.sin(time * 1.3 - i));
        ctx.fillText(i % 2 ? "{}" : "<>", x, y);
      }
      ctx.restore();
    },
  };
}
