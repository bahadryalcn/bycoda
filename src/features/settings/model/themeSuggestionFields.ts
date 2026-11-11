import { CODE_FONT_CATALOG, findFont } from "./fontCatalog";
import { APPEARANCE_CHOICES as CHOICES, APPEARANCE_RANGES as RANGES } from "./themeRanges";

/**
 * The Appearance settings beyond tint, accent, scheme, canvas and fonts that a generated theme may
 * set, grouped like the Appearance tabs. Each spec reads its bounds and choices from
 * `themeRanges.ts`, the same source the settings models use. This file stays free of UI and storage
 * imports so the Host can validate and describe the fields.
 */
type NumberSpec = { kind: "number"; min: number; max: number };
type ChoiceSpec<T extends string | number> = {
  kind: "choice";
  values: readonly T[];
};
type FlagSpec = { kind: "flag" };
type FontSpec = { kind: "font" };
type FieldSpec = NumberSpec | ChoiceSpec<string | number> | FlagSpec | FontSpec;

type FieldValue<S> = S extends NumberSpec
  ? number
  : S extends FlagSpec
    ? boolean
    : S extends FontSpec
      ? string
      : S extends ChoiceSpec<infer T>
        ? T
        : never;
type GroupValues<G> = { [K in keyof G]?: FieldValue<G[K]> };

const number = (min: number, max: number): NumberSpec => ({
  kind: "number",
  min,
  max,
});
const choice = <T extends string | number>(values: readonly T[]): ChoiceSpec<T> => ({
  kind: "choice",
  values,
});
const flag: FlagSpec = { kind: "flag" };
const font: FontSpec = { kind: "font" };
const percent = (range: { min: number; max: number }, floor = 0, cap = 1) =>
  number(Math.round(Math.max(range.min, floor) * 100), Math.round(Math.min(range.max, cap) * 100));

/** Limits a generated theme keeps tighter than the sliders, so no theme makes the app unreadable. */
export const THEME_SUGGESTION_GUARDS = {
  contrastMin: 100,
  paneOpacityMin: 0.7,
  uiScaleMin: 0.8,
  uiScaleMax: 1.5,
  terminalSizeGap: 2,
} as const;

export const THEME_FIELD_SPECS = {
  typography: {
    codeSize: number(RANGES.codeSize.min, RANGES.codeSize.max),
    ligatures: flag,
    terminalFont: font,
    terminalSize: number(RANGES.codeSize.min, RANGES.codeSize.max),
    terminalWeight: choice(CHOICES.terminalWeight),
    terminalLineHeight: choice(CHOICES.terminalLineHeight),
  },
  interface: {
    uiScale: percent(
      RANGES.uiScale,
      THEME_SUGGESTION_GUARDS.uiScaleMin,
      THEME_SUGGESTION_GUARDS.uiScaleMax,
    ),
    contrast: number(
      Math.max(RANGES.contrast.min, THEME_SUGGESTION_GUARDS.contrastMin),
      RANGES.contrast.max,
    ),
    surfaceContrast: number(RANGES.surfaceContrast.min, RANGES.surfaceContrast.max),
    // Only ever raises the accent contrast target; the default "auto" is never lowered.
    accentReadability: choice(["strong"] as const),
    diffPalette: choice(CHOICES.diffPalette),
    rowDensity: choice(CHOICES.rowDensity),
    showModel: flag,
    showBranch: flag,
    scrollbarColor: choice(CHOICES.scrollbarColor),
    scrollbarSize: choice(CHOICES.scrollbarSize),
    scrollbarVisibility: choice(CHOICES.scrollbarVisibility),
    tintSource: choice(CHOICES.tintSource),
    workingColor: choice(CHOICES.workingColor),
    workingStyle: choice(CHOICES.workingStyle),
  },
  background: {
    sidebarOpacity: percent(RANGES.sidebarOpacity, THEME_SUGGESTION_GUARDS.paneOpacityMin),
    mainOpacity: percent(RANGES.mainOpacity, THEME_SUGGESTION_GUARDS.paneOpacityMin),
    sidebarBlur: number(RANGES.sidebarBlur.min, RANGES.sidebarBlur.max),
    bodyGlass: flag,
    windowGlass: flag,
    liveScene: choice(CHOICES.liveScene),
    liveIntensity: percent(RANGES.liveIntensity),
    newThreadEffect: choice(CHOICES.newThreadEffect),
  },
  image: {
    scope: choice(CHOICES.chatBackgroundScope),
    emptyOpacity: percent(RANGES.chatBackgroundOpacity, 0.3),
    sessionOpacity: percent(RANGES.chatBackgroundOpacity, 0.15),
    blur: number(RANGES.chatBackgroundBlur.min, Math.min(12, RANGES.chatBackgroundBlur.max)),
  },
  motion: {
    crewTheme: choice(CHOICES.crewTheme),
    showCrew: flag,
    crewGrowth: flag,
    decorative: flag,
    tabAnimations: flag,
  },
} as const;

export type ThemeFieldGroup = keyof typeof THEME_FIELD_SPECS;
export const THEME_FIELD_GROUPS = Object.keys(THEME_FIELD_SPECS) as ThemeFieldGroup[];
export type ThemeTypography = GroupValues<typeof THEME_FIELD_SPECS.typography>;
export type ThemeInterface = GroupValues<typeof THEME_FIELD_SPECS.interface>;
export type ThemeBackground = GroupValues<typeof THEME_FIELD_SPECS.background>;
export type ThemeImage = GroupValues<typeof THEME_FIELD_SPECS.image>;
export type ThemeMotion = GroupValues<typeof THEME_FIELD_SPECS.motion>;

/** Generated code and terminal text share one scale; manual preferences keep their full range. */
export function resolveThemeTypography(
  typography: ThemeTypography,
  currentCodeSize: number,
): ThemeTypography {
  if (typography.terminalSize === undefined) return typography;
  const reference = typography.codeSize ?? currentCodeSize;
  const gap = THEME_SUGGESTION_GUARDS.terminalSizeGap;
  return {
    ...typography,
    terminalSize: Math.min(reference + gap, Math.max(reference - gap, typography.terminalSize)),
  };
}

function sanitizeField(spec: FieldSpec, value: unknown): string | number | boolean | undefined {
  switch (spec.kind) {
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? Math.min(spec.max, Math.max(spec.min, Math.round(value)))
        : undefined;
    case "choice":
      return (spec.values as readonly unknown[]).includes(value)
        ? (value as string | number)
        : undefined;
    case "flag":
      return typeof value === "boolean" ? value : undefined;
    case "font":
      return typeof value === "string" && findFont(CODE_FONT_CATALOG, value) ? value : undefined;
  }
}

/** Keeps the valid fields of one group, drops the rest field by field; `undefined` when none remain. */
export function sanitizeThemeGroup<G extends ThemeFieldGroup>(
  group: G,
  input: unknown,
): GroupValues<(typeof THEME_FIELD_SPECS)[G]> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const specs = THEME_FIELD_SPECS[group] as Record<string, FieldSpec>;
  const kept: Record<string, string | number | boolean> = {};
  for (const [key, spec] of Object.entries(specs)) {
    const value = sanitizeField(spec, (input as Record<string, unknown>)[key]);
    if (value !== undefined) kept[key] = value;
  }
  return Object.keys(kept).length > 0
    ? (kept as GroupValues<(typeof THEME_FIELD_SPECS)[G]>)
    : undefined;
}

function describeSpec(spec: FieldSpec): string {
  switch (spec.kind) {
    case "number":
      return `${spec.min}-${spec.max}`;
    case "choice":
      return spec.values.map((value) => JSON.stringify(value)).join("|");
    case "flag":
      return "true|false";
    case "font":
      return "a codeFont id";
  }
}

/** One compact line per group for the model prompt, for example `"image": {"scope": "empty"|"all"}`. */
export function describeThemeFieldGroups(): string[] {
  return THEME_FIELD_GROUPS.map((group) => {
    const fields = Object.entries(THEME_FIELD_SPECS[group] as Record<string, FieldSpec>)
      .map(([key, spec]) => `"${key}": ${describeSpec(spec)}`)
      .join(", ");
    return `"${group}": {${fields}}`;
  });
}

/**
 * How a drawn background image is tuned when the model gave no `image` values: visible in new
 * threads, quieter and softened behind chat text, and shown in every thread.
 */
export const THEME_IMAGE_DEFAULTS = {
  scope: "all",
  emptyOpacity: 40,
  sessionOpacity: 18,
  blur: 6,
} as const satisfies Required<ThemeImage>;

export function resolveImageTuning(image: ThemeImage | undefined): Required<ThemeImage> {
  return { ...THEME_IMAGE_DEFAULTS, ...sanitizeThemeGroup("image", image) };
}
