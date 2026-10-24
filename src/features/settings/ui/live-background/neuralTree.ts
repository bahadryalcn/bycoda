import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

type Point = readonly [number, number];
type Branch = {
  from: Point;
  bend: Point;
  reach: Point;
  tip: Point;
  weight: number;
};
type Leaf = { point: Point; glyph: string; accent: boolean };

// A deliberately asymmetric crown, drawn in a stable 240 × 280 design space.
// Each route grows from the trunk; there are no free-floating particles.
const CROWN: readonly Branch[] = [
  { from: [119, 174], bend: [91, 166], reach: [49, 151], tip: [25, 127], weight: 1.8 },
  { from: [120, 160], bend: [86, 140], reach: [55, 125], tip: [33, 96], weight: 1.7 },
  { from: [119, 147], bend: [86, 131], reach: [74, 94], tip: [55, 67], weight: 1.5 },
  { from: [122, 135], bend: [99, 113], reach: [101, 70], tip: [87, 43], weight: 1.4 },
  { from: [120, 130], bend: [114, 101], reach: [116, 58], tip: [122, 27], weight: 1.5 },
  { from: [122, 139], bend: [141, 110], reach: [145, 71], tip: [159, 47], weight: 1.4 },
  { from: [121, 151], bend: [156, 133], reach: [168, 94], tip: [190, 74], weight: 1.5 },
  { from: [120, 167], bend: [154, 154], reach: [188, 134], tip: [211, 104], weight: 1.7 },
  { from: [121, 180], bend: [151, 177], reach: [191, 159], tip: [220, 140], weight: 1.8 },
];

function pointOn(branch: Branch, t: number): Point {
  const u = 1 - t;
  return [
    u ** 3 * branch.from[0] +
      3 * u * u * t * branch.bend[0] +
      3 * u * t * t * branch.reach[0] +
      t ** 3 * branch.tip[0],
    u ** 3 * branch.from[1] +
      3 * u * u * t * branch.bend[1] +
      3 * u * t * t * branch.reach[1] +
      t ** 3 * branch.tip[1],
  ];
}

function strokeBranch(ctx: CanvasRenderingContext2D, branch: Branch) {
  ctx.beginPath();
  ctx.moveTo(...branch.from);
  ctx.bezierCurveTo(...branch.bend, ...branch.reach, ...branch.tip);
  ctx.lineWidth = branch.weight;
  ctx.stroke();
}

function createDetail() {
  const twigs: Branch[] = [];
  const leaves: Leaf[] = [];
  CROWN.forEach((branch, index) => {
    for (let side = -1; side <= 1; side += 2) {
      const from = pointOn(branch, 0.64 + (side + 1) * 0.06);
      const toward = pointOn(branch, 0.95);
      const tip: Point = [toward[0] + side * 13, toward[1] + 10 + (index % 3) * 2];
      twigs.push({
        from,
        bend: [from[0] + side * 6, from[1] - 9],
        reach: [tip[0] - side * 4, tip[1] + 8],
        tip,
        weight: 0.8,
      });
      leaves.push({ point: tip, glyph: side < 0 ? ":" : "+", accent: index % 3 === 0 });
    }
    // Small fixed character clusters read as leaves, even when motion is disabled.
    for (let leaf = 0; leaf < 5; leaf++) {
      const angle = leaf * 2.4 + index * 0.8;
      const radius = leaf === 0 ? 0 : 7 + (leaf % 2) * 5;
      leaves.push({
        point: [branch.tip[0] + Math.cos(angle) * radius, branch.tip[1] + Math.sin(angle) * radius],
        glyph: ["+", ".", ":", ".", "·"][leaf]!,
        accent: leaf === 0,
      });
    }
  });
  return { twigs, leaves };
}

const ROOTS: readonly Branch[] = [-1, 1].flatMap((side) =>
  [0, 1, 2].map((index) => ({
    from: [120 + side * 2, 210] as Point,
    bend: [120 + side * (8 + index * 4), 228] as Point,
    reach: [120 + side * (23 + index * 18), 230 + index * 4] as Point,
    tip: [120 + side * (31 + index * 25), 257 - index * 8] as Point,
    weight: 1.2 - index * 0.2,
  })),
);

/** A compact neural tree: static branching structure and three quiet sap routes. */
export function createNeuralTreeScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  const { twigs, leaves } = createDetail();
  let width = 0;
  let height = 0;

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(0, nextWidth);
      height = Math.max(0, nextHeight);
    },
    draw(ctx, time, _delta, signal) {
      ctx.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;

      const scale = Math.min(width / 256, height / 292);
      const presence = Math.max(0, Math.min(1, signal.presence));
      ctx.save();
      ctx.translate((width - 240 * scale) / 2, (height - 280 * scale) / 2);
      ctx.scale(scale, scale);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.strokeStyle = palette.content;
      ctx.globalAlpha = 0.48;
      ROOTS.forEach((root) => strokeBranch(ctx, root));

      // Two intertwined contours form a trunk, with a small open memory node.
      ctx.globalAlpha = 0.68;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(113, 220);
      ctx.bezierCurveTo(129, 199, 107, 179, 118, 151);
      ctx.bezierCurveTo(122, 141, 124, 133, 120, 122);
      ctx.moveTo(127, 220);
      ctx.bezierCurveTo(108, 198, 134, 176, 123, 149);
      ctx.stroke();

      ctx.globalAlpha = 0.58;
      CROWN.forEach((branch) => strokeBranch(ctx, branch));
      ctx.globalAlpha = 0.4;
      twigs.forEach((branch) => strokeBranch(ctx, branch));

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `9px ${palette.monoFont}`;
      for (const leaf of leaves) {
        ctx.fillStyle = leaf.accent ? palette.accent : palette.content;
        ctx.globalAlpha = leaf.accent ? 0.8 : 0.48;
        if (scale >= 0.45) {
          ctx.fillText(leaf.glyph, ...leaf.point);
        } else {
          ctx.beginPath();
          ctx.arc(...leaf.point, leaf.accent ? 1.6 : 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.strokeStyle = palette.accent;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(120, 189, 3.2, 0, Math.PI * 2);
      ctx.stroke();

      // The reply changes only the visibility of these bounded branch journeys.
      // Raw token energy never changes speed, position, geometry, or brightness.
      ctx.fillStyle = palette.accent;
      for (const index of [1, 4, 7]) {
        const progress = (((time * 0.035 + index * 0.217) % 1) + 1) % 1;
        const alpha = presence * Math.sin(progress * Math.PI) ** 2 * 0.8;
        if (alpha < 0.002) continue;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(...pointOn(CROWN[index]!, progress), 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  };
}
