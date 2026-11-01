import type { LiveBackgroundPalette, LiveBackgroundScene } from "./types";

/** Code glyphs in three weights. Lit surfaces use the dense digits, shadows thin punctuation, so
 * light reads through glyph density as well as alpha. Heavy marks (#, @, &, %) read as blots at
 * these sizes and are left out. */
const GLYPHS = ".:;-,'" + "+=<>/()[]{}*~" + "0123456789abcdef";
/** [start, length] of each glyph pool: faint, medium, dense, and any code glyph. */
const POOLS: readonly (readonly [number, number])[] = [
  [0, 6],
  [6, 13],
  [19, 16],
  [6, 29],
];
const DENSE = 2;
const CODE = 3;
/** Glyph cells in em units. Rain grids leave air between columns, so they read as falling
 * streams rather than lines of text; contour grids pack tighter to trace a clean edge. */
const RAIN_CELL = [0.82, 1.12] as const;
const CONTOUR_CELL = [0.62, 1.2] as const;
/** Square cells for halftone figures: dots, not lines of text. */
const DOT_CELL = [0.72, 0.72] as const;
const MIN_FONT = 6;
/** Alpha is quantized so each pass changes canvas state a bounded number of times. */
const ALPHA_LEVELS = 24;
const MIN_LEVEL = 1;
/** Extra stream travel while new text arrives, in rows per second of eased energy. */
const ENERGY_RUSH = 9;
const SYLLABLES_PER_SECOND = 3.4;
/** A stream's leading glyph: it is drawn in the accent color. */
const HEAD_GLOW = 0.9;
/** Font tiers, back to front: far rain, the figure's own grid, near rain. */
const TIERS = 3;
const FAR = 0;
const FIGURE = 1;
const NEAR = 2;
/** Draw groups: every tier in the content color, then in the accent color. */
const GROUPS = TIERS * 2;

/** Head ellipse shared by the outline and the relief: center and radii in scale units. */
const HEAD_Y = -0.42;
const HEAD_RX = 0.42;
const HEAD_RY = 0.54;
/** The jaw narrows gently below the cheekbones; a strong taper reads as an alien chin. */
const JAW_TAPER = 0.16;
/** Superellipse exponents: a fuller cranium above, a rounded-square jaw below. */
const CRANIUM_ROUNDNESS = 2.3;
const JAW_ROUNDNESS = 2.15;

const normalize = (x: number, y: number, z: number) => {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length] as const;
};
/** Key light from the upper left and in front, as on a lit sculpture. */
const LIGHT = normalize(-0.5, -0.55, 0.68);
/** Half vector between the key light and the viewer, for small specular glints. */
const HALF = normalize(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
/** Backlight direction in the picture plane: the rim catches it on the upper right. */
const RIM_LIGHT = normalize(0.7, -0.72, 0);

/** Latent face: depth of the sculpted face and the rounded bevel of neck and shoulders. */
const FACE_DEPTH = 0.34;
const BEVEL = 0.2;

type Column = { speed: number; offset: number; trail: number; period: number };

/** `luminous`: the figure itself is lit code, condensing out of faint rain.
 * `eclipse`: a machine face emerging from the dark inside layered code rain.
 * `serene`: a calm, softly lit face with closed eyes among slowly drifting dust. */
type FigureStyle = "luminous" | "eclipse" | "serene";
type StyleConfig = {
  /** Pane height per scale unit: the eclipse frames the figure closer. */
  headShare: number;
  /** Glyph size per tier as a share of the scale, and the cell budget each grid may use. */
  fontShare: readonly [number, number, number];
  maxCells: readonly [number, number, number];
  /** Cell shape of the figure's own grid. */
  figureCell: readonly [number, number];
  /** How fast settled glyphs are rewritten, and the stream brightness above which a head is
   * drawn dense and in the accent color (above 1: never). */
  mutation: number;
  headGlow: number;
  /** Optional luminance ramp, dark to light: glyphs then follow each cell's brightness instead
   * of being drawn from the code pools, so the figure reads as an image rather than as code. */
  ramp?: string;
};
const STYLES: Record<FigureStyle, StyleConfig> = {
  luminous: {
    headShare: 1.78,
    fontShare: [0.019, 0.02, 0],
    maxCells: [9000, 9000, 0],
    figureCell: RAIN_CELL,
    mutation: 1,
    headGlow: HEAD_GLOW,
  },
  eclipse: {
    headShare: 1.86,
    fontShare: [0.021, 0.0165, 0.036],
    maxCells: [9000, 16000, 3000],
    figureCell: CONTOUR_CELL,
    mutation: 1,
    headGlow: HEAD_GLOW,
  },
  serene: {
    headShare: 1.86,
    fontShare: [0.02, 0.019, 0],
    maxCells: [7000, 9000, 0],
    figureCell: DOT_CELL,
    mutation: 0,
    headGlow: 2,
    ramp: "··••••",
  },
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** Integer hash to [0, 1): layout and glyph choice are fixed for a given time, never random. */
function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a + 0x9e3779b9, 374761393) ^ Math.imul(b + 0x85ebca6b, 668265263);
  h = Math.imul(h ^ c ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Brightness of a falling stream's trail at `row`, 1 at the head and fading upward. */
function trailAt(head: number, row: number, trail: number): number {
  const behind = head - row;
  return behind >= 0 && behind < trail ? (1 - behind / trail) ** 1.6 : 0;
}

function smoothMin(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return b + (a - b) * h - k * h * (1 - h);
}

function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  return (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
}

function box(x: number, y: number, cx: number, cy: number, hx: number, hy: number): number {
  const dx = Math.abs(x - cx) - hx;
  const dy = Math.abs(y - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}

/** Deterministic speech rhythm: syllables of varying size with occasional pauses, closed
 * once the reply ends. */
export function mouthOpening(time: number, presence: number, energy = 0): number {
  if (presence <= 0) return 0;
  const beat = time * SYLLABLES_PER_SECOND;
  const syllable = Math.floor(beat);
  const size = hash(syllable, 23);
  if (size < 0.12) return 0;
  const phase = Math.sin((beat - syllable) * Math.PI);
  return presence * (0.45 + 0.55 * size) * (0.8 + 0.2 * energy) * phase ** 0.7;
}

/** Head-local position with the jaw taper applied, so the outline and relief agree. */
function headLocal(x: number, y: number): readonly [number, number] {
  const v = (y - HEAD_Y) / HEAD_RY;
  return [(x / HEAD_RX) * (1 + JAW_TAPER * Math.max(0, v) ** 1.5), v];
}

function headDistance(x: number, y: number): number {
  const [u, v] = headLocal(x, y);
  const n = v < 0 ? CRANIUM_ROUNDNESS : JAW_ROUNDNESS;
  return ((Math.abs(u) ** n + Math.abs(v) ** n) ** (1 / n) - 1) * Math.min(HEAD_RX, HEAD_RY);
}

/** Signed distance (negative inside) of the head and shoulders, in scale units. Human
 * proportions keep the figure from reading as an alien: ears at eye-to-nose height, a neck
 * about half the head's width, and trapezius slopes into shoulders three heads wide. */
function silhouetteDistance(x: number, y: number): number {
  const head = headDistance(x, y);
  const ears = ellipse(Math.abs(x), y, HEAD_RX + 0.005, HEAD_Y + 0.04, 0.055, 0.12);
  const neck = box(x, y, 0, 0.24, 0.2, 0.2);
  const shoulders = ellipse(x, y, 0, 1.02, 1.32, 0.58);
  return smoothMin(smoothMin(smoothMin(head, ears, 0.04), neck, 0.08), shoulders, 0.36);
}

/** Gaussian bump in head-local units. */
function bump(u: number, v: number, cu: number, cv: number, su: number, sv: number): number {
  return Math.exp(-(((u - cu) / su) ** 2) - ((v - cv) / sv) ** 2);
}

/** Facial relief in head-local units (u across, v down, both -1..1) with the jaw dropped by
 * `jaw` (0 closed, 1 open). Raised forms and cavities are returned separately: cavities also
 * darken through occlusion. A generic sculpted face, not any particular person. */
let reliefRaised = 0;
let reliefCavity = 0;
function faceRelief(u: number, v: number, jaw: number) {
  // Smooth absolute value: a hard |u| would crease the relief down the middle.
  const au = Math.sqrt(u * u + 0.004);
  const drop = jaw * 0.09;
  // Below the mouth, features follow the jaw down.
  const lv = v > 0.64 ? v - drop : v;
  reliefRaised =
    0.12 * bump(au, v, 0.37, -0.2, 0.3, 0.07) + // brow ridge
    0.26 * bump(au, v, 0.35, -0.03, 0.11, 0.03) + // closed eyelids
    0.14 * bump(u, v, 0, 0.12, 0.07, 0.23) + // nose bridge
    0.16 * bump(u, v, 0, 0.33, 0.11, 0.08) + // nose tip
    0.07 * bump(au, v, 0.13, 0.37, 0.07, 0.05) + // nostril wings
    0.045 * bump(au, v, 0.56, 0.24, 0.2, 0.08) + // cheekbones
    0.13 * bump(u, v, 0, 0.59, 0.19, 0.05) + // upper lip
    0.15 * bump(u, lv, 0, 0.73, 0.16, 0.06) + // lower lip
    0.1 * bump(u, lv, 0, 0.92, 0.18, 0.1); // chin
  reliefCavity =
    0.16 * bump(au, v, 0.36, -0.06, 0.15, 0.08) + // eye sockets
    0.08 * bump(au, v, 0.08, 0.43, 0.04, 0.03) + // nostrils
    0.08 * bump(au, v, 0.5, 0.56, 0.15, 0.15) + // cheek hollows
    0.1 * bump(u, v, 0, 0.66 + drop * 0.5, 0.2, 0.025) + // lip line
    0.45 * jaw * bump(u, v, 0, 0.665 + drop * 0.5, 0.13, 0.02 + jaw * 0.05) + // open mouth
    0.05 * bump(u, lv, 0, 0.82, 0.16, 0.04); // under the lower lip
}

function faceHeight(u: number, v: number, jaw: number): number {
  const base = Math.sqrt(Math.max(0.0001, 1 - u * u - v * v));
  faceRelief(u, v, jaw);
  return base + reliefRaised - reliefCavity;
}

/** Height of the sculpted bust in scale units: a rounded bevel for neck and shoulders, the
 * modelled face on the head. Zero outside the outline. */
function bustHeight(x: number, y: number, jaw: number): number {
  const distance = silhouetteDistance(x, y);
  if (distance >= 0) return 0;
  const t = clamp01(-distance / BEVEL);
  const body = BEVEL * Math.sqrt(1 - (1 - t) * (1 - t));
  const onHead = smoothstep(0.02, -0.08, headDistance(x, y));
  if (onHead === 0) return body;
  const [u, v] = headLocal(x, y);
  const face = faceHeight(u, v, jaw) * FACE_DEPTH;
  return body + (Math.max(body, face) - body) * onHead;
}

/** Shading of the luminous bust, written to the scratch values below to avoid allocation. */
let shadeDiffuse = 0;
let shadeRim = 0;
let shadeGlint = 0;
function shadeBust(x: number, y: number, jaw: number) {
  const step = 0.007;
  const dx = (bustHeight(x + step, y, jaw) - bustHeight(x - step, y, jaw)) / (2 * step);
  const dy = (bustHeight(x, y + step, jaw) - bustHeight(x, y - step, jaw)) / (2 * step);
  const [nx, ny, nz] = normalize(-dx, -dy, 1);
  shadeDiffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  // Grazing surfaces facing the backlight catch a thin rim.
  shadeRim = (1 - nz) ** 2 * Math.max(0, nx * RIM_LIGHT[0] + ny * RIM_LIGHT[1]);
  shadeGlint = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) ** 28;
}

/** Tone of the last shaded point: key light, backlit rim and glints, 0..1. */
const litTone = () => clamp01(0.12 + 0.7 * shadeDiffuse ** 1.6 + 0.9 * shadeRim + 0.4 * shadeGlint);

/** The code visage is a machine face pressing out of the dark: only its plates catch the light
 * (brows, eye slits, nose, cheekbones, mouth); there is no outline, neck or shoulders. Face
 * units: u across and v down, about -1..1, with the face's half height per scale unit below. */
const VISAGE_HALF_HEIGHT = 0.95;
const VISAGE_ASPECT = 0.84;
/** Plate height and the width of its bevel, in face units. */
const PLATE = 0.06;
const PLATE_BEVEL = 0.028;

function tiltedBox(u: number, v: number, cu: number, cv: number, hu: number, hv: number, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const du = u - cu;
  const dv = v - cv;
  return box(c * du + s * dv, -s * du + c * dv, 0, 0, hu, hv);
}

function segment(u: number, v: number, u0: number, v0: number, u1: number, v1: number) {
  const pu = u1 - u0;
  const pv = v1 - v0;
  const t = clamp01(((u - u0) * pu + (v - v0) * pv) / (pu * pu + pv * pv));
  return Math.hypot(u - u0 - t * pu, v - v0 - t * pv);
}

/** 0 outside a shape, 1 once past its bevel. */
const plate = (distance: number, bevel = PLATE_BEVEL) => smoothstep(0, -bevel, distance);

/** Machine face at a point with the jaw dropped by `jaw` (0 closed, 1 open). Written to the
 * scratch values below to avoid allocation: surface height, how much of the point belongs to a
 * plate, and the light of the eyes and of the open mouth. */
let visageHeight = 0;
let visageCover = 0;
let visageEye = 0;
let visageMouth = 0;
function machineFace(u: number, v: number, jaw: number) {
  const au = Math.abs(u);
  // Brows slant down toward the nose, the eye slits follow them: a stern, watchful look.
  const brow = plate(tiltedBox(au, v, 0.34, -0.38, 0.26, 0.062, -0.2));
  const socket = plate(tiltedBox(au, v, 0.32, -0.2, 0.17, 0.06, -0.14) - 0.03, 0.05);
  const slit = tiltedBox(au, v, 0.32, -0.2, 0.125, 0.016, -0.14);
  // The nose: a ridge that widens and rises toward its base, with two small vents.
  const along = clamp01((v + 0.26) / 0.48);
  const noseWidth = 0.028 + 0.06 * along;
  const ridge = Math.max(au - noseWidth, Math.abs(v + 0.02) - 0.24);
  const nose = ridge < 0 ? (1 - au / noseWidth) * (0.45 + 0.55 * along) : 0;
  const noseBase = plate(tiltedBox(au, v, 0.06, 0.25, 0.07, 0.03, 0.25));
  const vents = plate(box(au, v, 0.055, 0.262, 0.022, 0.006), 0.008);
  const cheek = plate(tiltedBox(au, v, 0.47, 0.02, 0.16, 0.05, -0.3));
  // A seam runs from each cheekbone to the corner of the mouth.
  const seam = Math.exp(-((segment(au, v, 0.34, 0.08, 0.28, 0.5) / 0.008) ** 2));
  // The mouth: a slot under a lip plate; the lower plate and chin drop as it opens.
  const opening = 0.012 + 0.09 * jaw;
  const upperLip = plate(box(u, v, 0, 0.45, 0.25, 0.034));
  const slot = box(u, v, 0, 0.5 + opening / 2, 0.21, opening / 2);
  const lowerLip = plate(box(u, v, 0, 0.55 + opening, 0.21, 0.034));
  const chin = plate(box(u, v, 0, 0.68 + opening, 0.14, 0.05));
  const mouth = plate(slot, 0.008);
  // The shell of the face itself only shows faintly, so the plates sit on a face.
  const shell = smoothstep(0.04, -0.12, Math.hypot(u / 0.8, (v - 0.08) / 0.9) - 1);
  // A gentle curvature turns the plates away from the light toward the edges.
  const curve = -0.14 * (u * u * 0.9 + v * v * 0.35);
  visageHeight =
    curve +
    PLATE *
      (brow +
        0.65 * cheek +
        0.9 * nose +
        0.7 * noseBase +
        0.75 * upperLip +
        0.7 * lowerLip +
        0.55 * chin -
        0.8 * socket -
        0.6 * vents -
        0.35 * seam -
        1.2 * mouth);
  visageCover = Math.max(
    brow,
    cheek,
    Math.min(1, nose * 3),
    noseBase,
    upperLip,
    lowerLip,
    0.8 * chin,
    0.45 * socket,
    0.2 * shell,
  );
  visageEye = smoothstep(0.014, -0.006, slit) + 0.5 * Math.exp(-Math.max(0, slit) / 0.035) * socket;
  // Behind the slot a dim light shows through vertical vents.
  const vent = 0.5 + 0.5 * Math.cos((u / 0.05) * Math.PI * 2);
  visageMouth = mouth * clamp01(jaw * 2.2) * (0.45 + 0.55 * vent);
}

/** Lit tone of the machine face, 0..1, and whether the light is its own (eyes, mouth). */
let visageGlow = false;
function visageTone(u: number, v: number, jaw: number): number {
  const step = 0.008;
  machineFace(u + step, v, jaw);
  const right = visageHeight;
  machineFace(u - step, v, jaw);
  const left = visageHeight;
  machineFace(u, v + step, jaw);
  const down = visageHeight;
  machineFace(u, v - step, jaw);
  const up = visageHeight;
  machineFace(u, v, jaw);
  const [nx, ny, nz] = normalize(
    -(right - left) / (2 * step) / VISAGE_ASPECT,
    -(down - up) / (2 * step),
    1,
  );
  const lambert = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  const glint = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) ** 24;
  // Key light from the upper left: the far side of the face sinks into the dark.
  const side = clamp01(0.82 - 0.6 * u - 0.15 * v);
  const metal = visageCover * (0.06 + 0.94 * lambert ** 1.8 + 0.5 * glint) * side;
  const own = Math.max(visageEye, visageMouth);
  visageGlow = own > metal;
  // The face emerges from the dark: everything fades toward its edges.
  const emerge = smoothstep(1, 0.4, Math.hypot(u * 0.92, (v - 0.04) * 0.9));
  return clamp01(Math.max(metal, own)) * (visageGlow ? Math.max(emerge, 0.75) : emerge);
}

/** The serene face: the sculpted human face above, softly lit with its eyes closed, fading into
 * the dark at its edges. Two fine seams (across the brow, down one side) hint that it is a
 * machine without making it one. Face units: u across, v down, about -1..1. */
const SERENE_HALF_HEIGHT = 0.98;
const SERENE_ASPECT = 0.8;
/** Relief depth relative to the face's half width: shallow, like a softly modelled mask. */
const SERENE_DEPTH = 0.5;
/** The serene mouth only parts a little, as in quiet speech. */
const SERENE_JAW = 0.55;
/** Soft light, mostly from the front and a little from the upper left. */
const SERENE_LIGHT = normalize(-0.32, -0.42, 0.85);

/** Height of the serene face: a shallow dome carrying the full depth of the sculpted features. */
function sereneHeight(u: number, v: number, jaw: number): number {
  faceRelief(u, v, jaw);
  const au = Math.sqrt(u * u + 0.004);
  // Closed eyes: full lids that curve down to a soft crease, as on a resting statue.
  const across = au - 0.35;
  const crease = 0.035 - 0.9 * across * across;
  const lids =
    0.1 * bump(au, v, 0.35, -0.02, 0.13, 0.05) -
    0.07 * Math.exp(-(((v - crease) / 0.012) ** 2)) * smoothstep(0.16, 0.1, Math.abs(across));
  // The corners of the mouth lift a little: a quiet, kind expression.
  const smile = 0.04 * bump(au, v, 0.2, 0.6, 0.05, 0.04);
  return (
    0.45 * Math.sqrt(Math.max(0.0001, 1 - u * u - v * v)) +
    reliefRaised -
    reliefCavity +
    lids +
    smile
  );
}

/** Whether the last serene tone came from a seam, which glows in the accent color. */
let sereneSeam = false;
function sereneTone(u: number, v: number, jaw: number): number {
  const step = 0.01;
  const dx = (sereneHeight(u + step, v, jaw) - sereneHeight(u - step, v, jaw)) / (2 * step);
  const dy = (sereneHeight(u, v + step, jaw) - sereneHeight(u, v - step, jaw)) / (2 * step);
  const [nx, ny, nz] = normalize(-dx * SERENE_DEPTH, -dy * SERENE_DEPTH * SERENE_ASPECT, 1);
  const lambert = nx * SERENE_LIGHT[0] + ny * SERENE_LIGHT[1] + nz * SERENE_LIGHT[2];
  // Wrapped light: shadows roll off gently instead of cutting to black.
  const wrap = clamp01((lambert + 0.25) / 1.25);
  const glint = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]) ** 30;
  faceRelief(u, v, jaw);
  const occlusion = clamp01(1 - reliefCavity * 4);
  const side = clamp01(1 - 0.28 * u - 0.1 * v);
  const skin = (0.04 + 0.96 * wrap ** 4) * occlusion * side + 0.3 * glint;
  // The face surfaces from the dark: the crown and the sides dissolve before any outline shows.
  const lift = v - 0.12;
  const reach = Math.hypot(u, lift * (lift < 0 ? 1.15 : 0.9));
  const lit = skin * smoothstep(0.84, 0.28, reach);
  // Seams: a fine arc across the brow and a line from the temple down along the jaw.
  const brow = Math.abs(v + 0.34 - 0.25 * u * u) + Math.max(0, Math.abs(u) - 0.4);
  const flank = segment(u, v, 0.52, -0.22, 0.44, 0.46);
  const seam =
    0.55 * Math.exp(-((Math.min(brow, flank) / 0.014) ** 2)) * smoothstep(0.95, 0.5, reach);
  sereneSeam = seam > lit * 0.9;
  return clamp01(Math.max(lit, seam));
}

type Grid = {
  tier: number;
  font: number;
  stepX: number;
  stepY: number;
  left: number;
  top: number;
  cols: number;
  rows: number;
  firstColumn: number;
};

/**
 * A figure made of falling code. Nothing is drawn at rest: while the AI replies the figure
 * kindles from the head outward, streams fall through or behind it and the mouth moves with the
 * reply. When it ends the figure fades back into the plain background.
 */
function createCodeFigureScene(
  palette: LiveBackgroundPalette,
  style: FigureStyle,
): LiveBackgroundScene {
  const config = STYLES[style];
  let width = 0;
  let height = 0;
  const fonts = [MIN_FONT, MIN_FONT, MIN_FONT];
  const fontStrings = ["", "", ""];
  let columns: Column[] = [];
  // Flat per-cell arrays: the frame loop allocates nothing.
  let cellX = new Float32Array(0);
  let cellY = new Float32Array(0);
  let cellCol = new Uint16Array(0);
  let cellRow = new Uint16Array(0);
  let cellTier = new Uint8Array(0);
  /** Static glow with the jaw closed and fully open, and how much passing streams add. */
  let cellBody = new Float32Array(0);
  let cellBodyOpen = new Float32Array(0);
  let cellGain = new Float32Array(0);
  /** Body brighter than this is a highlight and burns in the accent color. */
  let cellSpark = new Float32Array(0);
  let cellPool = new Uint8Array(0);
  let cellReveal = new Float32Array(0);
  let cellGlow = new Float32Array(0);
  let cellAccent = new Uint8Array(0);
  let cellAlpha = new Float32Array(0);
  /** Brightness before presence and kindling, for styles that pick glyphs from a ramp. */
  let cellTone = new Float32Array(0);
  /** Draw order bucketed by pass and alpha level, rebuilt each frame without allocation. */
  let order = new Uint32Array(0);
  const bucketStart = new Uint32Array(GROUPS * (ALPHA_LEVELS + 1) + 1);
  const bucketFill = new Uint32Array(GROUPS * (ALPHA_LEVELS + 1));
  let cellBucket = new Uint16Array(0);
  let count = 0;
  /** Stream travel added by reply energy, so speed changes never make the streams jump. */
  let rush = 0;

  const push = (
    grid: Grid,
    col: number,
    row: number,
    body: number,
    bodyOpen: number,
    gain: number,
    spark: number,
    reveal: number,
    pool: number,
  ) => {
    cellX[count] = grid.left + (col + 0.5) * grid.stepX;
    cellY[count] = grid.top + (row + 0.5) * grid.stepY;
    cellCol[count] = grid.firstColumn + col;
    cellRow[count] = row;
    cellTier[count] = grid.tier;
    cellBody[count] = body;
    cellBodyOpen[count] = bodyOpen;
    cellGain[count] = gain;
    cellSpark[count] = spark;
    cellReveal[count] = reveal;
    cellPool[count] = pool;
    count++;
  };

  return {
    resize(nextWidth, nextHeight) {
      width = Math.max(0, nextWidth);
      height = Math.max(0, nextHeight);
      count = 0;
      columns = [];
      rush = 0;
      if (width < 2 || height < 2) return;

      // The head starts near the top and the shoulders leave through the bottom edge.
      const scale = Math.min(height / config.headShare, width / 1.6);
      const centerX = width / 2;
      const centerY = height * 0.08 + 0.96 * scale;
      const bottom = (height - centerY) / scale;
      const eclipse = style === "eclipse";
      const serene = style === "serene";
      // The machine face sits a little above the middle; face units map to pixels here.
      const faceHalfHeight = (serene ? SERENE_HALF_HEIGHT : VISAGE_HALF_HEIGHT) * scale;
      const faceHalfWidth = faceHalfHeight * (serene ? SERENE_ASPECT : VISAGE_ASPECT);
      const faceY = height * (serene ? 0.44 : 0.47);
      const toU = (px: number) => (px - centerX) / faceHalfWidth;
      const toV = (py: number) => (py - faceY) / faceHalfHeight;
      const toX = (px: number) => (px - centerX) / scale;
      const toY = (py: number) => (py - centerY) / scale;

      // Grid geometry first, so every per-cell array is allocated once.
      const grids: Grid[] = [];
      const addGrid = (
        tier: number,
        left: number,
        top: number,
        right: number,
        speed: number,
        trail: number,
        bottomEdge = height,
      ) => {
        left = Math.max(0, left);
        right = Math.min(width, right);
        top = Math.max(0, top);
        bottomEdge = Math.min(height, bottomEdge);
        const area = (right - left) * (bottomEdge - top);
        if (area <= 0) return;
        const [cellWidth, cellHeight] = tier === FIGURE ? config.figureCell : RAIN_CELL;
        const font = Math.max(
          MIN_FONT,
          scale * config.fontShare[tier]!,
          Math.sqrt(area / (config.maxCells[tier]! * cellWidth * cellHeight)),
        );
        const stepX = font * cellWidth;
        const stepY = font * cellHeight;
        const cols = Math.max(1, Math.floor((right - left) / stepX));
        const rows = Math.max(1, Math.floor((bottomEdge - top) / stepY));
        const grid: Grid = {
          tier,
          font,
          stepX,
          stepY,
          left: left + (right - left - cols * stepX) / 2,
          top,
          cols,
          rows,
          firstColumn: columns.length,
        };
        for (let col = 0; col < cols; col++) {
          const id = columns.length;
          const length = trail * (0.6 + hash(id, 11) * 0.9);
          const period = rows + length + Math.floor(hash(id, 13) * rows * 0.9);
          columns.push({
            speed: speed * (0.65 + hash(id, 17) * 0.7),
            offset: hash(id, 19) * period,
            trail: length,
            period,
          });
        }
        fonts[tier] = font;
        fontStrings[tier] =
          `${tier === FIGURE && eclipse ? "500 " : ""}${font}px ${palette.monoFont}`;
        grids.push(grid);
      };

      const figureLeft = centerX - 1.42 * scale;
      const figureRight = centerX + 1.42 * scale;
      const figureTop = centerY - 1.04 * scale;
      if (serene) {
        // Dust drifts slowly through the whole pane; the face has its own fine grid.
        addGrid(FAR, 0, 0, width, 2.2, 30);
        addGrid(
          FIGURE,
          centerX - 0.92 * faceHalfWidth,
          faceY - 0.78 * faceHalfHeight,
          centerX + 0.92 * faceHalfWidth,
          0,
          1,
          faceY + 1.05 * faceHalfHeight,
        );
      } else if (eclipse) {
        addGrid(FAR, 0, 0, width, 7, 22);
        addGrid(
          FIGURE,
          centerX - 0.86 * faceHalfWidth,
          faceY - 0.6 * faceHalfHeight,
          centerX + 0.86 * faceHalfWidth,
          0,
          1,
          faceY + 0.92 * faceHalfHeight,
        );
        addGrid(NEAR, 0, 0, width, 13, 14);
      } else {
        addGrid(FAR, centerX - 1.7 * scale, centerY - 1.4 * scale, centerX + 1.7 * scale, 6, 16);
        addGrid(FIGURE, figureLeft, figureTop, figureRight, 9, 18);
      }

      const capacity = grids.reduce((sum, grid) => sum + grid.cols * grid.rows, 0);
      cellX = new Float32Array(capacity);
      cellY = new Float32Array(capacity);
      cellCol = new Uint16Array(capacity);
      cellRow = new Uint16Array(capacity);
      cellTier = new Uint8Array(capacity);
      cellBody = new Float32Array(capacity);
      cellBodyOpen = new Float32Array(capacity);
      cellGain = new Float32Array(capacity);
      cellSpark = new Float32Array(capacity);
      cellPool = new Uint8Array(capacity);
      cellReveal = new Float32Array(capacity);
      cellGlow = new Float32Array(capacity);
      cellAccent = new Uint8Array(capacity);
      cellAlpha = new Float32Array(capacity);
      cellTone = new Float32Array(capacity);
      cellBucket = new Uint16Array(capacity);
      order = new Uint32Array(capacity);

      // Pane vignette for the eclipse field: light gathers behind the figure and falls off
      // toward the corners.
      const vignette = (px: number, py: number) =>
        smoothstep(
          1.08,
          0.3,
          Math.hypot((px - centerX) / (width * 0.62), (py - height * 0.42) / (height * 0.78)),
        );

      for (const grid of grids) {
        const { stepX, stepY } = grid;
        // Half a cell in scale units: glyphs closer than this to the outline would cross it.
        const halfCell = (0.5 * Math.hypot(stepX, stepY)) / scale;
        for (let row = 0; row < grid.rows; row++) {
          const py = grid.top + (row + 0.5) * stepY;
          const y = toY(py);
          const fade = smoothstep(bottom + 0.02, bottom - 0.42, y);
          for (let col = 0; col < grid.cols; col++) {
            const px = grid.left + (col + 0.5) * stepX;
            const x = toX(px);
            const distance = silhouetteDistance(x, y);
            const columnId = grid.firstColumn + col;
            // Kindling spreads from behind the head outward, scattered like embers catching.
            const radial = clamp01(Math.hypot(x, (y - HEAD_Y) * 0.9) / 1.5);
            const reveal = hash(columnId, row, 7) * 0.55 + radial * 0.45;

            if (serene) {
              const u = toU(px);
              const v = toV(py);
              // The face surfaces from its center outward, slowly and evenly.
              const wake = hash(columnId, row, 7) * 0.35 + clamp01(Math.hypot(u, v) / 1.4) * 0.65;
              if (grid.tier === FIGURE) {
                const closed = sereneTone(u, v, 0);
                const seam = sereneSeam;
                const open = sereneTone(u, v, SERENE_JAW);
                const tone = Math.max(closed, open);
                // Ordered dither: shadows thin out instead of filling with dim glyphs.
                if (tone < 0.07 + hash(columnId, row, 41) * 0.28) continue;
                const pool = 0;
                // Seams glow in the accent color; skin never does.
                push(grid, col, row, closed * 0.85, open * 0.85, 0, seam ? 0 : 2, wake * 0.8, pool);
                continue;
              }
              // Dust thins into darkness around the face and gathers faintly near it.
              const reach = Math.hypot(u * 0.9, v * 0.8);
              const hidden = smoothstep(1.25, 0.7, reach);
              const near = Math.exp(-Math.max(0, reach - 1) / 0.8);
              const gain = (0.1 + 0.3 * near) * vignette(px, py) * (1 - 0.95 * hidden);
              if (gain < 0.045 || hash(columnId, 31) > 0.55) continue;
              push(grid, col, row, 0, 0, gain, 2, wake, 0);
              continue;
            }

            if (eclipse) {
              const u = toU(px);
              const v = toV(py);
              // Plates kindle first, from the eyes outward, as if the machine were waking.
              const wake = hash(columnId, row, 7) * 0.5 + clamp01(Math.hypot(u, v + 0.2) / 1.6) * 0.5;
              if (grid.tier === FIGURE) {
                const closed = visageTone(u, v, 0);
                const closedGlow = visageGlow;
                const open = visageTone(u, v, 1);
                const openGlow = visageGlow && open > closed + 0.1;
                if (Math.max(closed, open) < 0.05) continue;
                // Ordered dither: shadowed metal thins out instead of filling with dim glyphs.
                if (Math.max(closed, open) < 0.04 + hash(columnId, row, 41) * 0.22) continue;
                // Own light (eyes, the open mouth) burns in the accent color, metal never does.
                const spark = closedGlow ? 0 : openGlow ? closed + 0.06 : 2;
                const tone = Math.max(closed, open);
                const pool = closedGlow || tone > 0.55 ? DENSE : tone > 0.22 ? 1 : 0;
                push(grid, col, row, closed * 0.9, open * 0.9, 0, spark, wake * 0.7, pool);
                continue;
              }
              // The rain thins into darkness around the face, so the face reads as coming out
              // of the dark rather than as a cut-out shape.
              const reach = Math.hypot(u * 0.86, v * 0.8);
              const hidden = smoothstep(1.3, 0.7, reach);
              const light = vignette(px, py) * (1 - 0.94 * hidden);
              // A little brighter just around the dark, as if light spilled past the face.
              const spill = 0.25 + 0.75 * Math.exp(-Math.max(0, reach - 1) / 0.6);
              if (grid.tier === NEAR) {
                // Only a few near streams, large and bright, give the field depth.
                if (hash(columnId, 29) > 0.3) continue;
                const gain = (0.3 + 0.5 * spill) * light;
                if (gain < 0.06) continue;
                push(grid, col, row, 0, 0, gain, 2, wake, CODE);
                continue;
              }
              const gain = (0.2 + 0.7 * spill) * light;
              if (gain < 0.05) continue;
              push(grid, col, row, 0, 0, gain, 2, wake, CODE);
              continue;
            }

            if (grid.tier === FAR) {
              // Faint rain gathers around the figure and thins with distance from it.
              if (distance < halfCell || distance > 0.6) continue;
              const gain = 0.4 * Math.exp(-distance / 0.2) * fade;
              if (gain < 0.045) continue;
              push(grid, col, row, 0, 0, gain, 2, reveal, CODE);
              continue;
            }

            // The luminous figure: a lit sculpture whose surface is code.
            if (distance > halfCell * 0.35) continue;
            const coverage = smoothstep(halfCell * 0.35, -halfCell * 0.6, distance);
            // The bust dissolves into its own falling streams toward the bottom and the sides.
            const solid = fade * smoothstep(1.2, 0.72, Math.abs(x));
            // Under the chin the neck falls into shadow, so the jaw line reads.
            const outsideHead = headDistance(x, y);
            const chin =
              outsideHead > 0 && y > HEAD_Y + 0.3
                ? 0.25 + 0.75 * smoothstep(0, 0.18, outsideHead)
                : 1;
            shadeBust(x, y, 0);
            const closed = chin * litTone();
            let open = closed;
            if (outsideHead < 0.02) {
              shadeBust(x, y, 1);
              open = chin * litTone();
            }
            // Ordered dither: shadows thin out instead of filling with dim glyphs.
            const lit = Math.max(closed, open) > hash(columnId, row, 41) * 0.22;
            // A settled glow carries the form; the streams falling through it carry the light.
            const body = lit ? coverage * solid * closed * 0.75 : 0;
            const bodyOpen = lit ? coverage * solid * open * 0.75 : 0;
            const gain = (0.4 + 0.6 * closed) * coverage * Math.max(0.3, fade);
            if (Math.max(body, bodyOpen) + gain < 0.04) continue;
            const pool = closed > 0.55 ? DENSE : closed > 0.22 ? 1 : 0;
            push(grid, col, row, body, bodyOpen, gain, 0.58, reveal, pool);
          }
        }
      }
    },
    draw(ctx, time, delta, signal) {
      ctx.clearRect(0, 0, width, height);
      const presence = clamp01(signal.presence);
      // At rest the pane is left exactly as it was: no figure, no residue.
      if (count === 0 || presence === 0) return;
      const energy = clamp01(signal.energy ?? 0);
      rush += Math.max(0, Math.min(delta, 0.1)) * energy * ENERGY_RUSH;
      const level = (0.35 + 0.65 * presence) * (0.9 + 0.1 * energy);
      const kindle = presence * 1.25;
      const mouth = mouthOpening(time, presence, energy);

      for (let i = 0; i < count; i++) {
        cellAlpha[i] = 0;
        cellGlow[i] = 0;
        cellAccent[i] = 0;
        const reveal = smoothstep(cellReveal[i]!, cellReveal[i]! + 0.2, kindle);
        if (reveal === 0) continue;
        const gain = cellGain[i]!;
        let stream = 0;
        if (gain > 0) {
          const column = columns[cellCol[i]!]!;
          const head = (column.offset + time * column.speed + rush) % column.period;
          stream = trailAt(head, cellRow[i]!, column.trail);
        }
        const body = cellBody[i]! + (cellBodyOpen[i]! - cellBody[i]!) * mouth;
        cellTone[i] = Math.min(1, body + gain * stream);
        cellAlpha[i] = reveal * level * cellTone[i]!;
        // Stream heads and the brightest highlights burn in the accent color.
        cellGlow[i] = stream;
        cellAccent[i] = stream > config.headGlow || body > cellSpark[i]! ? 1 : 0;
      }

      // Counting sort by pass and alpha level: one fill style and alpha change per bucket.
      const levels = ALPHA_LEVELS + 1;
      bucketFill.fill(0);
      for (let i = 0; i < count; i++) {
        const quantized = Math.round(cellAlpha[i]! * ALPHA_LEVELS);
        const group = cellTier[i]! * 2 + cellAccent[i]!;
        const bucket = quantized < MIN_LEVEL ? 0xffff : group * levels + quantized;
        cellBucket[i] = bucket;
        if (bucket !== 0xffff) bucketFill[bucket]!++;
      }
      bucketStart[0] = 0;
      for (let b = 0; b < GROUPS * levels; b++) {
        bucketStart[b + 1] = bucketStart[b]! + bucketFill[b]!;
        bucketFill[b] = bucketStart[b]!;
      }
      for (let i = 0; i < count; i++) {
        const bucket = cellBucket[i]!;
        if (bucket !== 0xffff) order[bucketFill[bucket]!++] = i;
      }

      const ramp = config.ramp;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Back to front: far rain, the figure, near rain; each in the content color, then its
      // heads and highlights in the accent color.
      for (let group = 0; group < GROUPS; group++) {
        if (bucketStart[group * levels] === bucketStart[(group + 1) * levels]) continue;
        const tier = group >> 1;
        ctx.font = fontStrings[tier]!;
        ctx.fillStyle = group % 2 === 1 ? palette.accent : palette.content;
        for (let quantized = MIN_LEVEL; quantized < levels; quantized++) {
          const bucket = group * levels + quantized;
          const from = bucketStart[bucket]!;
          const to = bucketStart[bucket + 1]!;
          if (from === to) continue;
          ctx.globalAlpha = quantized / ALPHA_LEVELS;
          for (let k = from; k < to; k++) {
            const i = order[k]!;
            const col = cellCol[i]!;
            const row = cellRow[i]!;
            // Heads mutate fast, the settled body slowly, like code being rewritten.
            if (ramp) {
              const step = Math.min(ramp.length - 1, Math.floor(cellTone[i]! * ramp.length));
              ctx.fillText(ramp[step]!, cellX[i]!, cellY[i]!);
              continue;
            }
            const glow = cellGlow[i]!;
            const rate = config.mutation * (0.25 + hash(col, row, 3) * 0.8 + glow * 9);
            const [start, length] = POOLS[glow > config.headGlow ? DENSE : cellPool[i]!]!;
            const index = start + Math.floor(hash(col, row, Math.floor(time * rate)) * length);
            ctx.fillText(GLYPHS[index]!, cellX[i]!, cellY[i]!);
          }
        }
      }
      ctx.restore();
    },
  };
}

/** A luminous figure of code: a lit sculpture whose surface is falling code, condensing out of
 * faint rain while the AI replies. */
export function createLatentFaceScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  return createCodeFigureScene(palette, "luminous");
}

/** A machine face emerging from the dark inside layered code rain: only its brows, eyes, nose,
 * cheekbones and mouth catch the light, and the mouth opens and glows with the reply. */
export function createCodeVisageScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  return createCodeFigureScene(palette, "eclipse");
}

/** A calm, softly lit face with closed eyes, surfacing from the dark among slowly drifting dust
 * while the AI replies; its lips part gently with the reply. */
export function createSereneFaceScene(palette: LiveBackgroundPalette): LiveBackgroundScene {
  return createCodeFigureScene(palette, "serene");
}
