import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { themePalette } from "../../../shared/theme/palette";
import { ACCENT_CONTRAST_TARGET, solidAccentPair } from "./accentContrast";
import {
  sanitizeBackgroundGradient,
  type BackgroundGradientSuggestion,
} from "./backgroundGradient";
import { CODE_FONT_CATALOG, INTERFACE_FONT_CATALOG, findFont } from "./fontCatalog";
import {
  THEME_FIELD_GROUPS,
  sanitizeThemeGroup,
  type ThemeBackground,
  type ThemeImage,
  type ThemeInterface,
  type ThemeMotion,
  type ThemeTypography,
} from "./themeSuggestionFields";
import {
  APPEARANCE_RANGES,
  THEME_HUE_MAX,
  THEME_HUE_MIN,
  THEME_SATURATION_MIN,
} from "./themeRanges";

export const THEME_SUGGESTION_SCHEMES = ["light", "dark"] as const;
export const THEME_SUGGESTION_CANVASES = ["pure", "tinted"] as const;
export const THEME_SUGGESTION_CODE_THEMES = ["github", "dracula"] as const;
export const THEME_SUGGESTION_DENSITIES = ["compact", "comfortable", "touch"] as const;
/** Same range as the dark-lightness slider (THEME_DARK_LIGHTNESS_MIN/MAX in appearance.ts). */
export const THEME_SUGGESTION_DARK_LIGHTNESS_MAX = APPEARANCE_RANGES.darkLightness.max;
export const THEME_SUGGESTION_IMAGE_PROMPT_MAX = 400;

/**
 * One generated theme: the surface tint (hue, saturation) and the accent it pairs with. The other
 * fields are optional Appearance changes; a missing field leaves that setting as it is.
 */
export type ThemeSuggestion = {
  name: string;
  hue: number;
  saturation: number;
  accent: string;
  scheme?: (typeof THEME_SUGGESTION_SCHEMES)[number];
  darkLightness?: number;
  canvas?: (typeof THEME_SUGGESTION_CANVASES)[number];
  gradient?: BackgroundGradientSuggestion;
  interfaceFont?: string;
  codeFont?: string;
  codeTheme?: (typeof THEME_SUGGESTION_CODE_THEMES)[number];
  density?: (typeof THEME_SUGGESTION_DENSITIES)[number];
  /** Code size, ligatures and the terminal's font, size, weight and line height. */
  typography?: ThemeTypography;
  /** Interface scale, contrast, diff colors, row display, scrollbars, hover tint, working rows. */
  interface?: ThemeInterface;
  /** Pane opacity and blur, glass, live scene and the new-thread effect. */
  background?: ThemeBackground;
  /** How a background image is shown: scope, opacity per view and blur. */
  image?: ThemeImage;
  /** Agent crew theme and the decorative and tab animations. */
  motion?: ThemeMotion;
  /** Scene description for a matching background image; only used when the owner asks for one. */
  imagePrompt?: string;
};

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Optional fields that pass validation; invalid ones are dropped instead of failing the theme. */
function optionalThemeFields(value: Record<string, unknown>): Partial<ThemeSuggestion> {
  const fields: Partial<ThemeSuggestion> = {
    scheme: oneOf(THEME_SUGGESTION_SCHEMES, value.scheme),
    canvas: oneOf(THEME_SUGGESTION_CANVASES, value.canvas),
    codeTheme: oneOf(THEME_SUGGESTION_CODE_THEMES, value.codeTheme),
    density: oneOf(THEME_SUGGESTION_DENSITIES, value.density),
  };
  if (typeof value.darkLightness === "number" && Number.isFinite(value.darkLightness))
    fields.darkLightness = clamp(
      Math.round(value.darkLightness),
      APPEARANCE_RANGES.darkLightness.min,
      THEME_SUGGESTION_DARK_LIGHTNESS_MAX,
    );
  const gradient = value.gradient === undefined ? null : sanitizeBackgroundGradient(value.gradient);
  if (gradient) fields.gradient = gradient;
  if (
    typeof value.interfaceFont === "string" &&
    findFont(INTERFACE_FONT_CATALOG, value.interfaceFont)
  )
    fields.interfaceFont = value.interfaceFont;
  if (typeof value.codeFont === "string" && findFont(CODE_FONT_CATALOG, value.codeFont))
    fields.codeFont = value.codeFont;
  for (const group of THEME_FIELD_GROUPS) {
    const kept = sanitizeThemeGroup(group, value[group]);
    if (kept) Object.assign(fields, { [group]: kept });
  }
  const imagePrompt =
    typeof value.imagePrompt === "string" ? value.imagePrompt.replace(/\s+/g, " ").trim() : "";
  if (imagePrompt)
    fields.imagePrompt = truncateGraphemes(imagePrompt, THEME_SUGGESTION_IMAGE_PROMPT_MAX);
  return Object.fromEntries(
    Object.entries(fields).filter(([, entry]) => entry !== undefined),
  ) as Partial<ThemeSuggestion>;
}

export const THEME_SUGGESTION_COUNT = 3;
/** Generated tints stay muted; the tone slider can still go higher by hand. */
export const THEME_SUGGESTION_SATURATION_MAX = 60;
export const THEME_SUGGESTION_NAME_MAX = 40;
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;
const RANDOM_NAMES = [
  "Dusk",
  "Ember",
  "Tide",
  "Fern",
  "Slate",
  "Bloom",
  "Nocturne",
  "Dune",
  "Frost",
  "Cinder",
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function rgbOf(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** HSL (degrees, percent, percent) to a lowercase `#rrggbb`. */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** The accent that pairs with a tint: a vivid mid-tone of the same hue. */
export function accentForHue(hue: number): string {
  return hslToHex(hue, 80, 58);
}

/**
 * Keeps the accent's hue and saturation and moves only its lightness until the solid action pair
 * meets the existing accent contrast target. Returns the first passing shade, nearest the input.
 */
export function ensureAccentContrast(accent: string): string {
  const target = ACCENT_CONTRAST_TARGET.auto;
  if (solidAccentPair(accent, "auto").ratio >= target) return accent;
  const { hue, saturation, lightness } = hslOf(accent);
  for (let step = 1; step <= 100; step++) {
    for (const candidate of [lightness + step, lightness - step]) {
      if (candidate < 0 || candidate > 100) continue;
      const next = hslToHex(hue, saturation, candidate);
      if (solidAccentPair(next, "auto").ratio >= target) return next;
    }
  }
  const ink = themePalette.solidInk;
  return solidAccentPair(ink, "auto").ratio >= target ? ink : themePalette.scrim;
}

/** `#rrggbb` to HSL (degrees, percent, percent). */
function hslOf(hex: string): {
  hue: number;
  saturation: number;
  lightness: number;
} {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = ((max + min) / 2) * 100;
  const d = max - min;
  if (d === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = (d / (1 - Math.abs(2 * (lightness / 100) - 1))) * 100;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, saturation, lightness };
}

/** Validates one model or client entry; `null` drops it. Numbers are clamped, text is cut. */
export function normalizeThemeSuggestion(input: unknown): ThemeSuggestion | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const { hue, saturation, accent } = value;
  if (!name || typeof hue !== "number" || !Number.isFinite(hue)) return null;
  if (typeof saturation !== "number" || !Number.isFinite(saturation)) return null;
  if (typeof accent !== "string" || !ACCENT_PATTERN.test(accent)) return null;
  return {
    name: truncateGraphemes(name, THEME_SUGGESTION_NAME_MAX),
    hue: clamp(Math.round(hue), THEME_HUE_MIN, THEME_HUE_MAX),
    saturation: clamp(
      Math.round(saturation),
      THEME_SATURATION_MIN,
      THEME_SUGGESTION_SATURATION_MAX,
    ),
    accent: accent.toLowerCase(),
    ...optionalThemeFields(value),
  };
}

/** Accepts `[...]` or `{ "suggestions": [...] }`, keeps valid entries, at most three. */
export function parseThemeSuggestions(input: unknown): ThemeSuggestion[] {
  const list = Array.isArray(input)
    ? input
    : input &&
        typeof input === "object" &&
        Array.isArray((input as { suggestions?: unknown }).suggestions)
      ? (input as { suggestions: unknown[] }).suggestions
      : [];
  return list
    .map(normalizeThemeSuggestion)
    .filter((entry): entry is ThemeSuggestion => entry !== null)
    .slice(0, THEME_SUGGESTION_COUNT);
}

/**
 * Three suggestions with hues spread about the colour wheel, muted saturation (10 to 40) and an
 * accent derived from each hue. `random` is injectable so the spread is testable.
 */
export function randomThemeSuggestions(random: () => number = Math.random): ThemeSuggestion[] {
  const base = Math.floor(random() * 360);
  return Array.from({ length: THEME_SUGGESTION_COUNT }, (_, index) => {
    const hue = (base + index * (360 / THEME_SUGGESTION_COUNT)) % 360;
    return {
      name: RANDOM_NAMES[Math.floor(random() * RANDOM_NAMES.length)] ?? RANDOM_NAMES[0]!,
      hue: Math.round(hue),
      saturation: 10 + Math.floor(random() * 31),
      accent: ensureAccentContrast(accentForHue(hue)),
    };
  });
}

/** The four swatch colours a suggestion previews: canvas, surface, line and accent. */
export function suggestionSwatches(suggestion: ThemeSuggestion): [string, string, string, string] {
  const s = suggestion.saturation;
  return [
    hslToHex(suggestion.hue, s * 0.6, 4),
    hslToHex(suggestion.hue, s * 0.7, 9),
    hslToHex(suggestion.hue, s * 0.7, 18),
    suggestion.accent,
  ];
}

/** The Appearance tabs a suggestion changes, in tab order; tint and accent always change Theme. */
export type ThemeSuggestionArea = "theme" | "typography" | "interface" | "background" | "motion";

export function suggestionAreas(suggestion: ThemeSuggestion): ThemeSuggestionArea[] {
  const areas: ThemeSuggestionArea[] = ["theme"];
  if (
    suggestion.interfaceFont ||
    suggestion.codeFont ||
    suggestion.codeTheme ||
    suggestion.typography
  )
    areas.push("typography");
  if (suggestion.density || suggestion.interface) areas.push("interface");
  if (suggestion.gradient || suggestion.background || suggestion.image) areas.push("background");
  if (suggestion.motion) areas.push("motion");
  return areas;
}
