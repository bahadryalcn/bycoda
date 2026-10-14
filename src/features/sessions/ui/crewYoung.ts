import { themePalette } from "../../../shared/theme/palette";
/** Young crew members: baby, child and adult. The uncle is `sitter` in crewCodeArt.
 *
 * Same coordinate system as `sitter`: origin on the floor below the seat, y grows
 * downward, values are grey levels that the glyph sampler turns into code text
 * (< 78 becomes a gap). Child and adult bodies reuse the uncles' seated and standing
 * skeleton ("uncle units") scaled by age, so knees bend, feet rest on the floor and
 * elbows bend like the grown-ups; heads stay larger and are drawn unscaled. */
import type { CrewActivity, CrewRole } from "./crewMotion";
import type { TeaPose } from "./crewCodeArt";

type Pt = [number, number];
type C = CanvasRenderingContext2D;
/** Index into the per-age tables below: 0 baby, 1 child, 2 adult. */
type Age = 0 | 1 | 2;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixPt = (a: Pt, b: Pt, t: number): Pt => [mix(a[0], b[0], t), mix(a[1], b[1], t)];
const along = (a: Pt, b: Pt, t: number): Pt => mixPt(a, b, t);

export function poseLift(pose: TeaPose): number {
  return pose === "sip"
    ? 1
    : pose === "sip-high"
      ? 0.8
      : pose === "sip-lift"
        ? 0.5
        : pose === "sip-low"
          ? 0.2
          : 0;
}

function pen(c: C) {
  const fill = (v: number) => {
    c.fillStyle = `rgb(${v},${v},${v})`;
  };
  const path = (points: number[][]) => {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  };
  const line = (points: number[][], v: number, width: number) => {
    c.strokeStyle = `rgb(${v},${v},${v})`;
    c.lineWidth = width;
    c.lineCap = "round";
    c.lineJoin = "round";
    path(points);
    c.stroke();
  };
  return {
    fill,
    line,
    ellipse(x: number, y: number, rx: number, ry: number, v: number, rotation = 0) {
      fill(v);
      c.beginPath();
      c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rotation, 0, Math.PI * 2);
      c.fill();
    },
    ring(x: number, y: number, rx: number, ry: number, v: number, width: number) {
      c.strokeStyle = `rgb(${v},${v},${v})`;
      c.lineWidth = width;
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      c.stroke();
    },
    shape(points: number[][], v: number) {
      fill(v);
      path(points);
      c.closePath();
      c.fill();
    },
    /** Filled shape with a dark rim that the sampler turns into a gap, separating overlapping parts. */
    solid(points: number[][], v: number, rim = 1.6) {
      path(points);
      c.closePath();
      c.strokeStyle = themePalette.rgb_52_52_52;
      c.lineWidth = rim * 2;
      c.lineJoin = "round";
      c.stroke();
      fill(v);
      c.fill();
    },
    blob(x: number, y: number, rx: number, ry: number, v: number, rim = 1.6) {
      fill(52);
      c.beginPath();
      c.ellipse(x, y, rx + rim, ry + rim, 0, 0, Math.PI * 2);
      c.fill();
      fill(v);
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
    },
    /** Sleeve or trouser leg: dark outline, cloth, and a lit edge along one side. */
    limb(points: number[][], v: number, width: number) {
      line(points, 66, width + 3.5);
      line(points, v, width);
    },
    alpha(value: number, draw: () => void) {
      c.save();
      c.globalAlpha *= clamp01(value);
      draw();
      c.restore();
    },
  };
}
type Pen = ReturnType<typeof pen>;

/* ---------------------------------------------------------------- faces */

type Face = {
  blink: number;
  talk: number;
  laugh: number;
  thought: number;
  cry: number;
  chuckle: number;
  look: number;
  down: number;
  pacifier: boolean;
  mouthBusy: boolean;
  /** Deadpan half-closed upper lids, a raised far brow, pursed lips and puffed cheeks. */
  lids: number;
  brow: number;
  pursed: boolean;
  puffed: boolean;
};
function faceOf(a: CrewActivity, standing: number): Face {
  return {
    blink: a.blink ?? 0,
    talk: standing > 0.65 ? (a.talk ?? 0) : 0,
    laugh: a.laugh ?? 0,
    thought: a.thought ?? 0,
    cry: a.emphasis ?? 0,
    chuckle: a.chuckle ?? 0,
    look: (a.turn ?? 0) * 1.4 - (a.thought ?? 0) * 1,
    down: 0,
    pacifier: false,
    mouthBusy: false,
    lids: 0,
    brow: 0,
    pursed: false,
    puffed: false,
  };
}

// Stable silhouettes carry the same identity from infancy into adulthood.
const PORTRAITS = [
  { width: 1.12, height: 0.98, jaw: 0.76, body: 1.14, eyes: 0.94 },
  { width: 0.94, height: 1.04, jaw: 0.64, body: 0.88, eyes: 0.9 },
  { width: 1, height: 1, jaw: 0.7, body: 1, eyes: 1 },
  { width: 1.04, height: 1, jaw: 0.72, body: 1.06, eyes: 0.92 },
  { width: 1.16, height: 0.96, jaw: 0.86, body: 1.2, eyes: 0.86 },
  { width: 0.93, height: 1.04, jaw: 0.66, body: 0.94, eyes: 1.04 },
  { width: 1.08, height: 1.02, jaw: 0.8, body: 1.1, eyes: 1 },
  { width: 0.97, height: 0.98, jaw: 0.68, body: 0.92, eyes: 0.92 },
] as const;
const portraitOf = (id: number) => PORTRAITS[id % PORTRAITS.length];
/** Character lines that start in infancy: the dapper uncle #2 is a deadpan baby in a suit and tie,
 * the stocky uncle #5 a chubby, bare-bellied baby in a diaper. */
type Archetype = "boss" | "chubby" | null;
const archetypeOf = (id: number, role: CrewRole): Archetype =>
  role !== "subagent" ? null : id % 6 === 1 ? "boss" : id % 6 === 4 ? "chubby" : null;
/** Deadpan lids and a raised brow for the suited line, puffed cheeks and pursed lips for the chubby one. */
function characterFace(f: Face, look: Archetype, k: Age) {
  if (look === "boss" && k < 2) {
    f.lids = k === 0 ? 0.55 : 0.4;
    f.brow = k === 0 ? 1 : 0.6;
  } else if (look === "chubby" && k < 2) {
    f.puffed = true;
    f.pursed = k === 0;
  }
  return f;
}
const headHeight = (r: number, id: number, k: Age) =>
  r * [1.04, 1.1, 1.18][k] * portraitOf(id).height;
const EYE = [3.1, 2.65, 2.3];
// Per-age face plan (baby, child, adult): eye line below centre (in ry), lower-face taper and
// chin depth, mouth between eyes and chin, eye spacing (in r), brow height (in eye), ears and nose.
const EYE_Y = [0.26, 0.12, 0.02];
const JAW = [0.9, 0.8, 0.7];
const CHIN = [0.94, 0.98, 1.02];
const MOUTH = [0.5, 0.56, 0.6];
const EYE_GAP = [0.4, 0.37, 0.35];
const BROW = [2.3, 2.3, 2.1];
const EAR = [0.1, 0.12, 0.12];
const NOSE = [0.08, 0.085, 0.1];
const HAIR_TONE = [108, 96, 0, 0, 88, 120];

/** Hair or headwear. The lead's fez and the advisor's spectacles persist through every age. */
function headwear(
  P: Pen,
  x: number,
  y: number,
  r: number,
  ry: number,
  id: number,
  k: Age,
  role: CrewRole,
  time: number,
) {
  const top = y - ry;
  const hair = HAIR_TONE[id % 6] || 100;
  // Side hair frames older faces, so heads stop looking bald and pasted on.
  const sides = (tone: number, depth = 0.35) => {
    for (const side of [-1, 1])
      P.shape(
        [
          [x + side * r * 0.98, y - ry * 0.05],
          [x + side * r * 1.02, y - ry * 0.5],
          [x + side * r * 0.7, y - ry * 0.86],
          [x + side * r * 0.62, y - ry * (0.5 - depth * 0.3)],
          [x + side * r * 0.86, y - ry * 0.05],
        ],
        tone,
      );
  };
  if (role === "lead") {
    if (k >= 1) sides(100);
    const w = r * 0.74,
      h = ry * (k === 0 ? 0.78 : 0.92),
      base = top + ry * 0.3;
    P.solid(
      [
        [x - w, base],
        [x - w * 0.78, base - h],
        [x + w * 0.78, base - h],
        [x + w, base],
      ],
      236,
      1.2,
    );
    P.shape(
      [
        [x - w * 0.2, base - h + 1],
        [x + w * 0.2, base - h + 1],
        [x + w * 0.26, base - 1],
        [x - w * 0.1, base - 1],
      ],
      250,
    );
    P.line(
      [
        [x - w, base - 2.2],
        [x + w, base - 2.2],
      ],
      98,
      k === 0 ? 3 : 3.6,
    );
    const swing = Math.sin(time / 380) * 1.8;
    P.line(
      [
        [x + w * 0.5, base - h + 1],
        [x + w + 1.5 + swing, base - h * 0.45],
        [x + w + 1 + swing, base - h * 0.05],
      ],
      252,
      1.6,
    );
    for (let strand = -1; strand <= 1; strand++)
      P.line(
        [
          [x + w + 1 + swing, base - h * 0.08],
          [x + w + 1 + swing + strand * 1.2, base + 3],
        ],
        245,
        1,
      );
    return;
  }
  if (role === "advisor") {
    if (k === 0) {
      // A single white curl, the seed of the uncle's white fringe.
      P.line(
        [
          [x - 1, top + 3],
          [x - 3, top - 3],
          [x + 1, top - 6.5],
          [x + 4.5, top - 3.5],
          [x + 1.5, top - 0.5],
        ],
        248,
        2,
      );
      P.line(
        [
          [x - 6, top + 4],
          [x - 7, top + 0.5],
        ],
        236,
        1.3,
      );
      P.line(
        [
          [x + 6, top + 4],
          [x + 7.5, top + 1],
        ],
        236,
        1.3,
      );
    } else {
      // Neat, side-parted hair: silver for the little professor, dark with grey temples as a grown-up.
      (k === 2 ? P.shape : P.solid)(
        [
          [x - r * 1.0, y - ry * 0.05],
          [x - r * 1.02, y - ry * 0.55],
          [x - r * 0.62, y - ry * 0.92],
          [x, top - 1.5],
          [x + r * 0.62, y - ry * 0.92],
          [x + r * 1.02, y - ry * 0.5],
          [x + r * 0.96, y - ry * 0.05],
          [x + r * 0.7, y - ry * 0.55],
          [x + r * 0.1, y - ry * 0.62],
          [x - r * 0.5, y - ry * 0.5],
          [x - r * 0.82, y - ry * 0.3],
        ],
        k === 2 ? 126 : 228,
      );
      if (k === 2)
        for (const side of [-1, 1])
          P.shape(
            [
              [x + side * r * 1.0, y - ry * 0.05],
              [x + side * r * 1.02, y - ry * 0.5],
              [x + side * r * 0.84, y - ry * 0.55],
              [x + side * r * 0.86, y - ry * 0.05],
            ],
            214,
          );
      P.line(
        [
          [x - r * 0.32, top + 0.5],
          [x - r * 0.38, y - ry * 0.58],
        ],
        120,
        1.3,
      );
      for (const dx of [0.15, 0.45, 0.7])
        P.line(
          [
            [x - r * 0.25 + dx * r, top + 1],
            [x + dx * r * 1.2, y - ry * 0.6],
          ],
          245,
          0.9,
        );
    }
    return;
  }
  const style = [
    ["curl", "bowl", "sidepart"],
    ["sheen", "cap", "cap"],
    ["wisps", "quiff", "headphones"],
    ["curl", "sidepart", "wavy"],
    ["tuft", "spiky", "wavy"],
    ["wisps", "takke", "takke"],
  ][id % 6][k];
  switch (style) {
    case "curl":
      P.line(
        [
          [x + 1, top + 2.5],
          [x - 1.5, top - 2.5],
          [x + 2, top - 5.5],
          [x + 5, top - 3],
          [x + 2.5, top - 0.5],
        ],
        112,
        2.1,
      );
      P.line(
        [
          [x - 5, top + 3],
          [x - 6, top],
        ],
        125,
        1.2,
      );
      break;
    case "bowl":
      P.solid(
        [
          [x - r * 1.04, y - ry * 0.02],
          [x - r * 1.0, y - ry * 0.62],
          [x - r * 0.5, top - 1.5],
          [x + r * 0.5, top - 1.5],
          [x + r * 1.0, y - ry * 0.62],
          [x + r * 1.04, y - ry * 0.02],
          [x + r * 0.78, y - ry * 0.3],
          [x + r * 0.5, y - ry * 0.42],
          [x - r * 0.5, y - ry * 0.42],
          [x - r * 0.78, y - ry * 0.3],
        ],
        hair,
        1,
      );
      for (let strand = -3; strand <= 3; strand++)
        P.line(
          [
            [x + strand * r * 0.2, y - ry * 0.44],
            [x + strand * r * 0.17, y - ry * 0.7],
          ],
          hair + 44,
          0.9,
        );
      P.line(
        [
          [x - r * 0.45, top + 1.5],
          [x + r * 0.1, top + 0.5],
        ],
        hair + 70,
        1.2,
      );
      break;
    case "quiff":
      sides(hair, 0.2);
      P.solid(
        [
          [x - r * 0.95, y - ry * 0.3],
          [x - r * 0.85, y - ry * 0.82],
          [x - r * 0.2, top - 5],
          [x + r * 0.55, top - 4],
          [x + r * 1.0, y - ry * 0.62],
          [x + r * 0.9, y - ry * 0.3],
          [x + r * 0.5, y - ry * 0.62],
          [x - r * 0.2, y - ry * 0.55],
          [x - r * 0.6, y - ry * 0.5],
        ],
        hair,
        1,
      );
      for (const dx of [-0.4, -0.05, 0.3])
        P.line(
          [
            [x + dx * r, y - ry * 0.6],
            [x + dx * r + 3, top - 2],
          ],
          hair + 60,
          0.9,
        );
      break;
    case "bonnet":
      // Ruffled cotton bonnet framing the face, tied under the chin.
      P.ring(x, y + 0.5, r + 2.2, ry + 2.2, 226, 3.6);
      for (let n = 0; n < 9; n++) {
        const a = Math.PI * (1.05 + n * 0.1);
        P.ellipse(x + Math.cos(a) * (r + 4.5), y + Math.sin(a) * (ry + 4.5), 1.6, 1.6, 240);
      }
      P.shape(
        [
          [x - r - 2, y + 1],
          [x - r * 0.82, top - 0.5],
          [x + r * 0.82, top - 0.5],
          [x + r + 2, y + 1],
          [x + r * 0.62, y - ry * 0.62],
          [x - r * 0.62, y - ry * 0.62],
        ],
        214,
      );
      P.line(
        [
          [x - r * 0.55, y + ry * 0.82],
          [x - 2, y + ry + 3.5],
          [x + 2.5, y + ry + 6],
        ],
        230,
        1.8,
      );
      break;
    case "cap":
      // The flat cap of uncle #2, in miniature, with the short hair below it.
      sides(hair, 0.1);
      P.blob(x, top + ry * 0.2, r * 1.1, ry * 0.2, 132, 1);
      P.solid(
        [
          [x - r * 0.95, top + ry * 0.2],
          [x - r * 0.82, top - ry * 0.3],
          [x + r * 0.9, top - ry * 0.3],
          [x + r * 0.98, top + ry * 0.2],
        ],
        162,
        1,
      );
      P.line(
        [
          [x - r * 0.6, top - ry * 0.18],
          [x + r * 0.7, top - ry * 0.1],
        ],
        205,
        1.2,
      );
      P.line(
        [
          [x - r * 0.9, top + ry * 0.32],
          [x + r * 0.9, top + ry * 0.32],
        ],
        70,
        1.4,
      );
      break;
    case "beanie":
      P.solid(
        [
          [x - r * 1.03, y - ry * 0.3],
          [x - r * 0.9, top + ry * 0.05],
          [x - r * 0.4, top - 2.5],
          [x + r * 0.4, top - 2.5],
          [x + r * 0.9, top + ry * 0.05],
          [x + r * 1.03, y - ry * 0.3],
        ],
        150,
        1,
      );
      for (let rib = -3; rib <= 3; rib++)
        P.line(
          [
            [x + rib * r * 0.27, y - ry * 0.42],
            [x + rib * r * 0.2, top + 1.5],
          ],
          205,
          0.9,
        );
      P.shape(
        [
          [x - r * 1.05, y - ry * 0.26],
          [x + r * 1.05, y - ry * 0.26],
          [x + r * 1.02, y - ry * 0.48],
          [x - r * 1.02, y - ry * 0.48],
        ],
        222,
      );
      P.blob(x, top - 4.5, 4.2, 3.8, 232, 1);
      break;
    case "spiky":
      sides(hair);
      P.solid(
        [
          [x - r, y - ry * 0.3],
          [x - r * 0.95, top + 2],
          [x - r * 0.72, top - 5],
          [x - r * 0.45, top + 0.5],
          [x - r * 0.15, top - 7],
          [x + r * 0.15, top],
          [x + r * 0.45, top - 6],
          [x + r * 0.72, top + 1],
          [x + r, top + 4],
          [x + r, y - ry * 0.3],
          [x + r * 0.55, y - ry * 0.5],
          [x - r * 0.55, y - ry * 0.5],
        ],
        hair,
        1,
      );
      for (const dx of [-0.6, -0.15, 0.3, 0.6])
        P.line(
          [
            [x + dx * r, y - ry * 0.55],
            [x + dx * r, top + 1],
          ],
          hair + 55,
          0.9,
        );
      break;
    case "headphones":
      sides(hair, 0.4);
      P.solid(
        [
          [x - r * 1.02, y - ry * 0.1],
          [x - r * 0.95, y - ry * 0.7],
          [x - r * 0.2, top - 2.5],
          [x + r * 0.6, top - 1],
          [x + r * 1.02, y - ry * 0.1],
          [x + r * 0.7, y - ry * 0.5],
          [x - r * 0.1, y - ry * 0.58],
          [x - r * 0.7, y - ry * 0.48],
        ],
        hair,
        1,
      );
      for (const dx of [-0.5, 0, 0.45])
        P.line(
          [
            [x + dx * r, y - ry * 0.55],
            [x + dx * r + 2, top],
          ],
          hair + 55,
          0.9,
        );
      break;
    case "sidepart":
      sides(hair, 0.15);
      P.solid(
        [
          [x - r * 1.0, y - ry * 0.2],
          [x - r * 0.95, y - ry * 0.72],
          [x - r * 0.45, top - 1.5],
          [x + r * 0.4, top - 2],
          [x + r * 0.95, y - ry * 0.7],
          [x + r * 1.0, y - ry * 0.2],
          [x + r * 0.7, y - ry * 0.55],
          [x - r * 0.1, y - ry * 0.68],
          [x - r * 0.6, y - ry * 0.55],
        ],
        hair,
        1,
      );
      P.line(
        [
          [x - r * 0.38, top + 0.5],
          [x - r * 0.45, y - ry * 0.62],
        ],
        60,
        1.1,
      );
      for (const dx of [-0.1, 0.2, 0.5])
        P.line(
          [
            [x - r * 0.3 + dx * r, top + 1],
            [x + dx * r * 1.3, y - ry * 0.65],
          ],
          hair + 55,
          0.9,
        );
      break;
    case "wavy":
      sides(hair, 0.4);
      P.solid(
        [
          [x - r * 1.03, y - ry * 0.05],
          [x - r * 0.98, y - ry * 0.7],
          [x - r * 0.5, top - 3],
          [x + r * 0.2, top - 3.5],
          [x + r * 0.8, top - 1],
          [x + r * 1.03, y - ry * 0.5],
          [x + r * 1.0, y - ry * 0.05],
          [x + r * 0.7, y - ry * 0.5],
          [x + r * 0.2, y - ry * 0.62],
          [x - r * 0.4, y - ry * 0.55],
          [x - r * 0.75, y - ry * 0.4],
        ],
        hair,
        1,
      );
      for (let n = 0; n < 4; n++)
        P.line(
          [
            [x - r * 0.7 + n * r * 0.4, top + 1],
            [x - r * 0.5 + n * r * 0.4, top + 4],
            [x - r * 0.65 + n * r * 0.4, y - ry * 0.55],
          ],
          hair + 50,
          0.9,
        );
      break;
    case "takke":
      sides(hair, 0.1);
      P.solid(
        [
          [x - r * 0.9, top + ry * 0.3],
          [x - r * 0.9, top - ry * 0.05],
          [x - r * 0.5, top - ry * 0.28],
          [x + r * 0.5, top - ry * 0.28],
          [x + r * 0.9, top - ry * 0.05],
          [x + r * 0.9, top + ry * 0.3],
        ],
        166,
        1,
      );
      for (let stitch = 0; stitch < 6; stitch++)
        P.line(
          [
            [x - r * 0.65 + stitch * r * 0.26, top + 1],
            [x - r * 0.6 + stitch * r * 0.26, top - 1.2],
            [x - r * 0.55 + stitch * r * 0.26, top + 1],
          ],
          218,
          0.8,
        );
      break;
    case "sheen":
      // Bald, with one glint and a single neat curl.
      P.alpha(0.7, () => P.ellipse(x - r * 0.3, top + ry * 0.28, r * 0.22, ry * 0.1, 236));
      P.line(
        [
          [x + 1, top + 1.5],
          [x + 2.5, top - 1.5],
          [x + 4.5, top - 0.5],
        ],
        120,
        1.2,
      );
      break;
    case "tuft":
      // A small upright tuft on an otherwise bare head.
      for (const [dx, lean, rise] of [
        [-2.5, -2, 5],
        [0, 0.5, 7],
        [2.5, 2.5, 5.5],
      ])
        P.line(
          [
            [x + dx, top + 2],
            [x + dx + lean * 0.4, top - rise * 0.6],
            [x + dx + lean, top - rise],
          ],
          hair + 20,
          1.9,
        );
      break;
    case "wisps":
      for (const dx of [-4, 0, 4])
        P.line(
          [
            [x + dx, top + 2],
            [x + dx * 1.3, top - 2.5],
            [x + dx * 1.5 + 1, top - 4],
          ],
          122,
          1.3,
        );
      break;
  }
}

/** Round, value-sculpted head. Expressions mirror the uncles': laugh, think, talk;
 * anger becomes crying for the youngest two stages and a pout for the older ones. */
function head(
  P: Pen,
  x: number,
  y: number,
  r: number,
  id: number,
  k: Age,
  role: CrewRole,
  f: Face,
  time: number,
) {
  const portrait = portraitOf(id);
  const ry = headHeight(r, id, k);
  r *= portrait.width;
  const eye = EYE[k] * portrait.eyes;
  const skin = 196;
  // Babies keep a big cranium over a round, chinless lower face with the features low;
  // grown-ups put the eyes on the midline above a narrower jaw.
  const lower = JAW[k] + (portrait.jaw - 0.72) * 0.5;
  const outline: Pt[] = [];
  for (let n = 0; n < 32; n++) {
    const angle = -Math.PI / 2 + (n / 32) * Math.PI * 2;
    const dy = Math.sin(angle);
    const taper = dy > 0 ? mix(1, lower, dy ** 1.6) : 1;
    outline.push([x + Math.cos(angle) * r * taper, y + dy * ry * (dy > 0 ? CHIN[k] : 1)]);
  }
  const ey = y + ry * EYE_Y[k];
  const my = mix(ey, y + ry * CHIN[k], MOUTH[k]);
  const ny = mix(ey, my, 0.58);
  const gap = r * EYE_GAP[k];
  // Ears in the eye-to-nose band, small and tucked on babies.
  for (const side of [-1, 1]) {
    const ex = x + side * r * 0.95,
      ery = mix(ey, ny, 0.5);
    P.blob(ex, ery, r * EAR[k], ry * EAR[k] * 1.45, side < 0 ? 198 : 178, 0.7);
    P.line(
      [
        [ex + side * r * 0.02, ery - ry * EAR[k] * 0.7],
        [ex + side * r * 0.04, ery + ry * EAR[k] * 0.6],
      ],
      side < 0 ? 150 : 132,
      1,
    );
  }
  // Even skin with one soft shade on the far side: no lighter face disc or muzzle.
  P.solid(outline, skin, 0.8);
  const far = outline.slice(3, 15);
  P.shape(
    [...far, ...far.reverse().map(([px, py]): Pt => [mix(px, x, 0.2), py])],
    180,
  );
  P.alpha(0.55, () => P.ellipse(x - r * 0.28, y - ry * 0.55, r * 0.34, ry * 0.16, 214));
  const cry = k === 0 ? f.cry : 0,
    pout = k >= 1 ? f.cry : 0;
  for (const side of [-1, 1]) {
    const ex = x + side * gap;
    if (cry > 0.3) {
      // Squeezed "> <" eyes with tears running down both cheeks.
      P.line(
        [
          [ex - side * eye, ey - eye * 0.75],
          [ex + side * eye * 0.7, ey],
          [ex - side * eye, ey + eye * 0.75],
        ],
        50,
        1.6,
      );
      const drop = (time / 420 + (side > 0 ? 0.5 : 0)) % 1;
      P.alpha(cry, () => {
        P.line(
          [
            [ex + side * 1.4, ey + eye * 0.8],
            [ex + side * 2.2, my],
          ],
          250,
          1.7,
        );
        P.ellipse(ex + side * 2.5, my + drop * ry * 0.4, 1.7, 2.3, 252);
      });
    } else if (f.laugh > 0.1) {
      P.line(
        [
          [ex - eye, ey + 0.8],
          [ex, ey - eye * 0.65],
          [ex + eye, ey + 0.8],
        ],
        48,
        1.6,
      );
    } else if (f.blink > 0.5) {
      P.line(
        [
          [ex - eye, ey],
          [ex, ey + 0.9],
          [ex + eye, ey],
        ],
        55,
        1.4,
      );
    } else {
      // White, round iris (a gap) and a catch-light; babies' eyes are the roundest.
      const squint = pout * 0.3;
      const open = [0.86, 0.74, 0.62][k] - squint * 0.3;
      P.ellipse(ex, ey, eye * 1.3, eye * open, 240);
      const gaze = Math.max(-eye * 0.4, Math.min(eye * 0.4, f.look));
      const iris = eye * (k === 0 ? 0.72 : 0.58);
      P.ellipse(ex + gaze, ey + f.down * 0.1, iris, Math.min(iris, eye * open), 36);
      P.ellipse(ex + gaze - eye * 0.22, ey - eye * 0.26 + f.down * 0.3, eye * 0.26, eye * 0.24, 250);
      if (f.lids > 0) {
        // Heavy, unimpressed upper lids.
        const cut = ey - eye * open + f.lids * eye * open * 1.05;
        P.shape(
          [
            [ex - eye * 1.5, ey - eye * 1.4],
            [ex + eye * 1.5, ey - eye * 1.4],
            [ex + eye * 1.5, cut + side * 0.3],
            [ex - eye * 1.5, cut - side * 0.3],
          ],
          skin,
        );
        P.line(
          [
            [ex - eye * 1.35, cut - side * 0.3],
            [ex + eye * 1.35, cut + side * 0.3],
          ],
          70,
          1.3,
        );
      } else if (k === 2)
        P.line(
          [
            [ex - eye * 1.25, ey - eye * 0.62],
            [ex, ey - eye * 0.95 - squint],
            [ex + eye * 1.25, ey - eye * 0.62],
          ],
          110,
          0.9,
        );
    }
    // Rosy cheeks, round and low on the little ones.
    const puff = f.puffed ? 1.35 : 1;
    P.alpha(k === 2 ? 0.5 : 0.85, () =>
      P.ellipse(
        x + side * r * 0.6,
        mix(ey, my, 0.62) - f.laugh,
        r * (k === 0 ? 0.2 : 0.16) * puff,
        ry * 0.1 * puff,
        side < 0 ? 226 : 200,
      ),
    );
  }
  // Brows sit well above the eyes, faint on babies; anger pulls the inner ends down.
  if (!f.pacifier || k > 0)
    for (const side of [-1, 1]) {
      const lift =
        f.laugh * 1.1 + f.thought * (side > 0 ? 1.2 : 0.4) + (side > 0 ? f.brow * eye * 0.6 : 0);
      const by = ey - eye * BROW[k];
      P.line(
        [
          [x + side * gap * 0.45, by + eye * 0.3 + pout * 2.2 - lift],
          [x + side * gap, by - eye * 0.15 - lift],
          [x + side * gap * 1.45, by + eye * 0.25 - pout * 0.6 - lift * 0.6],
        ],
        [150, 116, 90][k],
        [1.1, 1.3, 1.7][k],
      );
    }
  // Nose: a small button on the young ones; grown-ups add a shaded side.
  if (k === 2)
    P.line(
      [
        [x + r * 0.07, ey + eye * 0.6],
        [x + r * 0.11, ny - 0.4],
        [x + r * 0.04, ny + 1.2],
      ],
      164,
      1.2,
    );
  P.ellipse(x, ny, r * NOSE[k], ry * NOSE[k] * 0.7, 210);
  for (const side of [-1, 1])
    P.ellipse(x + side * r * NOSE[k] * 0.55, ny + ry * NOSE[k] * 0.35, 0.7, 0.5, 140);
  if (k === 2) {
    // Grown-ups get dark moustaches (and a trimmed beard for some): the uncles' look, not yet grey.
    const beard = role === "advisor" || id === 5;
    if (beard) {
      // A short, salt-and-pepper chin beard; the advisor's will grow long and white.
      P.shape(
        [
          [x - r * 0.55, y + ry * 0.62],
          [x - r * 0.45, y + ry * 0.88],
          [x, y + ry * 1.06],
          [x + r * 0.45, y + ry * 0.88],
          [x + r * 0.55, y + ry * 0.62],
          [x + r * 0.2, y + ry * 0.74],
          [x, y + ry * 0.78],
          [x - r * 0.2, y + ry * 0.74],
        ],
        128,
      );
      for (const dx of [-0.3, 0, 0.3])
        P.line(
          [
            [x + dx * r, y + ry * 0.78],
            [x + dx * r * 0.8, y + ry * 0.98],
          ],
          196,
          0.9,
        );
    }
    if ([0, 1, 4].includes(id % 6) && role === "subagent") {
      // Clean-shaven with a little stubble shadow.
      P.ellipse(x, y + ry * 0.74, r * 0.55, ry * 0.2, 168);
    } else {
      const thick = role === "lead" ? 0.7 : id === 1 ? 1.3 : 1;
      P.shape(
        [
          [x - r * 0.5, my - 1],
          [x - r * 0.28, my - 3.4 * thick - 1],
          [x, my - 2.8 * thick - 0.6],
          [x + r * 0.28, my - 3.4 * thick - 1],
          [x + r * 0.5, my - 1],
          [x + r * 0.4, my - 0.4],
          [x + r * 0.12, my - 1.4],
          [x, my - 1],
          [x - r * 0.12, my - 1.4],
          [x - r * 0.4, my - 0.4],
        ],
        86,
      );
    }
  }
  if (cry > 0.3) {
    const open = ry * (0.2 + 0.05 * Math.abs(Math.sin(time / 160)));
    P.ellipse(x, my + 1, r * 0.3, open + 1.1, 226);
    P.ellipse(x, my + 1, r * 0.26, open, 38);
    P.ellipse(x, my + open * 0.55, r * 0.14, open * 0.3, 205);
  } else if (f.pacifier) {
    P.blob(x, my, r * 0.22, ry * 0.1, 236, 0.8);
    P.ring(x, my + ry * 0.12, r * 0.09, ry * 0.07, 250, 1.2);
    P.ellipse(x, my, r * 0.06, ry * 0.04, 130);
  } else if (f.laugh > 0.1) {
    const open = (1.8 + Math.abs(f.chuckle)) * f.laugh;
    P.shape(
      [
        [x - r * 0.26, my - 0.8],
        [x + r * 0.26, my - 0.8],
        [x + r * 0.14, my + open + 1.2],
        [x - r * 0.14, my + open + 1.2],
      ],
      42,
    );
    P.line(
      [
        [x - r * 0.2, my - 0.3],
        [x + r * 0.2, my - 0.3],
      ],
      236,
      1,
    );
    P.ellipse(x, my + open, r * 0.1, 1.1, 205);
  } else if (f.talk > 0.1) {
    P.ellipse(x, my, r * 0.09 + f.talk * r * 0.09, ry * 0.04 + f.talk * ry * 0.1, 42);
  } else if (pout > 0.3) {
    P.line(
      [
        [x - r * 0.2, my + 1.3],
        [x, my - 0.4],
        [x + r * 0.2, my + 1.3],
      ],
      55,
      1.5,
    );
  } else if (f.pursed && !f.mouthBusy) {
    P.ellipse(x, my, r * 0.1, ry * 0.07, 150);
    P.ellipse(x, my, r * 0.045, ry * 0.035, 60);
  } else if (f.lids > 0 && !f.mouthBusy) {
    // A flat, businesslike line.
    P.line(
      [
        [x - r * 0.16, my + 0.3],
        [x + r * 0.16, my - 0.3],
      ],
      62,
      1.3,
    );
  } else if (!f.mouthBusy) {
    const w = r * [0.13, 0.17, 0.2][k];
    P.line(
      [
        [x - w, my - 0.7],
        [x, my + 0.9],
        [x + w, my - 0.7],
      ],
      62,
      1.3,
    );
    // Lower lip catches the light.
    P.line(
      [
        [x - w * 0.45, my + 2.2],
        [x + w * 0.45, my + 2.2],
      ],
      214,
      1,
    );
  }
  if (role === "advisor") {
    for (const side of [-1, 1]) {
      P.ring(x + side * r * 0.37, ey, eye * 1.55 + 1, eye * 1.35 + 1, 60, 3.6);
      P.ring(x + side * r * 0.37, ey, eye * 1.55 + 1, eye * 1.35 + 1, 252, 2);
    }
    P.line(
      [
        [x - r * 0.37 + eye * 1.55 + 1, ey - 0.5],
        [x + r * 0.37 - eye * 1.55 - 1, ey - 0.5],
      ],
      250,
      1.4,
    );
    if (k >= 1)
      for (const side of [-1, 1])
        P.line(
          [
            [x + side * (r * 0.37 + eye * 1.55 + 1), ey - 0.8],
            [x + side * r, ey - 1.5],
          ],
          228,
          1.3,
        );
  }
  headwear(P, x, y, r, ry, id, k, role, time);
  if (pout > 0.45) {
    const vx = x + r + 3.5,
      vy = y - ry - 2,
      pop = 1.05 + Math.sin(time / 90) * 0.12;
    P.alpha((pout - 0.45) / 0.4, () => {
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        P.line(
          [
            [vx + dx * pop, vy + dy * 3.2 * pop],
            [vx + dx * 2.8 * pop, vy + dy * 1.5 * pop],
            [vx + dx * 3.5 * pop, vy + dy * 0.7 * pop],
          ],
          245,
          1.6,
        );
    });
  }
  if (f.thought > 0.35) {
    const beat = Math.floor(time / 420) % 4;
    for (let dot = 0; dot < 3; dot++)
      P.alpha(((f.thought - 0.35) / 0.65) * (dot < beat ? 1 : 0.25), () =>
        P.ellipse(
          x + r * 0.9 + dot * 5.5,
          y - ry - 7 - dot * 4.5,
          1.6 + dot * 0.45,
          1.4 + dot * 0.4,
          235,
        ),
      );
  }
  if (f.laugh > 0.1) {
    for (const side of [-1, 1]) {
      const pulse = Math.max(0, (side * f.chuckle) / 1.7);
      P.alpha(f.laugh * (0.35 + 0.65 * pulse), () => {
        const sx = x + side * (r + 8),
          sy = y - ry * 0.55 - pulse * 4;
        P.line(
          [
            [sx - 3, sy],
            [sx + 3, sy],
          ],
          245,
          1.4,
        );
        P.line(
          [
            [sx, sy - 3],
            [sx, sy + 3],
          ],
          245,
          1.4,
        );
        P.ellipse(sx + side * 5, sy + 6, 1, 1, 230);
      });
    }
  }
  return { mouth: [x, my] as Pt, ry };
}

/* ---------------------------------------------------------------- props */

function bottle(P: Pen, c: C, base: Pt, tip: Pt, drinking: number, time: number) {
  const angle = Math.atan2(tip[1] - base[1], tip[0] - base[0]);
  const length = Math.max(10, Math.hypot(tip[0] - base[0], tip[1] - base[1]) - 8);
  c.save();
  c.translate(base[0], base[1]);
  c.rotate(angle);
  P.solid(
    [
      [0, -5],
      [length + 3, -5],
      [length + 3, 5],
      [0, 5],
    ],
    242,
    1.3,
  );
  P.blob(length + 7, 0, 3.8, 3.1, 212, 1.2);
  const from = drinking > 0.5 ? length * 0.35 : 0,
    to = drinking > 0.5 ? length : length * 0.6;
  P.shape(
    [
      [from, -3.5],
      [to, -3.5],
      [to, 3.5],
      [from, 3.5],
    ],
    166,
  );
  for (let tick = 1; tick < 4; tick++)
    P.line(
      [
        [(tick * length) / 4, -5],
        [(tick * length) / 4, -2.6],
      ],
      110,
      1,
    );
  P.solid(
    [
      [length, -6],
      [length + 3.5, -6],
      [length + 3.5, 6],
      [length, 6],
    ],
    150,
    1,
  );
  if (drinking > 0.5)
    for (let bubble = 0; bubble < 2; bubble++) {
      const t = (time / 700 + bubble * 0.5) % 1;
      P.ellipse(length * (1 - t), bubble ? 1.6 : -1.6, 1.2, 1.2, 252);
    }
  c.restore();
}

function rattle(P: Pen, c: C, hand: Pt, play: number, time: number) {
  const shake = Math.sin(time / 75) * 0.55 * play;
  c.save();
  c.translate(hand[0], hand[1]);
  c.rotate(-1.9 + shake);
  P.line(
    [
      [0, 0],
      [12, 0],
    ],
    66,
    4.6,
  );
  P.line(
    [
      [0, 0],
      [12, 0],
    ],
    222,
    2.4,
  );
  P.blob(17, 0, 6, 6, 234, 1.4);
  P.ring(17, 0, 3.6, 3.6, 150, 1.1);
  for (const [dx, dy] of [
    [-2, -2.6],
    [2, 2],
    [-2.6, 2.4],
    [2.6, -2],
  ])
    P.ellipse(17 + dx, dy, 0.9, 0.9, 120);
  c.restore();
  if (play > 0.6)
    for (const side of [-1, 1]) {
      const x = hand[0] - 6 + side * 12,
        y = hand[1] - 18;
      P.alpha(0.5 + 0.5 * Math.abs(Math.sin(time / 75)), () => {
        P.line(
          [
            [x, y - 3.5],
            [x + side * 2.2, y],
            [x, y + 3.5],
          ],
          235,
          1.2,
        );
        P.line(
          [
            [x + side * 3.6, y - 5],
            [x + side * 6, y],
            [x + side * 3.6, y + 5],
          ],
          215,
          1,
        );
      });
    }
}

function heart(P: Pen, x: number, y: number, size: number) {
  P.shape(
    [
      [x, y + size],
      [x - size, y],
      [x - size * 0.9, y - size * 0.6],
      [x - size * 0.45, y - size * 0.8],
      [x, y - size * 0.35],
      [x + size * 0.45, y - size * 0.8],
      [x + size * 0.9, y - size * 0.6],
      [x + size, y],
    ],
    245,
  );
}

function juiceBox(P: Pen, center: Pt) {
  const [x, y] = center;
  P.solid(
    [
      [x - 5, y - 7],
      [x + 5, y - 7],
      [x + 5, y + 8],
      [x - 5, y + 8],
    ],
    232,
    1.2,
  );
  P.shape(
    [
      [x - 5, y - 1.5],
      [x + 5, y - 1.5],
      [x + 5, y + 3.5],
      [x - 5, y + 3.5],
    ],
    150,
  );
  P.ellipse(x - 1, y + 1, 2, 2, 238);
  P.line(
    [
      [x + 1.8, y - 7],
      [x + 1.8, y - 12],
      [x - 1.5, y - 15.5],
    ],
    66,
    3,
  );
  P.line(
    [
      [x + 1.8, y - 7],
      [x + 1.8, y - 12],
      [x - 1.5, y - 15.5],
    ],
    248,
    1.4,
  );
}

function yoyo(P: Pen, hand: Pt, play: number, time: number) {
  const depth = 6 + Math.abs(Math.sin(time / 300)) * 26 * play;
  const y = hand[1] + depth;
  P.line(
    [
      [hand[0], hand[1] + 2],
      [hand[0], y - 4.5],
    ],
    222,
    0.9,
  );
  P.blob(hand[0], y, 5, 5, 232, 1.2);
  P.ring(hand[0], y, 3, 3, 120, 1);
}

/** Turkish coffee: a small handled cup on its saucer, with a thread of steam. */
function coffee(P: Pen, center: Pt, lift: number, time: number) {
  const [x, y] = center;
  P.blob(x, y + 5.5, 8.5, 1.6, 232, 1.1);
  P.ring(x + 6, y - 0.5, 2.2, 2.6, 66, 3);
  P.ring(x + 6, y - 0.5, 2.2, 2.6, 232, 1.4);
  P.solid(
    [
      [x - 5, y - 5],
      [x + 5, y - 5],
      [x + 4.4, y + 1.5],
      [x + 2, y + 4],
      [x - 2, y + 4],
      [x - 4.4, y + 1.5],
    ],
    244,
    1.1,
  );
  P.line(
    [
      [x - 4, y - 2],
      [x + 4, y - 2],
    ],
    170,
    0.9,
  );
  P.ellipse(x, y - 5, 4.2, 1.1, 160);
  if (lift < 0.05 && time > 0)
    for (let wisp = 0; wisp < 2; wisp++) {
      const age = (time / 2600 + wisp * 0.5) % 1;
      P.alpha(Math.sin(Math.PI * age) * 0.5, () =>
        P.line(
          Array.from({ length: 5 }, (_, n) => [
            x - 1 + wisp * 2.5 + Math.sin((age + n * 0.05) * 11 + wisp * 2) * 1.8,
            y - 7 - (age + n * 0.05) * 16,
          ]),
          215,
          1,
        ),
      );
    }
}

function phone(P: Pen, center: Pt, time: number, joy: number) {
  const [x, y] = center;
  P.solid(
    [
      [x - 5.5, y - 8],
      [x + 5.5, y - 8],
      [x + 5.5, y + 8],
      [x - 5.5, y + 8],
    ],
    92,
    1.2,
  );
  P.shape(
    [
      [x - 4, y - 6.5],
      [x + 4, y - 6.5],
      [x + 4, y + 6.2],
      [x - 4, y + 6.2],
    ],
    250,
  );
  const offset = (time / 90) % 4;
  for (let row = 0; row < 4; row++) {
    const ry = y - 5.5 + ((row * 4 - offset + 16) % 12);
    P.line(
      [
        [x - 2.6, ry],
        [x + (row % 2 ? 0.6 : 2.6), ry],
      ],
      170,
      0.9,
    );
  }
  if (joy > 0.3) heart(P, x + 8, y - 13 - joy * 4, 2.8);
}

/* ---------------------------------------------------------------- bodies (uncle units) */

/** Seated legs per seat, borrowed from the uncles: open knees, crossed knee, crossed ankles, tucked foot. */
const SEATED_LEGS: Record<number, { left: Pt[]; right: Pt[]; shoes: [number, number, number][] }> =
  {
    0: {
      left: [
        [-15, -70],
        [-20, -40],
        [-23, -10],
      ],
      right: [
        [15, -70],
        [21, -39],
        [26, -9],
      ],
      shoes: [
        [-26, -2, -1],
        [29, -2, 1],
      ],
    },
    1: {
      left: [
        [-15, -69],
        [21, -47],
        [-4, -10],
      ],
      right: [
        [17, -70],
        [-21, -50],
        [17, -42],
      ],
      shoes: [
        [-6, -2, -1],
        [23, -40, 1],
      ],
    },
    4: {
      left: [
        [-15, -69],
        [-11, -41],
        [7, -12],
      ],
      right: [
        [15, -69],
        [18, -43],
        [-3, -11],
      ],
      shoes: [
        [8, -2, 1],
        [-5, -6, -1],
      ],
    },
    5: {
      left: [
        [-15, -69],
        [-22, -38],
        [-10, -14],
      ],
      right: [
        [15, -69],
        [16, -37],
        [24, -9],
      ],
      shoes: [
        [-8, -7, -1],
        [26, -2, 1],
      ],
    },
  };
const LEAN = [0, -6, 0, 2, 6, -4];

type Kind = "child" | "adult";
const KINDS: Record<Kind, { S: number; r: number; neck: number; shorts: boolean }> = {
  child: { S: 0.66, r: 16, neck: 2.5, shorts: true },
  adult: { S: 0.96, r: 16.5, neck: 5, shorts: false },
};

/** The uncles' shoe: heel, raised instep and a toe box. */
function shoe(P: Pen, c: C, x: number, y: number, direction: number, lace: boolean) {
  c.save();
  c.translate(x, y);
  c.scale(direction, 1);
  P.shape(
    [
      [-11, -7],
      [-9, -11],
      [1, -12],
      [7, -7],
      [16, -5],
      [19, -1],
      [17, 2],
      [-12, 2],
    ],
    70,
  );
  P.shape(
    [
      [-9, -7],
      [-7, -10],
      [1, -10],
      [6, -5],
      [14, -3],
      [16, -1],
      [-10, -1],
    ],
    150,
  );
  P.line(
    [
      [-10, 1],
      [16, 1],
    ],
    215,
    1.5,
  );
  P.line(
    [
      [8, -4],
      [14, -3],
    ],
    220,
    1.5,
  );
  if (lace)
    for (let n = 0; n < 3; n++)
      P.line(
        [
          [-2 + n * 2, -8 + n],
          [3 + n * 2, -7 + n],
        ],
        235,
        1,
      );
  else
    P.line(
      [
        [-3, -7],
        [5, -5],
      ],
      230,
      1.5,
    );
  c.restore();
}

type BodyInput = {
  kind: Kind;
  id: number;
  role: CrewRole;
  a: CrewActivity;
  time: number;
  stand: number;
  progress: number;
  breath: number;
  sway: number;
  /** Hand targets in uncle units of the (risen) torso; null = default rest pose. */
  left?: Pt | null;
  right?: Pt | null;
  leftOpen?: boolean;
  /** Sideways foot swing while seated. */
  legSwing?: number;
  /** Runs once the head is placed; may move the hands (uncle units) to follow a prop. */
  plan?: (toReal: (p: Pt) => Pt, mouth: Pt) => { left?: Pt; right?: Pt } | void;
  props?: (toReal: (p: Pt) => Pt) => void;
  face: Face;
};

/** Child or adult: uncle skeleton scaled by age, age-appropriate clothing, and a larger head. */
function kidBody(c: C, P: Pen, g: BodyInput) {
  const K = KINDS[g.kind];
  const S = K.S,
    id = g.id % 6;
  const s = g.stand;
  const bodyWidth = portraitOf(g.id).body;
  const lean = LEAN[id] * (1 - 0.65 * s);
  const rise = s * 48 - Math.sin(g.progress * Math.PI) * 4;
  const jump = (g.a.jump ?? 0) * 7;
  const toReal = (p: Pt): Pt => [p[0] * S * bodyWidth, p[1] * S];
  const T = (y: number) => y - rise - jump + s * 6 - g.breath * 0.9 + (1 - s) * 3;
  const shirt = [184, 166, 214, 150, 190, 172][id];
  const pants =
    g.kind === "adult" ? [128, 112, 118, 120, 134, 116][id] : [146, 132, 120, 128, 150, 138][id];
  const kidTone =
    g.role === "subagent" && g.kind === "child"
      ? 104
      : g.role === "lead"
        ? 214
        : g.role === "advisor"
          ? 150
          : shirt;
  c.save();
  c.scale(S * bodyWidth, S);
  // Legs: seated pose from the uncles; standing pose straightens between hip and ankle.
  const legs = SEATED_LEGS[id] ?? SEATED_LEGS[0];
  const kneeY = (-79 + 48) / 2;
  const swing = g.legSwing ?? 0;
  const leftSeat = legs.left.map((p) => [...p] as Pt),
    rightSeat = legs.right.map((p) => [...p] as Pt);
  leftSeat[2][0] += swing;
  rightSeat[2][0] -= swing;
  leftSeat[2][1] -= Math.abs(swing) * 0.5;
  rightSeat[2][1] -= Math.abs(swing) * 0.5;
  // As in the uncles: standing knees sit midway between hip and ankle, ankles land on the floor.
  const kick = (g.a.kick ?? 0) * s;
  const lower = (p: Pt): Pt => [p[0], p[1] - s * 48];
  const leftLeg: Pt[] = [
    [-15, T(-69)],
    lower(mixPt(leftSeat[1], [-17.5, kneeY - jump], s)),
    lower(mixPt(leftSeat[2], [-20, 38 - jump], s)),
  ];
  const rightLeg: Pt[] = [
    [15, T(-69)],
    lower(mixPt(rightSeat[1], [19 + kick * 15, kneeY - jump - kick * 34], s)),
    lower(mixPt(rightSeat[2], [22 + kick * 18, 38 - jump - kick * 44], s)),
  ];
  const drawLeg = (leg: Pt[], tone: number, shade: number) => {
    const pts = leg;
    if (K.shorts) {
      // Shorts to just above the knee, bare shin, and a white sock.
      P.limb(pts, 182, 11);
      P.line([pts[1], along(pts[1], pts[2], 0.25)], 160, 4);
      P.line([along(pts[1], pts[2], 0.72), pts[2]], 66, 13.5);
      P.line([along(pts[1], pts[2], 0.72), pts[2]], 234, 10);
      P.line([pts[0], along(pts[0], pts[1], 0.82)], 66, 17);
      P.line([pts[0], along(pts[0], pts[1], 0.82)], tone, 13.5);
      const hem = along(pts[0], pts[1], 0.82);
      P.line(
        [
          [hem[0] - 6, hem[1]],
          [hem[0] + 6, hem[1]],
        ],
        222,
        1.6,
      );
    } else {
      P.limb(pts, tone, g.kind === "adult" ? 14 : 13);
      P.line([along(pts[0], pts[1], 0.2), pts[1], along(pts[1], pts[2], 0.85)], shade, 1.4);
      if (g.kind === "adult") {
        // Pressed trousers: a sharp crease and a lit knee.
        P.line(
          [along(pts[0], pts[1], 0.3), pts[1], along(pts[1], pts[2], 0.9)],
          Math.min(235, tone + 70),
          1.2,
        );
        P.ellipse(pts[1][0], pts[1][1], 3.5, 2.5, Math.min(220, tone + 35));
      }
    }
  };
  drawLeg(leftLeg, pants, 205);
  drawLeg(rightLeg, pants + 22, 100);
  const footL = leftLeg[2],
    footR = rightLeg[2];
  const shoes = legs.shoes;
  const shoeAt = (foot: Pt, seat: [number, number, number], dir: number, sideSeat: Pt): Pt =>
    s > 0.02 || swing
      ? [foot[0] + dir * 2.5, foot[1] + 8]
      : [seat[0] + (foot[0] - sideSeat[0]), seat[1]];
  const lace = id === 2 || id === 3;
  const sl = shoeAt(footL, shoes[0], -1, leftSeat[2]),
    sr = shoeAt(footR, shoes[1], 1, rightSeat[2]);
  shoe(P, c, sl[0], sl[1], s > 0.02 ? -1 : shoes[0][2], lace);
  shoe(P, c, sr[0], sr[1], s > 0.02 ? 1 : shoes[1][2], lace);
  // Torso: slimmer than the uncles, sloping shoulders, a soft seated waist.
  const L = lean,
    sx = (g.a.turn ?? 0) * 2 + g.sway;
  c.save();
  c.translate(sx, 0);
  const torso: Pt[] = [
    [L - 8, T(-148)],
    [L - 19, T(-143)],
    [L - 26, T(-134)],
    [L - 25, T(-112)],
    [L - 21, T(-88)],
    [-21, T(-74)],
    [-14, T(-66)],
    [15, T(-66)],
    [22, T(-75)],
    [L + 21, T(-90)],
    [L + 25, T(-114)],
    [L + 26, T(-134)],
    [L + 19, T(-143)],
    [L + 8, T(-148)],
  ];
  P.solid(torso, kidTone, 2);
  P.shape(
    [
      [L - 19, T(-140)],
      [L - 25, T(-132)],
      [L - 21, T(-90)],
      [-19, T(-75)],
      [-8, T(-72)],
      [L - 9, T(-116)],
      [L - 11, T(-140)],
    ],
    kidTone - 34,
  );
  P.shape(
    [
      [L + 12, T(-141)],
      [L + 22, T(-134)],
      [L + 21, T(-100)],
      [17, T(-78)],
      [8, T(-75)],
      [L + 6, T(-120)],
    ],
    Math.min(236, kidTone + 22),
  );
  P.ellipse(L, T(-73), 23, 8, kidTone - 10);
  // Cloth folds at the waist and under the arms.
  P.line(
    [
      [-18, T(-74)],
      [-6, T(-78)],
      [10, T(-76)],
      [20, T(-72)],
    ],
    Math.min(240, kidTone + 40),
    1.6,
  );
  P.line(
    [
      [L - 18, T(-108)],
      [L - 13, T(-101)],
      [L - 19, T(-96)],
    ],
    kidTone - 50,
    1.6,
  );
  if (g.kind === "child" && archetypeOf(g.id, g.role) === "chubby") {
    // The chubby baby grows into a round-bellied boy whose shirt strains over the tummy.
    P.solid(
      [
        [L - 22, T(-128)],
        [L - 29, T(-104)],
        [L - 26, T(-80)],
        [L, T(-71)],
        [L + 26, T(-80)],
        [L + 29, T(-104)],
        [L + 22, T(-128)],
      ],
      kidTone + 6,
      1.6,
    );
    P.ellipse(L - 8, T(-104), 9, 13, kidTone + 26);
    P.line(
      [
        [L - 20, T(-82)],
        [L, T(-76)],
        [L + 20, T(-82)],
      ],
      kidTone - 30,
      1.4,
    );
  }
  clothing(P, g, L, T, id);
  // Arms: elbows bend outward; forearms rest on the thighs or reach for a prop.
  const shoulderL: Pt = [L - 21, T(-134)],
    shoulderR: Pt = [L + 21, T(-134)];
  const restL: Pt = [L - 12, T(-86)],
    restR: Pt = [L + 14, T(-86)];
  // Head placement is known before the arms, so a drink can be lifted to the real mouth.
  const neckTop = toReal([L + sx, T(-146)]);
  const r = K.r,
    ry = headHeight(r, g.id, g.kind === "adult" ? 2 : 1);
  const headCenter: Pt = [
    neckTop[0] + g.face.look * 0.6 + (g.a.turn ?? 0) * 2,
    neckTop[1] - K.neck - ry * 0.9 + (g.a.nod ?? 0) * 0.6 + g.face.down,
  ];
  const mouthAt: Pt = [headCenter[0], headCenter[1] + ry * 0.56];
  const planned = g.plan?.(toReal, mouthAt) || {};
  const handL = planned.left ?? g.left ?? restL,
    handR = planned.right ?? g.right ?? restR;
  const elbowFor = (shoulder: Pt, hand: Pt, side: number): Pt => {
    const mid = along(shoulder, hand, 0.5);
    const length = Math.hypot(hand[0] - shoulder[0], hand[1] - shoulder[1]);
    const bend = Math.max(4, 30 - length * 0.32);
    return [mid[0] + side * bend, mid[1] + 6];
  };
  const sleeve = g.role === "subagent" && g.kind === "child" ? 104 : kidTone;
  const arm = (shoulder: Pt, hand: Pt, side: number) => {
    const elbow = elbowFor(shoulder, hand, side);
    P.line([shoulder, elbow, hand], 64, 13);
    P.line([shoulder, elbow, hand], side < 0 ? sleeve + 10 : sleeve - 6, 9);
    P.line(
      [
        [elbow[0] - 2, elbow[1] - 3],
        [elbow[0] + 3, elbow[1]],
      ],
      Math.min(240, sleeve + 50),
      1.6,
    );
    // Ribbed cuff at the wrist.
    const cuff = along(elbow, hand, 0.82);
    P.line([cuff, along(elbow, hand, 0.92)], 222, 9);
  };
  arm(shoulderL, handL, -1);
  arm(shoulderR, handR, 1);
  c.restore();
  c.restore();
  // Head in real units: kids keep big heads.
  if (K.neck)
    P.solid(
      [
        [neckTop[0] - 4.5, neckTop[1] + 2],
        [neckTop[0] + 4.5, neckTop[1] + 2],
        [neckTop[0] + 4, headCenter[1] + ry * 0.7],
        [neckTop[0] - 4, headCenter[1] + ry * 0.7],
      ],
      150,
      1,
    );
  const kind: Age = g.kind === "child" ? 1 : 2;
  const { mouth } = head(P, headCenter[0], headCenter[1], r, g.id, kind, g.role, g.face, g.time);
  g.props?.(toReal);
  // Hands last, so they grip the props.
  c.save();
  c.scale(S * bodyWidth, S);
  c.translate(sx, 0);
  hand(P, handL, -1, g.leftOpen ?? false, (g.a.gesture ?? 0) > 0.4 && s > 0.5);
  hand(P, handR, 1, false, false);
  c.restore();
  return { toReal, headCenter, mouth };
}

function hand(P: Pen, at: Pt, side: number, open: boolean, spread: boolean) {
  const [x, y] = at;
  P.blob(x, y, 5.6, 6, 226, 1.3);
  if (spread) {
    for (let finger = 0; finger < 4; finger++)
      P.line(
        [
          [x - 4 + finger * 2.8, y - 4],
          [x - 6 + finger * 3.6, y - 12 - Math.sin(finger) * 2],
        ],
        66,
        3.6,
      );
    for (let finger = 0; finger < 4; finger++)
      P.line(
        [
          [x - 4 + finger * 2.8, y - 4],
          [x - 6 + finger * 3.6, y - 12 - Math.sin(finger) * 2],
        ],
        232,
        2.2,
      );
  } else if (!open) {
    for (let finger = 0; finger < 3; finger++)
      P.line(
        [
          [x - 3 + finger * 2.8, y - 1],
          [x - 3 + finger * 2.8, y + 3.5],
        ],
        120,
        1,
      );
    P.line(
      [
        [x + side * 3.5, y - 3],
        [x + side * 5.5, y - 5.5],
      ],
      226,
      2.6,
    );
  }
}

/** Role and seat clothing for the kid torso, in uncle units. */
function clothing(P: Pen, g: BodyInput, L: number, T: (y: number) => number, id: number) {
  const neck = T(-146);
  if (g.role === "subagent" && id === 1) {
    // The little executive keeps his tailored jacket and tie as he grows.
    for (const side of [-1, 1]) {
      P.shape(
        [
          [L + side * 5, neck],
          [L + side * 20, T(-138)],
          [L + side * 23, T(-80)],
          [L + side * 3, T(-76)],
        ],
        94,
      );
      P.shape(
        [
          [L + side * 5, neck],
          [L + side * 13, neck + 9],
          [L + side * 4, neck + 23],
          [L, neck + 8],
        ],
        226,
      );
    }
    P.shape(
      [
        [L, neck + 8],
        [L - 3, neck + 14],
        [L - 2, T(-105)],
        [L, T(-101)],
        [L + 2, T(-105)],
        [L + 3, neck + 14],
      ],
      82,
    );
    for (let b = 0; b < 3; b++) P.ellipse(L + 3, T(-100) + b * 8, 1.2, 1.2, 228);
    return;
  }
  if (g.role === "lead") {
    // Little lead: white shirt, dark vest, the sash, as a miniature of the fez uncle.
    for (const side of [-1, 1])
      P.shape(
        [
          [L + side * 5, neck + 2],
          [L + side * 18, T(-138)],
          [L + side * 20, T(-88)],
          [L + side * 6, T(-80)],
        ],
        108,
      );
    P.line(
      [
        [L, neck + 2],
        [L, T(-80)],
      ],
      230,
      2.4,
    );
    P.shape(
      [
        [L - 9, neck],
        [L - 2, neck + 9],
        [L, neck + 3],
      ],
      245,
    );
    P.shape(
      [
        [L + 9, neck],
        [L + 2, neck + 9],
        [L, neck + 3],
      ],
      245,
    );
    P.line(
      [
        [L - 20, T(-140)],
        [L + 19, T(-84)],
      ],
      66,
      10,
    );
    P.line(
      [
        [L - 20, T(-140)],
        [L + 19, T(-84)],
      ],
      240,
      6.5,
    );
    P.ellipse(L + 2, T(-112), 4.5, 4.5, 255);
    return;
  }
  if (g.role === "advisor") {
    // Little professor: cable-knit vest over a collared shirt, with a bow tie.
    for (const rib of [-12, 0, 12]) {
      P.line(
        [
          [L + rib, T(-128)],
          [L + rib, T(-82)],
        ],
        112,
        3.6,
      );
      for (let row = 0; row < 4; row++) {
        const ry = T(-125) + row * 10;
        P.line(
          [
            [L + rib - 2, ry],
            [L + rib + 2, ry + 4],
            [L + rib - 2, ry + 8],
          ],
          196,
          1.3,
        );
      }
    }
    P.line(
      [
        [L - 18, T(-80)],
        [L + 18, T(-80)],
      ],
      70,
      3,
    );
    for (let rib = 0; rib < 9; rib++)
      P.line(
        [
          [L - 17 + rib * 4.2, T(-78)],
          [L - 17 + rib * 4.2, T(-71)],
        ],
        226,
        1.3,
      );
    P.shape(
      [
        [L - 11, neck],
        [L - 2, neck + 7],
        [L, neck + 2],
      ],
      240,
    );
    P.shape(
      [
        [L + 11, neck],
        [L + 2, neck + 7],
        [L, neck + 2],
      ],
      240,
    );
    P.solid(
      [
        [L - 8, neck + 1],
        [L, neck + 4.5],
        [L + 8, neck + 1],
        [L + 8, neck + 9],
        [L, neck + 5.5],
        [L - 8, neck + 9],
      ],
      242,
      1,
    );
    return;
  }
  if (g.kind === "child") {
    if (id === 0 || id === 4 || id === 5) {
      // Casual children have a striped tee, athletic shirt or dungarees.
      if (id === 0) {
        for (let stripe = 0; stripe < 4; stripe++)
          P.line(
            [
              [L - 20, T(-128 + stripe * 11)],
              [L + 20, T(-128 + stripe * 11)],
            ],
            214,
            3,
          );
      } else if (id === 4) {
        P.ring(L, T(-112), 8, 9, 234, 2);
        P.line(
          [
            [L, T(-119)],
            [L, T(-105)],
          ],
          234,
          2.4,
        );
      } else {
        P.solid(
          [
            [L - 14, T(-124)],
            [L + 14, T(-124)],
            [L + 17, T(-77)],
            [L - 17, T(-77)],
          ],
          146,
          1,
        );
        for (const side of [-1, 1]) {
          P.line(
            [
              [L + side * 11, neck + 3],
              [L + side * 11, T(-115)],
            ],
            230,
            4,
          );
          P.ellipse(L + side * 11, T(-118), 1.8, 1.8, 250);
        }
      }
      return;
    }
    // Black school smock ("önlük") with a big white collar, buttons and a pocket.
    P.shape(
      [
        [L - 18, neck + 2],
        [L - 4, neck + 1],
        [L, neck + 10],
        [L - 3, neck + 15],
        [L - 16, neck + 12],
      ],
      248,
    );
    P.shape(
      [
        [L + 18, neck + 2],
        [L + 4, neck + 1],
        [L, neck + 10],
        [L + 3, neck + 15],
        [L + 16, neck + 12],
      ],
      248,
    );
    P.line(
      [
        [L - 16, neck + 12],
        [L - 3, neck + 15],
        [L, neck + 10],
        [L + 3, neck + 15],
        [L + 16, neck + 12],
      ],
      150,
      1.2,
    );
    for (let b = 0; b < 4; b++) P.ellipse(L, T(-122) + b * 11, 1.6, 1.6, 236);
    P.line(
      [
        [L + 6, T(-104)],
        [L + 17, T(-104)],
        [L + 16, T(-92)],
        [L + 7, T(-92)],
        [L + 6, T(-104)],
      ],
      196,
      1.2,
    );
    // Name tag pinned on the chest.
    P.shape(
      [
        [L - 17, T(-126)],
        [L - 7, T(-126)],
        [L - 7, T(-120)],
        [L - 17, T(-120)],
      ],
      222,
    );
    return;
  }
  // Grown-ups: their own clothes, with the uncles' work apron on top.
  P.shape(
    [
      [L - 9, neck],
      [L - 2, neck + 8],
      [L, neck + 2],
    ],
    238,
  );
  P.shape(
    [
      [L + 9, neck],
      [L + 2, neck + 8],
      [L, neck + 2],
    ],
    238,
  );
  if (id === 0) {
    // Knitted V-neck vest over a shirt.
    for (const side of [-1, 1])
      P.shape(
        [
          [L + side * 3, neck + 8],
          [L + side * 18, T(-140)],
          [L + side * 20, T(-80)],
          [L + side * 4, T(-78)],
        ],
        124,
      );
    for (let row = 0; row < 5; row++)
      P.line(
        [
          [L - 19, T(-130) + row * 11],
          [L + 19, T(-130) + row * 11],
        ],
        150,
        1,
      );
  } else if (id === 1) {
    // Wool jacket with lapels and a breast pocket.
    for (const side of [-1, 1])
      P.shape(
        [
          [L + side * 3, neck + 3],
          [L + side * 21, T(-141)],
          [L + side * 22, T(-78)],
          [L + side * 6, T(-78)],
          [L + side * 6, T(-112)],
        ],
        100,
      );
    for (const side of [-1, 1])
      P.line(
        [
          [L + side * 4, neck + 4],
          [L + side * 13, T(-128)],
          [L + side * 7, T(-112)],
        ],
        170,
        1.4,
      );
    P.line(
      [
        [L - 18, T(-112)],
        [L - 10, T(-112)],
      ],
      210,
      1.4,
    );
  } else if (id === 4) {
    // Checked shirt.
    for (let row = 0; row < 5; row++)
      P.line(
        [
          [L - 20, T(-128) + row * 10],
          [L + 20, T(-128) + row * 10],
        ],
        104,
        1.3,
      );
    for (let col = 0; col < 5; col++)
      P.line(
        [
          [L - 16 + col * 8, T(-136)],
          [L - 16 + col * 8, T(-80)],
        ],
        212,
        1.1,
      );
  } else {
    for (let row = 0; row < 3; row++) {
      const yy = T(-128) + row * 14;
      P.line(
        [
          [L - 20, yy],
          [L - 13, yy + 4],
          [L - 6, yy],
          [L + 1, yy + 4],
          [L + 8, yy],
          [L + 15, yy + 4],
          [L + 20, yy],
        ],
        210,
        1.6,
      );
    }
  }
  P.shape(
    [
      [L - 12, T(-114)],
      [L + 12, T(-114)],
      [L + 15, T(-72)],
      [L - 15, T(-72)],
    ],
    200,
  );
  P.line(
    [
      [L - 12, T(-114)],
      [L - 9, neck + 2],
    ],
    224,
    2.4,
  );
  P.line(
    [
      [L + 12, T(-114)],
      [L + 9, neck + 2],
    ],
    224,
    2.4,
  );
  P.line(
    [
      [L - 5, T(-98)],
      [L + 5, T(-98)],
      [L + 5, T(-88)],
      [L - 5, T(-88)],
      [L - 5, T(-98)],
    ],
    112,
    1.3,
  );
  P.line(
    [
      [L - 15, T(-82)],
      [L - 24, T(-78)],
    ],
    224,
    1.6,
  );
}

/* ---------------------------------------------------------------- stages */

export type CrewAge = "baby" | "child" | "adult";
export type YoungInput = { age: CrewAge; id: number; pose: TeaPose; a: CrewActivity; time: number };

/** Seated, idle props share the uncles' clocks: tea becomes a bottle, a juice box or Turkish coffee;
 * the cigarette break becomes a rattle, a yo-yo or a phone. Working = bouncing in the jumper or standing. */
export function drawYoung(c: C, { age, id, pose, a, time }: YoungInput) {
  const k: Age = age === "baby" ? 0 : age === "child" ? 1 : 2;
  const P = pen(c);
  const role = a.role ?? (id === 2 ? "lead" : id === 3 ? "advisor" : "subagent");
  const progress = clamp01(a.stand ?? 0);
  const s = ease(progress);
  const seated = 1 - s;
  const toyOn = !!a.smoking && progress < 0.02 && !a.working;
  const play = toyOn ? (a.smokeLift ?? 0) : 0;
  const joy = toyOn ? (a.exhale ?? 0) : 0;
  const lift = toyOn || a.working ? 0 : poseLift(pose) * seated;
  const breath = (a.breath ?? 0) * 0.8,
    sway = a.sway ?? 0;
  const seatedFace = (): Face => {
    const f = faceOf(a, 0);
    f.laugh = Math.max(f.laugh, joy);
    if (joy) f.chuckle = Math.sin(time / 170) * 1.7 * joy;
    return f;
  };
  const layer = (weight: number, draw: () => void) => {
    if (weight > 0.01) P.alpha(weight, draw);
  };
  if (k === 0) {
    baby(c, P, id, role, a, time, s, lift, toyOn, play, joy, breath, sway, seatedFace, layer);
    return;
  }
  // Child and adult: a chair like the uncles', smaller for the child.
  const kind: Kind = k === 1 ? "child" : "adult";
  const S = KINDS[kind].S;
  const bodyWidth = portraitOf(id).body;
  const top = -131 * S,
    seat = -65 * S,
    half = 34 * S + 2;
  P.line(
    [
      [-half, top],
      [-half - 1, -5],
    ],
    104,
    3.6,
  );
  P.line(
    [
      [half, top],
      [half + 1, -5],
    ],
    104,
    3.6,
  );
  P.line(
    [
      [-half, top + 1],
      [half, top + 1],
    ],
    120,
    3.6,
  );
  P.line(
    [
      [-half, top + 14],
      [half, top + 14],
    ],
    112,
    2,
  );
  if (s > 0.02) {
    P.line(
      [
        [-half - 1, seat],
        [-half + 8, seat],
      ],
      120,
      3.6,
    );
    P.line(
      [
        [half - 8, seat],
        [half + 1, seat],
      ],
      120,
      3.6,
    );
  } else
    P.line(
      [
        [-half, seat],
        [half, seat],
      ],
      120,
      3.6,
    );
  const face = characterFace(s > 0.5 ? faceOf(a, 1) : seatedFace(), archetypeOf(id, role), k);
  face.mouthBusy = lift > 0.6;
  if (kind === "adult" && toyOn) face.down = 2.5 * ease(play * 2);
  const g = a.gesture ?? 0,
    thought = a.thought ?? 0,
    armRest = (a.armRest ?? 0.65) * (1 - thought);
  let left: Pt | null = null,
    right: Pt | null = null;
  const rise = s * 48;
  let held: Pt = [0, 0];
  if (s > 0.5) {
    // Standing: the free hand argues beside the face, the other rests on the hip.
    const lean = LEAN[id % 6];
    const raised: Pt = [lean - 40 - g * 5, -139 - g * 19 - rise];
    const rest: Pt = [lean - 30, -96 - rise];
    const chin: Pt = [lean - 6, -150 - rise];
    left = mixPt(mixPt(raised, rest, armRest), chin, thought);
    right = [lean + 26, -92 - rise];
  } else if (toyOn && kind === "child") left = [LEAN[id % 6] - 34, -128 - play * 12];
  else if (toyOn && kind === "adult") {
    left = [-9, -104];
    right = [9, -104];
  }
  kidBody(c, P, {
    kind,
    id,
    role,
    a,
    time,
    stand: s,
    progress,
    breath: breath * seated,
    sway: sway * seated,
    face,
    left,
    right,
    leftOpen: toyOn && kind === "child",
    legSwing: seated * (kind === "child" ? Math.sin(time / 380) * 3 : 0),
    plan: (toReal, mouth) => {
      if (s > 0.5) return;
      const rest = toReal([LEAN[id % 6] + 14, -86]);
      if (kind === "child") {
        held = mixPt([rest[0] + 3, rest[1] - 8], [mouth[0] + 2, mouth[1] + 16], ease(lift));
        if (lift > 0.05)
          return { right: [(held[0] + 5) / (S * bodyWidth), (held[1] + 3) / S] as Pt };
      } else {
        held = mixPt([rest[0] + 4, rest[1] - 6], [mouth[0] + 4, mouth[1] + 5], ease(lift));
        if (lift > 0.05)
          return { right: [(held[0] + 7) / (S * bodyWidth), (held[1] + 1) / S] as Pt };
      }
    },
    props: (toReal) => {
      if (s > 0.5) return;
      if (kind === "child") {
        juiceBox(P, held);
        if (toyOn) yoyo(P, toReal([LEAN[id % 6] - 34, -128 - play * 12]), play, time);
      } else {
        if (!toyOn) coffee(P, held, lift, time);
        if (toyOn) phone(P, toReal([0, -108]), time, joy);
      }
    },
  });
  if ((a.impact ?? 0) > 0.05) {
    const spread = 1 - (a.impact ?? 0);
    P.alpha(Math.min(1, (a.impact ?? 0) * 1.6), () =>
      P.ring(14, -3, 7 + spread * 16, 2 + spread * 3, 235, 1.8),
    );
  }
}

/* ---------------------------------------------------------------- baby */

function baby(
  c: C,
  P: Pen,
  id: number,
  role: CrewRole,
  a: CrewActivity,
  time: number,
  s: number,
  lift: number,
  toyOn: boolean,
  play: number,
  joy: number,
  breath: number,
  sway: number,
  seatedFace: () => Face,
  layer: (weight: number, draw: () => void) => void,
) {
  const look = archetypeOf(id, role);
  const tone =
    look === "chubby"
      ? 196
      : look === "boss"
        ? 108
        : role === "lead"
          ? 214
          : role === "advisor"
            ? 168
            : [196, 178, 0, 0, 190, 182][id % 6];
  const r = id % 6 === 4 ? 19 : id % 6 === 1 ? 17.5 : 18;
  /** Chubby baby: pear-shaped onesie, frog legs, little fists. */
  const body = (hip: Pt, legs: "frog" | "stand", hands: [Pt, Pt], kick: number, footY: number) => {
    const [hx, hy] = hip;
    for (const side of [-1, 1]) {
      const knee: Pt =
        legs === "frog"
          ? [hx + side * 15, hy + 3 + kick * side]
          : [hx + side * 12, mix(hy, footY, 0.5)];
      const foot: Pt =
        legs === "frog" ? [hx + side * 8, hy + 10 - kick * side * 0.5] : [hx + side * 7, footY];
      P.limb(
        [[hx + side * 6, hy - 2], knee, foot],
        // Shaded sides stay above the glyph gap threshold, even on the dark suit.
        side < 0 ? tone : Math.max(88, tone - 22),
        (legs === "frog" ? 9 : 10.5) * (look === "chubby" ? 1.25 : 1),
      );
      P.line(
        [
          [knee[0] - side * 2, knee[1] - 2],
          [knee[0] + side * 1, knee[1] + 2],
        ],
        232,
        1.2,
      );
      if (look === "chubby") {
        // Bare, plump feet.
        P.blob(foot[0] + side * 1.5, foot[1] + 2, 5.6, 3.8, 204, 1.1);
        for (let toe = 0; toe < 3; toe++)
          P.ellipse(foot[0] + side * (3 + toe * 1.6), foot[1] + 0.4, 0.9, 0.9, 226);
      } else if (look === "boss") {
        // Polished little shoes under the trousers.
        P.blob(foot[0] + side * 2, foot[1] + 2.5, 5.6, 3.4, 118, 1.2);
        P.ellipse(foot[0] + side * 3.5, foot[1] + 1.5, 2, 0.9, 200);
      } else {
        // Knitted bootie with a cuff.
        P.blob(foot[0] + side * 1.5, foot[1] + 2, 5.4, 4, 226, 1.2);
        P.line(
          [
            [foot[0] - 3.5 + side * 1.5, foot[1] - 1],
            [foot[0] + 3.5 + side * 1.5, foot[1] - 1],
          ],
          150,
          1.6,
        );
      }
    }
    const bellyWidth = (look === "chubby" ? 19 : 15) * portraitOf(id).body;
    P.solid(
      [
        [hx - 11, hy - 26],
        [hx - bellyWidth, hy - 16],
        [hx - bellyWidth * 0.94, hy - 4],
        [hx - 7, hy + 2],
        [hx + 7, hy + 2],
        [hx + bellyWidth * 0.94, hy - 4],
        [hx + bellyWidth, hy - 16],
        [hx + 11, hy - 26],
        [hx, hy - 29],
      ],
      tone,
      1.6,
    );
    P.ellipse(hx - 4, hy - 15, 6, 8, Math.min(240, tone + 26));
    P.shape(
      [
        [hx + 9, hy - 24],
        [hx + 14, hy - 15],
        [hx + 12, hy - 4],
        [hx + 6, hy],
      ],
      Math.max(88, tone - 34),
    );
    // Diaper bulge and snaps.
    P.line(
      [
        [hx - 10, hy - 2],
        [hx, hy + 1],
        [hx + 10, hy - 2],
      ],
      tone - 40,
      1.4,
    );
    if (look === "chubby") {
      // Bare belly: chest creases, navel, and a white diaper held by a safety pin.
      for (const side of [-1, 1])
        P.line(
          [
            [hx + side * 2, hy - 21],
            [hx + side * 7, hy - 18.5],
            [hx + side * 11, hy - 21],
          ],
          170,
          1.2,
        );
      P.ellipse(hx, hy - 9, 1.3, 1.6, 140);
      P.solid(
        [
          [hx - bellyWidth * 0.9, hy - 5],
          [hx + bellyWidth * 0.9, hy - 5],
          [hx + bellyWidth * 0.7, hy + 3],
          [hx + 4, hy + 6],
          [hx - 4, hy + 6],
          [hx - bellyWidth * 0.7, hy + 3],
        ],
        240,
        1.4,
      );
      P.line(
        [
          [hx - bellyWidth * 0.85, hy - 3.6],
          [hx + bellyWidth * 0.85, hy - 3.6],
        ],
        212,
        1.2,
      );
      P.line(
        [
          [hx + 7, hy - 2.5],
          [hx + 12, hy - 1.5],
        ],
        110,
        1.2,
      );
      P.ring(hx + 6.5, hy - 2.4, 1.3, 1.3, 110, 1);
    } else for (let snap = 0; snap < 3; snap++) P.ellipse(hx - 4 + snap * 4, hy, 0.9, 0.9, 245);
    if (look === "chubby") {
      /* No onesie decoration. */
    } else if (look === "boss") {
      // Jacket lapels over a white shirt and a dark tie.
      P.solid(
        [
          [hx - 6, hy - 28],
          [hx + 6, hy - 28],
          [hx, hy - 13],
        ],
        238,
        0.9,
      );
      P.shape(
        [
          [hx, hy - 25.5],
          [hx - 2, hy - 23],
          [hx - 1.4, hy - 15],
          [hx, hy - 12.5],
          [hx + 1.4, hy - 15],
          [hx + 2, hy - 23],
        ],
        52,
      );
      for (const side of [-1, 1])
        P.line(
          [
            [hx + side * 6.5, hy - 27.5],
            [hx + side * 4, hy - 20],
            [hx + side * 0.8, hy - 13],
          ],
          150,
          1.3,
        );
      for (const by of [-10, -5]) P.ellipse(hx + 2.5, hy + by, 0.9, 0.9, 170);
    } else if (role === "subagent" && id % 6 === 1) {
      for (const side of [-1, 1]) {
        P.shape(
          [
            [hx + side * 5, hy - 27],
            [hx + side * 11, hy - 24],
            [hx + side * bellyWidth, hy - 6],
            [hx + side * 3, hy - 3],
          ],
          92,
        );
        P.shape(
          [
            [hx + side * 5, hy - 27],
            [hx + side * 9, hy - 22],
            [hx, hy - 15],
          ],
          242,
        );
      }
      P.shape(
        [
          [hx, hy - 22],
          [hx - 2.5, hy - 18],
          [hx - 2, hy - 8],
          [hx, hy - 5],
          [hx + 2, hy - 8],
          [hx + 2.5, hy - 18],
        ],
        78,
      );
    } else if (role === "subagent") {
      P.solid(
        [
          [hx - 9, hy - 28],
          [hx - 11, hy - 18],
          [hx, hy - 12],
          [hx + 11, hy - 18],
          [hx + 9, hy - 28],
          [hx, hy - 25],
        ],
        238,
        1.1,
      );
      P.ellipse(hx, hy - 20, 3.4, 2.4, 150);
    } else if (role === "lead") {
      P.line(
        [
          [hx - 11, hy - 25],
          [hx + 11, hy - 4],
        ],
        66,
        6,
      );
      P.line(
        [
          [hx - 11, hy - 25],
          [hx + 11, hy - 4],
        ],
        240,
        3.6,
      );
    } else {
      P.solid(
        [
          [hx - 6, hy - 29],
          [hx, hy - 26.5],
          [hx + 6, hy - 29],
          [hx + 6, hy - 23.5],
          [hx, hy - 25.5],
          [hx - 6, hy - 23.5],
        ],
        244,
        0.9,
      );
    }
    for (const [index, handAt] of hands.entries()) {
      const side = index ? 1 : -1;
      const shoulder: Pt = [hx + side * 11, hy - 23];
      const elbow: Pt = [
        mix(shoulder[0], handAt[0], 0.5) + side * 7,
        mix(shoulder[1], handAt[1], 0.5) + 3,
      ];
      P.limb(
        [shoulder, elbow, handAt],
        side < 0 ? tone + 6 : Math.max(92, tone - 14),
        look === "chubby" ? 9.5 : 7.5,
      );
      P.line(
        [
          [elbow[0] - 1.5, elbow[1] - 2],
          [elbow[0] + 1.5, elbow[1] + 1],
        ],
        236,
        1,
      );
    }
  };
  const fist = (p: Pt) => {
    P.blob(p[0], p[1], 4.2, 4.2, 226, 1.1);
    for (let f = 0; f < 3; f++)
      P.line(
        [
          [p[0] - 2.2 + f * 2.2, p[1] - 0.5],
          [p[0] - 2.2 + f * 2.2, p[1] + 2.4],
        ],
        128,
        0.8,
      );
  };
  layer(1 - s, () => {
    // Baby bouncer ("ana kucağı"): wire base, reclined padded seat with a toy bar.
    P.line(
      [
        [-36, -3],
        [36, -3],
      ],
      120,
      3,
    );
    P.line(
      [
        [-36, -3],
        [-28, -15],
      ],
      120,
      3,
    );
    P.line(
      [
        [36, -3],
        [28, -15],
      ],
      120,
      3,
    );
    P.solid(
      [
        [-27, -13],
        [26, -13],
        [31, -28],
        [22, -44],
        [2, -52],
        [-20, -50],
        [-31, -37],
      ],
      112,
      1.6,
    );
    P.line(
      [
        [-31, -37],
        [-20, -50],
        [2, -52],
        [22, -44],
        [31, -28],
      ],
      206,
      1.8,
    );
    for (let quilt = 0; quilt < 3; quilt++)
      P.line(
        [
          [-20 + quilt * 18, -46 + quilt * 2],
          [-16 + quilt * 16, -18],
        ],
        140,
        1,
      );
    const face = seatedFace();
    characterFace(face, look, 0);
    face.pacifier = id % 6 === 0 && lift < 0.05 && !toyOn && face.laugh < 0.1;
    face.mouthBusy = lift > 0.6;
    const hip: Pt = [2 + sway, -21 - breath];
    const headAt: Pt = [hip[0] - 2, hip[1] - 29 - r * 0.72];
    const mouth: Pt = [headAt[0], headAt[1] + r * 0.56];
    const tip = mixPt([-6, -32], [mouth[0] + 1, mouth[1] + 2], ease(lift));
    const base = mixPt([16, -26], [mouth[0] + 20, mouth[1] - 12], ease(lift));
    const right = along(base, tip, 0.3);
    const idle = !toyOn && lift <= 0.3;
    // At rest the suited baby folds its hands, the chubby one plants a fist on its hip.
    const left: Pt = toyOn
      ? [-22 + sway, -52 - play * 9]
      : !idle
        ? along(base, tip, 0.64)
        : look === "boss"
          ? [right[0] - 7, right[1] - 1]
          : look === "chubby"
            ? [hip[0] - 21, hip[1] - 12]
            : [-8, -30];
    const kick = (joy + (a.laugh ?? 0)) * Math.sin(time / 130) * 3;
    body(
      hip,
      "frog",
      [
        [left[0], left[1] + 2],
        [right[0], right[1] + 2],
      ],
      kick,
      0,
    );
    head(P, headAt[0], headAt[1], r, id, 0, role, face, time);
    bottle(P, c, base, tip, lift, time);
    if (toyOn) rattle(P, c, [left[0], left[1] + 2], play, time);
    fist([left[0], left[1] + 2]);
    fist([right[0], right[1] + 2]);
    // Toy bar arching over the bouncer, with a dangling star.
    P.line(
      [
        [-31, -36],
        [-30, -64],
        [-18, -80],
      ],
      150,
      2.2,
    );
    const dangle = Math.sin(time / 600) * 2;
    P.line(
      [
        [-24, -74],
        [-25 + dangle, -66],
      ],
      200,
      1,
    );
    P.shape(
      [
        [-25 + dangle, -67],
        [-23 + dangle, -62],
        [-18 + dangle, -62],
        [-22 + dangle, -59],
        [-20 + dangle, -54],
        [-25 + dangle, -57],
        [-30 + dangle, -54],
        [-28 + dangle, -59],
        [-32 + dangle, -62],
        [-27 + dangle, -62],
      ],
      236,
    );
  });
  layer(s, () => {
    // Activity jumper ("hoplama salıncağı"): feet on a round base, a toy ring around the waist,
    // springs in the three posts. The baby stands and bounces; nothing hangs from above.
    const beat = Math.abs(Math.sin(time / 300));
    const bounce = beat * 9 + (a.jump ?? 0) * 4;
    const ringY = -50 - bounce;
    P.blob(0, -4, 44, 6.5, 150, 1.4);
    P.ellipse(-8, -6, 26, 3, 196);
    for (const x of [-38, 38]) {
      P.line(
        [
          [x, -6],
          [x * 0.92, ringY + 4],
        ],
        66,
        6,
      );
      P.line(
        [
          [x, -6],
          [x * 0.92, ringY + 4],
        ],
        196,
        3.2,
      );
      const coils: number[][] = [];
      for (let n = 0; n <= 8; n++)
        coils.push([x * 0.95 + (n % 2 ? 3 : -3), -20 - (((ringY + 24) * -n) / 8) * -1]);
      P.line(
        coils.map(([cx, cy]) => [cx, mix(-14, ringY + 8, (cy + 20) / (ringY + 4))]),
        232,
        1.4,
      );
    }
    const hip: Pt = [0, ringY + 10];
    const g = a.gesture ?? 0;
    const pat = Math.sin(time / 170) * 3;
    const face = characterFace(faceOf(a, 1), look, 0);
    body(
      hip,
      "stand",
      [
        [-20 - g * 3, ringY - 2 + pat],
        [20, ringY - 2 - pat],
      ],
      0,
      -10,
    );
    // The fabric seat ring and the toy tray around the waist.
    P.blob(0, ringY + 2, 40, 7.5, 214, 1.6);
    P.ellipse(0, ringY + 1, 30, 4.5, 236);
    P.ellipse(0, ringY + 3, 16, 4.2, 110);
    for (const [tx, kind] of [
      [-30, 0],
      [28, 1],
      [-17, 2],
    ] as const) {
      if (kind === 0) {
        P.blob(tx, ringY - 3, 4.5, 4.5, 232, 1);
        P.line(
          [
            [tx - 3, ringY - 3],
            [tx + 3, ringY - 3],
          ],
          110,
          1,
        );
      } else if (kind === 1) {
        P.solid(
          [
            [tx - 4, ringY - 1],
            [tx, ringY - 9],
            [tx + 4, ringY - 1],
          ],
          228,
          1,
        );
      } else {
        P.ring(tx, ringY - 3, 3.4, 3.4, 240, 1.4);
      }
    }
    head(P, hip[0], hip[1] - 29 - r * 0.72, r, id, 0, role, face, time);
    fist([-20 - g * 3, ringY - 2 + pat]);
    fist([20, ringY - 2 - pat]);
    if (beat < 0.18)
      for (const side of [-1, 1])
        P.line(
          [
            [side * 12, -6],
            [side * 19, -10],
          ],
          230,
          1.3,
        );
  });
}

/** Stage-change sparkle: a ring of four-point stars that expands and fades. */
export function growthSparkle(c: C, progress: number, height: number) {
  const P = pen(c);
  P.alpha(Math.sin(Math.PI * progress), () => {
    for (let n = 0; n < 8; n++) {
      const angle = (n / 8) * Math.PI * 2 + progress * 1.4;
      const radius = 30 + progress * 34;
      const x = Math.cos(angle) * radius,
        y = -height / 2 + Math.sin(angle) * radius * 0.9;
      const size = 3 + (n % 2) * 2;
      P.line(
        [
          [x - size, y],
          [x + size, y],
        ],
        250,
        1.8,
      );
      P.line(
        [
          [x, y - size],
          [x, y + size],
        ],
        250,
        1.8,
      );
    }
  });
}
