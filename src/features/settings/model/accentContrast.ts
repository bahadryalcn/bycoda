/**
 * WCAG contrast derivation for the user's accent colour.
 *
 * The stored accent is never rewritten, and the solid action fill always is the
 * saved colour: these functions pick the ink by measured contrast. Only the text
 * selection fill (a separate role) is moved to a rendered tone of the same hue
 * when that is needed to reach the requested level.
 *
 * Roles that must stay separate:
 * - solid accent: filled actions (saved colour + measured ink + hover/pressed)
 * - text selection: opaque range fill + ink (`selection.dark` / `selection.light`); every
 *   selection renderer (DOM, CodeMirror, xterm) consumes this one pair
 * - paper selection: the same idea for content painted on a white page whose glyph ink cannot
 *   change (PDF canvases); the ink is always the dark glyph colour (`selection.paper`)
 * - accent tint and accent text: derived in CSS from the stored accent and
 *   `data-accent-readability`; they never use the solid foreground.
 */

import { themePalette } from "../../../shared/theme/palette";

export type AccentReadability = "auto" | "strong";

export const ACCENT_READABILITY_DEFAULT: AccentReadability = "auto";

export const ACCENT_READABILITY_OPTIONS: readonly AccentReadability[] = ["auto", "strong"];

/** Minimum WCAG 2.x text contrast the rendered pair must reach. */
export const ACCENT_CONTRAST_TARGET: Record<AccentReadability, number> = {
  auto: 4.5,
  strong: 7,
};

export const ACCENT_INK_LIGHT: string = themePalette.solidInk;
export const ACCENT_INK_DARK: string = themePalette.scrim;

/** The white page PDF glyphs are painted on, in both colour schemes. */
export const PAPER_CANVAS: string = themePalette.solidInk;

/** Canvas luminance when the real theme canvas is unknown (default dark / light tint). */
const DEFAULT_CANVAS: AccentCanvas = {
  dark: themePalette.hex171717,
  light: themePalette.hexfafafa,
};
/** Non-text contrast (WCAG 1.4.11): the lowest ratio a selected range should keep against its canvas. */
const SELECTION_VISIBILITY_RATIO = 3;
/** Keeps a band edge off the exact threshold so 8-bit rounding cannot land under it. */
const RATIO_MARGIN = 0.004;
/**
 * The scheme ink (white on dark, black on light) keeps the polarity of the surrounding text, so
 * it wins unless the opposite ink leaves the saved accent at least this much OKLCH lightness
 * closer to itself (a pale accent on a dark canvas keeps its colour under dark ink).
 */
const INK_FLIP_ADVANTAGE = 0.15;
/** Luminance slack (about two 8-bit steps) a fallback fill may sit from its canvas-separation edge. */
const FALLBACK_WINDOW = 0.008;
/** Solid hover and pressed move the fill this far away from its ink, so contrast only rises. */
const SOLID_HOVER_MIX = 0.08;
const SOLID_PRESSED_MIX = 0.14;

export function isAccentReadability(value: unknown): value is AccentReadability {
  return value === "auto" || value === "strong";
}

type Channels = [number, number, number];

function parse(hex: string): Channels {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as Channels;
}

function format(channels: Channels): string {
  return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function toLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function fromLinear(value: number): number {
  const channel = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, channel)) * 255;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parse(hex).map(toLinear) as Channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mix(hex: string, toward: string, amount: number): string {
  const from = parse(hex);
  const to = parse(toward);
  return format(from.map((value, index) => value + (to[index] - value) * amount) as Channels);
}

/** Smallest step towards black or white (sRGB mix) that puts the luminance inside [minimum, maximum]. */
function constrainLuminanceByMix(hex: string, minimum: number, maximum: number): string {
  const luminance = relativeLuminance(hex);
  if (luminance >= minimum && luminance <= maximum) return hex;
  const toward = luminance < minimum ? ACCENT_INK_LIGHT : ACCENT_INK_DARK;
  for (let step = 1; step <= 200; step++) {
    const candidate = mix(hex, toward, step / 200);
    const next = relativeLuminance(candidate);
    if (next >= minimum && next <= maximum) return candidate;
  }
  return toward;
}

type Oklch = { lightness: number; chroma: number; hue: number };

function toOklch(hex: string): Oklch {
  const [r, g, b] = parse(hex).map(toLinear) as Channels;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const c = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    chroma: Math.hypot(a, c),
    hue: Math.atan2(c, a),
  };
}

function oklchToLinear({ lightness, chroma, hue }: Oklch): Channels {
  const a = chroma * Math.cos(hue);
  const c = chroma * Math.sin(hue);
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * c, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * c, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * c, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** `color-mix(in oklab, toward amount, from)`: the CSS surface formulas, mirrored for canvas derivation. */
export function mixInOklab(from: string, toward: string, amount: number): string {
  const a = toOklch(from);
  const b = toOklch(toward);
  const lab = (color: Oklch) => [
    color.lightness,
    color.chroma * Math.cos(color.hue),
    color.chroma * Math.sin(color.hue),
  ];
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  const lightness = l1 + (l2 - l1) * amount;
  const x = a1 + (a2 - a1) * amount;
  const y = b1 + (b2 - b1) * amount;
  return format(
    oklchToLinear({ lightness, chroma: Math.hypot(x, y), hue: Math.atan2(y, x) }).map(
      fromLinear,
    ) as Channels,
  );
}

/** The colour at this lightness and hue with as much of `chroma` as the sRGB gamut holds. */
function renderOklch(lightness: number, chroma: number, hue: number): string {
  let current = chroma;
  for (let attempt = 0; attempt < 48; attempt++) {
    const linear = oklchToLinear({ lightness, chroma: current, hue });
    if (linear.every((value) => value >= -0.0005 && value <= 1.0005)) {
      return format(linear.map(fromLinear) as Channels);
    }
    current *= 0.93;
  }
  return format(oklchToLinear({ lightness, chroma: 0, hue }).map(fromLinear) as Channels);
}

/**
 * Moves the colour along OKLCH lightness only, keeping its hue and as much of its chroma as the
 * gamut allows, until its WCAG luminance sits inside [minimum, maximum]. Mixing towards black or
 * white in sRGB drains chroma (a pale amber turns into grey-khaki); this keeps a saturated
 * mustard instead. The result is checked after rounding to 8-bit channels.
 */
function constrainLuminance(hex: string, minimum: number, maximum: number): string {
  const luminance = relativeLuminance(hex);
  if (luminance >= minimum && luminance <= maximum) return hex;
  const origin = toOklch(hex);
  const direction = luminance < minimum ? 1 : -1;
  for (let step = 1; step <= 500; step++) {
    const lightness = origin.lightness + direction * step * 0.002;
    if (lightness < 0 || lightness > 1) break;
    const candidate = renderOklch(lightness, origin.chroma, origin.hue);
    const next = relativeLuminance(candidate);
    if (next >= minimum && next <= maximum) return candidate;
  }
  return constrainLuminanceByMix(hex, minimum, maximum);
}

/** OKLCH lightness distance between two colours: how far the saved accent had to move. */
function lightnessShift(from: string, to: string): number {
  return Math.abs(toOklch(from).lightness - toOklch(to).lightness);
}

/** Luminance bounds a background needs for `ink` to reach `target`. */
function inkBounds(ink: string, target: number): [number, number] {
  const strict = target + RATIO_MARGIN;
  return ink === ACCENT_INK_LIGHT ? [0, (1 + 0.05) / strict - 0.05] : [strict * 0.05 - 0.05, 1];
}

export type AccentPair = { background: string; foreground: string; ratio: number };

function pair(background: string, foreground: string): AccentPair {
  return { background, foreground, ratio: contrastRatio(background, foreground) };
}

export type SolidAccent = AccentPair & { hover: string; pressed: string };

/** A step away from the ink raises contrast; when the fill is already at that end, step into it
 *  only as far as the target still holds. */
function solidState(fill: string, ink: string, amount: number, target: number): string {
  const away = ink === ACCENT_INK_LIGHT ? ACCENT_INK_DARK : ACCENT_INK_LIGHT;
  const moved = mix(fill, away, amount);
  if (moved !== fill) return moved;
  const into = mix(fill, ink, amount);
  return contrastRatio(into, ink) >= target ? into : fill;
}

/**
 * Solid action fill and ink. The fill is ALWAYS the saved accent: the colour is
 * never recoloured to meet a level. Only the ink is chosen, by measured contrast
 * (the better of pure white and pure black). `strong` therefore changes the
 * selection pair and accent text strength, not the solid fill; for mid-tone
 * accents the best ink may land below 7:1, and `ratio` reports what was reached.
 */
export function solidAccentPair(accent: string, readability: AccentReadability): SolidAccent {
  const light = contrastRatio(accent, ACCENT_INK_LIGHT);
  const dark = contrastRatio(accent, ACCENT_INK_DARK);
  const ink = light >= dark ? ACCENT_INK_LIGHT : ACCENT_INK_DARK;
  const target = ACCENT_CONTRAST_TARGET[readability];
  return {
    ...pair(accent, ink),
    hover: solidState(accent, ink, SOLID_HOVER_MIX, target),
    pressed: solidState(accent, ink, SOLID_PRESSED_MIX, target),
  };
}

export type AccentCanvas = { dark: string; light: string };

type SelectionCandidate = { pair: AccentPair; shift: number };

function selectionCandidate(
  accent: string,
  ink: string,
  target: number,
  visible: [number, number],
): SelectionCandidate | null {
  const [inkMin, inkMax] = inkBounds(ink, target);
  const minimum = Math.max(inkMin, visible[0]);
  const maximum = Math.min(inkMax, visible[1]);
  if (minimum > maximum) return null;
  const background = constrainLuminance(accent, minimum, maximum);
  return { pair: pair(background, ink), shift: lightnessShift(accent, background) };
}

/**
 * Opaque selection fill and ink for one canvas. Both conditions are met together whenever any
 * colour can meet them: the ink reaches the readability target against the fill (WCAG text) and
 * the fill keeps 3:1 against the canvas (WCAG non-text), so the range is readable and visible.
 * The fill is the saved accent moved along OKLCH lightness only (hue and chroma stay).
 *
 * The first ink (the scheme ink: white on dark, black on light) cannot satisfy both at every
 * level: white ink at 7:1 needs a fill darker than 3:1 allows on a dark canvas, and a pale
 * accent would have to be darkened into mustard. A later ink is used when it satisfies both and
 * leaves the accent clearly closer to its saved colour. When no ink can meet both (a locked
 * dark ink on a white page at the strong level), text contrast wins and the fill sits at the
 * canvas-separation edge the text band allows.
 */
function selectionPair(
  accent: string,
  direction: "lighter" | "darker",
  readability: AccentReadability,
  canvas: string,
  inks: readonly string[],
): AccentPair {
  const target = ACCENT_CONTRAST_TARGET[readability];
  const canvasLuminance = relativeLuminance(canvas);
  const visible: [number, number] =
    direction === "lighter"
      ? [(canvasLuminance + 0.05) * SELECTION_VISIBILITY_RATIO - 0.05, 1]
      : [0, (canvasLuminance + 0.05) / SELECTION_VISIBILITY_RATIO - 0.05];
  const [primary, ...others] = inks;
  let best = selectionCandidate(accent, primary, target, visible);
  for (const ink of others) {
    const candidate = selectionCandidate(accent, ink, target, visible);
    if (candidate && (!best || candidate.shift + INK_FLIP_ADVANTAGE < best.shift)) best = candidate;
  }
  if (best) return best.pair;
  // No ink satisfies both: stay inside the primary ink's text band, as close to the canvas
  // separation edge as that band allows.
  const [inkMin, inkMax] = inkBounds(primary, target);
  const edge = Math.min(
    inkMax,
    Math.max(inkMin, direction === "lighter" ? visible[0] : visible[1]),
  );
  const [minimum, maximum] =
    direction === "lighter"
      ? [Math.max(inkMin, edge - FALLBACK_WINDOW), edge]
      : [edge, Math.min(inkMax, edge + FALLBACK_WINDOW)];
  return pair(constrainLuminance(accent, minimum, maximum), primary);
}

export function selectionAccentPair(
  accent: string,
  scheme: "dark" | "light",
  readability: AccentReadability,
  canvas: AccentCanvas = DEFAULT_CANVAS,
): AccentPair {
  return selectionPair(
    accent,
    scheme === "dark" ? "lighter" : "darker",
    readability,
    canvas[scheme],
    scheme === "dark" ? [ACCENT_INK_LIGHT, ACCENT_INK_DARK] : [ACCENT_INK_DARK, ACCENT_INK_LIGHT],
  );
}

/**
 * Selection over content painted on a white page (PDF): the glyphs are canvas pixels, so the
 * ink is their dark colour and is never flipped. The fill is multiplied onto the page.
 */
export function paperSelectionPair(accent: string, readability: AccentReadability): AccentPair {
  return selectionPair(accent, "darker", readability, PAPER_CANVAS, [ACCENT_INK_DARK]);
}

export type AccentRoles = {
  solid: SolidAccent;
  selection: { dark: AccentPair; light: AccentPair; paper: AccentPair };
};

export function deriveAccentRoles(
  accent: string,
  readability: AccentReadability,
  canvas?: AccentCanvas,
): AccentRoles {
  return {
    solid: solidAccentPair(accent, readability),
    selection: {
      dark: selectionAccentPair(accent, "dark", readability, canvas),
      light: selectionAccentPair(accent, "light", readability, canvas),
      paper: paperSelectionPair(accent, readability),
    },
  };
}
