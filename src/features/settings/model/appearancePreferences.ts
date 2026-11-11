import {
  acceptAppearanceStorageChange,
  registerAppearanceSaveFailure,
  writeAppearanceValue,
} from "./appearancePersistence";
import {
  ACCENT_READABILITY_DEFAULT,
  isAccentReadability,
  type AccentReadability,
} from "./accentContrast";
import {
  CODE_FONT_CATALOG,
  INTERFACE_FONT_CATALOG,
  fontFamilyValue,
  normalizeFontId,
} from "./fontCatalog";
import { preloadBundledFont } from "./fontFaceLoader";
import { APPEARANCE_RANGES } from "./themeRanges";

export const APPEARANCE_PREFERENCES_EVENT = "bycoda.appearancePreferencesChanged";
const KEY = "bycoda.appearancePreferences.v1";
export const INTERFACE_FONTS = INTERFACE_FONT_CATALOG.map((font) => font.id);
export const CODE_FONTS = CODE_FONT_CATALOG.map((font) => font.id);
/** Terminal text uses the code font unless the owner picks a separate one. */
export const TERMINAL_FONT_SOURCES = ["code", "custom"] as const;
export type TerminalFontSource = (typeof TERMINAL_FONT_SOURCES)[number];
/**
 * The main canvas tone. "pure" paints the shared canvas pure black in dark mode and pure white in
 * light mode for every theme palette; "tinted" keeps the palette's own tinted canvas. Owner
 * decision 2026-10-31 (V3-039): Pure is the default, including for records saved before it existed.
 */
export const CANVAS_BACKGROUNDS = ["pure", "tinted"] as const;
export type CanvasBackground = (typeof CANVAS_BACKGROUNDS)[number];
export const CANVAS_BACKGROUND_DEFAULT: CanvasBackground = "pure";
export const APPEARANCE_DEFAULTS = {
  interfaceFont: "System",
  codeFont: "System",
  codeSize: 13,
  codeTheme: "github",
  codeLigatures: true,
  terminalFont: "",
  terminalFontSource: "code",
  terminalSize: 13,
  terminalWeight: 400,
  terminalLineHeight: 1,
  contrast: 100,
  surfaceContrast: 100,
  accentReadability: ACCENT_READABILITY_DEFAULT,
  canvasBackground: CANVAS_BACKGROUND_DEFAULT,
  controlDensity: "compact",
  chatWidth: "comfortable",
  wordWrap: false,
  wheelZoom: true,
} as const;
export type AppearancePreferences = {
  interfaceFont: string;
  codeFont: string;
  codeSize: number;
  codeTheme: "github" | "dracula";
  /** Programming ligatures (=> != >=) in code and editor text. */
  codeLigatures: boolean;
  /** Empty inherits the application's monospace font. */
  terminalFont: string;
  /** "code" follows the code font; "custom" uses `terminalFont`. */
  terminalFontSource: TerminalFontSource;
  terminalSize: number;
  terminalWeight: number;
  terminalLineHeight: number;
  contrast: number;
  /** Percent (50-200) of how strongly cards, fields and dialogs lift off the canvas. */
  surfaceContrast: number;
  /** Contrast level the accent fill, its ink and text selection must reach. */
  accentReadability: AccentReadability;
  /** Main canvas tone; custom surface colors keep their own tinted canvas (see appearance.ts). */
  canvasBackground: CanvasBackground;
  controlDensity: "compact" | "comfortable" | "touch";
  chatWidth: "comfortable" | "wide" | "full";
  wordWrap: boolean;
  /** Ctrl+wheel outside self-zooming viewers changes the interface scale. */
  wheelZoom: boolean;
};
function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}
export function normalizeAppearancePreferences(
  value: Partial<AppearancePreferences>,
): AppearancePreferences {
  return {
    interfaceFont: normalizeFontId(INTERFACE_FONT_CATALOG, value.interfaceFont),
    codeFont: normalizeFontId(CODE_FONT_CATALOG, value.codeFont),
    codeSize: bounded(
      value.codeSize,
      13,
      APPEARANCE_RANGES.codeSize.min,
      APPEARANCE_RANGES.codeSize.max,
    ),
    codeTheme: value.codeTheme === "dracula" ? "dracula" : "github",
    codeLigatures: value.codeLigatures !== false,
    terminalFont:
      typeof value.terminalFont === "string"
        ? Array.from(value.terminalFont)
            .filter(
              (char) =>
                char.charCodeAt(0) >= 32 &&
                char.charCodeAt(0) !== 127 &&
                ![34, 39, 92].includes(char.charCodeAt(0)),
            )
            .join("")
            .slice(0, 100)
        : "",
    // Records saved before the source choice existed keep a custom terminal font when one was set.
    terminalFontSource:
      value.terminalFontSource === "custom" ||
      (value.terminalFontSource !== "code" &&
        typeof value.terminalFont === "string" &&
        value.terminalFont.trim() !== "")
        ? "custom"
        : "code",
    // Existing installations used the editor size until terminal preferences existed.
    terminalSize: bounded(
      value.terminalSize,
      bounded(value.codeSize, 13, APPEARANCE_RANGES.codeSize.min, APPEARANCE_RANGES.codeSize.max),
      APPEARANCE_RANGES.terminalSize.min,
      APPEARANCE_RANGES.terminalSize.max,
    ),
    terminalWeight: [300, 400, 500, 600, 700].includes(value.terminalWeight ?? 0)
      ? value.terminalWeight!
      : 400,
    terminalLineHeight: [1, 1.15, 1.35, 1.5].includes(value.terminalLineHeight ?? 0)
      ? value.terminalLineHeight!
      : 1,
    contrast: bounded(
      value.contrast,
      100,
      APPEARANCE_RANGES.contrast.min,
      APPEARANCE_RANGES.contrast.max,
    ),
    surfaceContrast: bounded(
      value.surfaceContrast,
      100,
      APPEARANCE_RANGES.surfaceContrast.min,
      APPEARANCE_RANGES.surfaceContrast.max,
    ),
    // Records saved before this preference existed have no value: they resolve to "auto".
    accentReadability: isAccentReadability(value.accentReadability)
      ? value.accentReadability
      : ACCENT_READABILITY_DEFAULT,
    // Only an explicit "tinted" opts out; records without the field resolve to the Pure default.
    canvasBackground: value.canvasBackground === "tinted" ? "tinted" : CANVAS_BACKGROUND_DEFAULT,
    controlDensity:
      value.controlDensity === "comfortable" || value.controlDensity === "touch"
        ? value.controlDensity
        : "compact",
    chatWidth:
      value.chatWidth === "wide" || value.chatWidth === "full" ? value.chatWidth : "comfortable",
    wordWrap: value.wordWrap === true,
    wheelZoom: value.wheelZoom !== false,
  };
}
let lastKnownPreferences: AppearancePreferences | null = null;
let cachedPreferenceRaw: string | null | undefined;
let invalidPreferenceRaw: string | undefined;
let preferenceReadUnavailable = false;
export function appearancePreferencesReadUnavailable() {
  return preferenceReadUnavailable;
}

export function loadAppearancePreferences(): AppearancePreferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === cachedPreferenceRaw && lastKnownPreferences) {
      preferenceReadUnavailable = false;
      return lastKnownPreferences;
    }
    if (raw !== null && raw === invalidPreferenceRaw) {
      preferenceReadUnavailable = true;
      return lastKnownPreferences ?? { ...APPEARANCE_DEFAULTS };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw ?? "{}");
    } catch (error) {
      invalidPreferenceRaw = raw ?? undefined;
      throw error;
    }
    const value = normalizeAppearancePreferences(parsed ?? {});
    lastKnownPreferences = value;
    cachedPreferenceRaw = raw;
    invalidPreferenceRaw = undefined;
    preferenceReadUnavailable = false;
    return value;
  } catch {
    preferenceReadUnavailable = true;
    return lastKnownPreferences ?? { ...APPEARANCE_DEFAULTS };
  }
}
/** CSS family the terminal uses when it has its own font; "" follows the code font. */
export function terminalFontFamily(
  value: Pick<AppearancePreferences, "terminalFontSource" | "terminalFont">,
): string {
  if (value.terminalFontSource !== "custom") return "";
  const font = value.terminalFont.trim();
  if (!font || font === "System") return "";
  return fontFamilyValue(CODE_FONT_CATALOG, font) ?? font;
}

export function applyAppearancePreferences(value: AppearancePreferences) {
  const root = document.documentElement;
  root.dataset.controlDensity = value.controlDensity;
  root.dataset.codeTheme = value.codeTheme;
  root.dataset.accentReadability = value.accentReadability;
  // The chosen tone; appearance.ts resolves the effective `data-canvas-background` from it.
  root.dataset.canvasBackgroundPreference = value.canvasBackground;
  const terminalFont = terminalFontFamily(value);
  for (const [property, catalog, font, fallback] of [
    ["--font-sans", INTERFACE_FONT_CATALOG, value.interfaceFont, "sans-serif"],
    ["--font-mono", CODE_FONT_CATALOG, value.codeFont, "monospace"],
  ] as const) {
    const family = fontFamilyValue(catalog, font);
    if (family === undefined) root.style.removeProperty(property);
    else root.style.setProperty(property, `"${family}", ${fallback}`);
  }
  root.dataset.codeLigatures = value.codeLigatures ? "on" : "off";
  // Bundled faces register on demand; the platform fallback shows until they load.
  preloadBundledFont(fontFamilyValue(INTERFACE_FONT_CATALOG, value.interfaceFont));
  preloadBundledFont(fontFamilyValue(CODE_FONT_CATALOG, value.codeFont));
  preloadBundledFont(fontFamilyValue(CODE_FONT_CATALOG, terminalFont));
  root.style.setProperty("--appearance-code-size", `${value.codeSize}px`);
  root.style.setProperty("--appearance-stroke-strength", `${(7 * value.contrast) / 100}%`);
  root.style.setProperty(
    "--appearance-secondary-strength",
    `${Math.min(100, (85 * value.contrast) / 100)}%`,
  );
  // Unitless multiplier the layer tokens read; the default leaves the property unset.
  if (value.surfaceContrast === APPEARANCE_DEFAULTS.surfaceContrast)
    root.style.removeProperty("--appearance-layer-strength");
  else root.style.setProperty("--appearance-layer-strength", String(value.surfaceContrast / 100));
  root.style.setProperty(
    "--appearance-chat-width",
    value.chatWidth === "full" ? "100%" : value.chatWidth === "wide" ? "76rem" : "56rem",
  );
  root.classList.toggle("appearance-word-wrap", value.wordWrap);
}
export function saveAppearancePreferences(
  value: AppearancePreferences,
  base = lastKnownPreferences,
) {
  const retry = () => {
    try {
      saveAppearancePreferences(value, base);
      return true;
    } catch {
      return false;
    }
  };
  let readSucceeded = false;
  try {
    // Read the whole record before replacing it; merge only fields edited from the known base.
    const current = normalizeAppearancePreferences(
      JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {},
    );
    readSucceeded = true;
    const edits = Object.fromEntries(
      Object.entries(value).filter(
        ([key, next]) => !base || next !== base[key as keyof AppearancePreferences],
      ),
    );
    const next = normalizeAppearancePreferences({ ...current, ...edits });
    preferenceReadUnavailable = false;
    const notify = () => {
      lastKnownPreferences = next;
      cachedPreferenceRaw = undefined;
      applyAppearancePreferences(next);
      window.dispatchEvent(new Event(APPEARANCE_PREFERENCES_EVENT));
    };
    if (
      !writeAppearanceValue(
        KEY,
        JSON.stringify(next),
        "appearance-preferences",
        notify,
        false,
        retry,
      )
    )
      throw new Error("Could not save appearance preferences.");
    return next;
  } catch (error) {
    if (!readSucceeded) preferenceReadUnavailable = true;
    registerAppearanceSaveFailure({
      key: KEY,
      value: null,
      settingId: "appearance-preferences",
      applied: false,
      notify: () => {},
      retry,
    });
    throw error;
  }
}
export function initAppearancePreferences() {
  applyAppearancePreferences(loadAppearancePreferences());
  window.addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) {
      acceptAppearanceStorageChange(event.key);
      applyAppearancePreferences(loadAppearancePreferences());
      window.dispatchEvent(new Event(APPEARANCE_PREFERENCES_EVENT));
    }
  });
}
