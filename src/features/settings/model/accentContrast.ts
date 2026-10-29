/**
 * WCAG contrast derivation for the user's accent colour.
 *
 * The stored accent is never rewritten, and the solid action fill always is the
 * saved colour: these functions pick the ink by measured contrast. Only the text
 * selection fill (a separate role) is pulled to a rendered tone of the same hue
 * when that is needed to reach the requested level.
 *
 * Roles that must stay separate:
 * - solid accent: filled actions (saved colour + measured ink + hover/pressed)
 * - text selection: opaque range fill + ink (`selection.dark` / `selection.light`)
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

/** Canvas luminance when the real theme canvas is unknown (default dark / light tint). */
const DEFAULT_CANVAS: AccentCanvas = {
  dark: themePalette.hex171717,
  light: themePalette.hexfafafa,
};
/** Non-text contrast (WCAG 1.4.11): the lowest ratio a selected range should keep against its canvas. */
const SELECTION_VISIBILITY_RATIO = 3;
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

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parse(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  }) as Channels;
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

/**
 * Smallest step towards black or white that puts the luminance inside
 * [minimum, maximum]. The result is checked after rounding to 8-bit channels.
 */
function constrainLuminance(hex: string, minimum: number, maximum: number): string {
  const luminance = relativeLuminance(hex);
  if (luminance >= minimum && luminance <= maximum) return hex;
  const lighten = luminance < minimum;
  const toward = lighten ? ACCENT_INK_LIGHT : ACCENT_INK_DARK;
  for (let step = 1; step <= 200; step++) {
    const candidate = mix(hex, toward, step / 200);
    const next = relativeLuminance(candidate);
    if (next >= minimum && next <= maximum) return candidate;
  }
  return toward;
}

/** Luminance bounds a background needs for `ink` to reach `target`. */
function inkBounds(ink: string, target: number): [number, number] {
  return ink === ACCENT_INK_LIGHT
    ? [0, (1 + 0.05) / target - 0.05]
    : [target * 0.05 - 0.05, 1];
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

/**
 * Opaque selection fill per colour scheme. The ink is fixed by the scheme
 * (white on dark, black on light) so selected text keeps the polarity of the
 * text around it; the fill is the accent pulled into the band where that ink
 * reaches the target. Visibility against the real canvas (3:1) is honoured as
 * far as the text target allows: readable text wins when the two conflict.
 */
export function selectionAccentPair(
  accent: string,
  scheme: "dark" | "light",
  readability: AccentReadability,
  canvas: AccentCanvas = DEFAULT_CANVAS,
): AccentPair {
  const target = ACCENT_CONTRAST_TARGET[readability];
  const ink = scheme === "dark" ? ACCENT_INK_LIGHT : ACCENT_INK_DARK;
  const [inkMin, inkMax] = inkBounds(ink, target);
  const canvasLuminance = relativeLuminance(canvas[scheme]);
  const [visibleMin, visibleMax] =
    scheme === "dark"
      ? [(canvasLuminance + 0.05) * SELECTION_VISIBILITY_RATIO - 0.05, 1]
      : [0, (canvasLuminance + 0.05) / SELECTION_VISIBILITY_RATIO - 0.05];
  let minimum = Math.max(inkMin, visibleMin);
  let maximum = Math.min(inkMax, visibleMax);
  if (minimum > maximum) {
    // Text contrast wins: stay inside the ink band, as close to the visible band as it allows.
    [minimum, maximum] =
      scheme === "dark" ? [Math.max(inkMin, inkMax - 0.02), inkMax] : [inkMin, Math.min(inkMax, inkMin + 0.02)];
  }
  return pair(constrainLuminance(accent, minimum, maximum), ink);
}

export type AccentRoles = {
  solid: SolidAccent;
  selection: { dark: AccentPair; light: AccentPair };
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
    },
  };
}
