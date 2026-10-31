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

export const APPEARANCE_PREFERENCES_EVENT = "bycoda.appearancePreferencesChanged";
const KEY = "bycoda.appearancePreferences.v1";
export const INTERFACE_FONTS = ["System", "Segoe UI", "Arial", "Verdana"] as const;
export const CODE_FONTS = ["System", "Consolas", "Menlo", "Courier New"] as const;
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
  terminalFont: "",
  terminalSize: 13,
  terminalWeight: 400,
  terminalLineHeight: 1,
  contrast: 100,
  accentReadability: ACCENT_READABILITY_DEFAULT,
  canvasBackground: CANVAS_BACKGROUND_DEFAULT,
  controlDensity: "compact",
  chatWidth: "comfortable",
  wordWrap: false,
} as const;
export type AppearancePreferences = {
  interfaceFont: string;
  codeFont: string;
  codeSize: number;
  codeTheme: "github" | "dracula";
  /** Empty inherits the application's monospace font. */
  terminalFont: string;
  terminalSize: number;
  terminalWeight: number;
  terminalLineHeight: number;
  contrast: number;
  /** Contrast level the accent fill, its ink and text selection must reach. */
  accentReadability: AccentReadability;
  /** Main canvas tone; custom surface colors keep their own tinted canvas (see appearance.ts). */
  canvasBackground: CanvasBackground;
  controlDensity: "compact" | "comfortable" | "touch";
  chatWidth: "comfortable" | "wide" | "full";
  wordWrap: boolean;
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
    interfaceFont: INTERFACE_FONTS.includes(value.interfaceFont as (typeof INTERFACE_FONTS)[number])
      ? value.interfaceFont!
      : "System",
    codeFont: CODE_FONTS.includes(value.codeFont as (typeof CODE_FONTS)[number])
      ? value.codeFont!
      : "System",
    codeSize: bounded(value.codeSize, 13, 11, 18),
    codeTheme: value.codeTheme === "dracula" ? "dracula" : "github",
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
    // Existing installations used the editor size until terminal preferences existed.
    terminalSize: bounded(value.terminalSize, bounded(value.codeSize, 13, 11, 18), 8, 40),
    terminalWeight: [300, 400, 500, 600, 700].includes(value.terminalWeight ?? 0)
      ? value.terminalWeight!
      : 400,
    terminalLineHeight: [1, 1.15, 1.35, 1.5].includes(value.terminalLineHeight ?? 0)
      ? value.terminalLineHeight!
      : 1,
    contrast: bounded(value.contrast, 100, 75, 150),
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
  };
}
let lastKnownPreferences: AppearancePreferences | null = null;
let preferenceReadUnavailable = false;
export function appearancePreferencesReadUnavailable() {
  return preferenceReadUnavailable;
}

export function loadAppearancePreferences(): AppearancePreferences {
  try {
    const value = normalizeAppearancePreferences(
      JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {},
    );
    lastKnownPreferences = value;
    preferenceReadUnavailable = false;
    return value;
  } catch {
    preferenceReadUnavailable = true;
    return lastKnownPreferences ?? { ...APPEARANCE_DEFAULTS };
  }
}
export function applyAppearancePreferences(value: AppearancePreferences) {
  const root = document.documentElement;
  root.dataset.controlDensity = value.controlDensity;
  root.dataset.codeTheme = value.codeTheme;
  root.dataset.accentReadability = value.accentReadability;
  // The chosen tone; appearance.ts resolves the effective `data-canvas-background` from it.
  root.dataset.canvasBackgroundPreference = value.canvasBackground;
  for (const [property, font, fallback] of [
    ["--font-sans", value.interfaceFont, "sans-serif"],
    ["--font-mono", value.codeFont, "monospace"],
  ]) {
    if (font === "System") root.style.removeProperty(property);
    else root.style.setProperty(property, `"${font}", ${fallback}`);
  }
  root.style.setProperty("--appearance-code-size", `${value.codeSize}px`);
  root.style.setProperty("--appearance-stroke-strength", `${(7 * value.contrast) / 100}%`);
  root.style.setProperty(
    "--appearance-secondary-strength",
    `${Math.min(100, (85 * value.contrast) / 100)}%`,
  );
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
