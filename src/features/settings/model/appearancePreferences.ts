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
import {
  FILE_REF_KINDS,
  FILE_REF_TONES,
  FILE_REF_TONE_DEFAULTS,
  type FileRefKind,
  type FileRefTone,
} from "../../../shared/lib/fileReferenceKind";
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
/** Reading surface behind assistant replies: a column of the reply, the whole column, or none. */
export const TRANSCRIPT_SURFACES = ["reply", "column", "off"] as const;
export type TranscriptSurface = (typeof TRANSCRIPT_SURFACES)[number];
export const TRANSCRIPT_CARDS = ["inset", "outline", "solid"] as const;
export type TranscriptCards = (typeof TRANSCRIPT_CARDS)[number];
/** "hover" reveals the message actions on hover or focus; the latest turn always shows them. */
export const TRANSCRIPT_ACTIONS = ["always", "hover"] as const;
export type TranscriptActions = (typeof TRANSCRIPT_ACTIONS)[number];
/** "colored" tints file references by kind; "plain" keeps their icon on a neutral ground. */
export const FILE_REF_STYLES = ["colored", "plain"] as const;
export type FileRefStyle = (typeof FILE_REF_STYLES)[number];
/** Stored field of each kind's tone: `fileToneCode`, `fileToneDocs`, ... */
export type FileToneField = `fileTone${Capitalize<FileRefKind>}`;
export const FILE_TONE_FIELDS = Object.fromEntries(
  FILE_REF_KINDS.map((kind) => [kind, `fileTone${kind[0]!.toUpperCase()}${kind.slice(1)}`]),
) as Record<FileRefKind, FileToneField>;
const FILE_TONE_DEFAULTS = Object.fromEntries(
  FILE_REF_KINDS.map((kind) => [FILE_TONE_FIELDS[kind], FILE_REF_TONE_DEFAULTS[kind]]),
) as Record<FileToneField, FileRefTone>;
/**
 * CSS custom properties that hand each kind's chosen tone to file-references.css. A tone is one
 * of the fixed theme hues, never a free colour.
 */
export function fileRefToneColor(tone: FileRefTone): string {
  return `var(--color-${tone === "neutral" ? "content" : tone})`;
}
export function fileRefHueVars(
  value: Pick<AppearancePreferences, FileToneField>,
): Record<string, string> {
  return Object.fromEntries(
    FILE_REF_KINDS.map((kind) => [
      `--file-ref-hue-${kind}`,
      fileRefToneColor(value[FILE_TONE_FIELDS[kind]]),
    ]),
  );
}
export const APPEARANCE_DEFAULTS = {
  ...FILE_TONE_DEFAULTS,
  transcriptFileRefs: "colored" as FileRefStyle,
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
  userMessageOpacity: 42,
  transcriptSurface: "reply",
  transcriptSurfaceOpacity: 90,
  transcriptSurfaceBlur: 0,
  transcriptBodyInk: 92,
  transcriptChromeInk: 61,
  transcriptCards: "inset",
  transcriptActions: "always",
  messageColor: "theme",
  wordWrap: false,
  wheelZoom: true,
  chatBackgroundLayer: true,
} as const;
export type AppearancePreferences = Record<FileToneField, FileRefTone> & {
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
  userMessageOpacity: number;
  /** Percent (0-100) of the reading surface fill behind assistant replies. */
  transcriptSurface: TranscriptSurface;
  transcriptSurfaceOpacity: number;
  /** Blur of the reading surface in px (0-24); applies only over a background image. */
  transcriptSurfaceBlur: number;
  /** Percent (80-100) of the reply text ink, scaled by Contrast. */
  transcriptBodyInk: number;
  /** Percent (50-100) of the tool and action ink, relative to the reply text ink. */
  transcriptChromeInk: number;
  transcriptCards: TranscriptCards;
  transcriptActions: TranscriptActions;
  /** How file references in replies are tinted; each kind's hue is its `fileTone*` field. */
  transcriptFileRefs: FileRefStyle;
  messageColor: "theme" | "neutral";
  wordWrap: boolean;
  /** Ctrl+wheel outside self-zooming viewers changes the interface scale. */
  wheelZoom: boolean;
  /** Readability veil over chat images; off shows artwork without attenuation. */
  chatBackgroundLayer: boolean;
};
function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}
function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}
/**
 * The assistant opacity this record used to store becomes the reading surface. A stored 0 meant
 * "no fill", which is the `off` surface; any other value is the surface opacity. Transcript fields
 * already stored always win over the leftover value.
 */
function transcriptFieldsFromLegacy(
  value: Partial<AppearancePreferences> & { assistantMessageOpacity?: unknown },
): Partial<AppearancePreferences> {
  const legacy = value.assistantMessageOpacity;
  if (
    value.transcriptSurfaceOpacity !== undefined ||
    typeof legacy !== "number" ||
    !Number.isFinite(legacy)
  )
    return {};
  if (legacy > 0) return { transcriptSurfaceOpacity: legacy };
  return value.transcriptSurface === undefined ? { transcriptSurface: "off" } : {};
}
export function normalizeAppearancePreferences(
  input: Partial<AppearancePreferences> & { assistantMessageOpacity?: unknown },
): AppearancePreferences {
  const value = { ...input, ...transcriptFieldsFromLegacy(input) };
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
    userMessageOpacity: bounded(
      value.userMessageOpacity,
      APPEARANCE_DEFAULTS.userMessageOpacity,
      0,
      100,
    ),
    transcriptSurface: oneOf(TRANSCRIPT_SURFACES, value.transcriptSurface, "reply"),
    transcriptSurfaceOpacity: bounded(
      value.transcriptSurfaceOpacity,
      APPEARANCE_DEFAULTS.transcriptSurfaceOpacity,
      0,
      100,
    ),
    transcriptSurfaceBlur: bounded(value.transcriptSurfaceBlur, 0, 0, 24),
    transcriptBodyInk: bounded(value.transcriptBodyInk, 92, 80, 100),
    transcriptChromeInk: bounded(value.transcriptChromeInk, 61, 50, 100),
    transcriptCards: oneOf(TRANSCRIPT_CARDS, value.transcriptCards, "inset"),
    transcriptActions: oneOf(TRANSCRIPT_ACTIONS, value.transcriptActions, "always"),
    transcriptFileRefs: oneOf(FILE_REF_STYLES, value.transcriptFileRefs, "colored"),
    ...(Object.fromEntries(
      FILE_REF_KINDS.map((kind) => {
        const field = FILE_TONE_FIELDS[kind];
        return [field, oneOf(FILE_REF_TONES, value[field], FILE_REF_TONE_DEFAULTS[kind])];
      }),
    ) as Record<FileToneField, FileRefTone>),
    messageColor: value.messageColor === "neutral" ? "neutral" : "theme",
    wordWrap: value.wordWrap === true,
    wheelZoom: value.wheelZoom !== false,
    chatBackgroundLayer: value.chatBackgroundLayer !== false,
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
  root.classList.toggle("chat-background-layer-off", value.chatBackgroundLayer === false);
  root.dataset.controlDensity = value.controlDensity;
  root.dataset.codeTheme = value.codeTheme;
  root.dataset.accentReadability = value.accentReadability;
  root.dataset.chatMessageColor = value.messageColor;
  root.toggleAttribute("data-chat-user-surface-off", value.userMessageOpacity === 0);
  root.style.setProperty("--appearance-user-message-opacity", `${value.userMessageOpacity}%`);
  root.dataset.transcriptSurface = value.transcriptSurface;
  root.dataset.transcriptCards = value.transcriptCards;
  root.dataset.transcriptActions = value.transcriptActions;
  root.dataset.fileRefs = value.transcriptFileRefs;
  for (const [name, hue] of Object.entries(fileRefHueVars(value)))
    root.style.setProperty(name, hue);
  // The backdrop layer only exists while a blur is asked for (blur 0 opens none).
  root.toggleAttribute("data-transcript-blur", value.transcriptSurfaceBlur > 0);
  root.style.setProperty(
    "--appearance-transcript-surface-opacity",
    `${value.transcriptSurfaceOpacity}%`,
  );
  root.style.setProperty(
    "--appearance-transcript-surface-blur",
    `${value.transcriptSurfaceBlur}px`,
  );
  root.style.setProperty("--appearance-transcript-body-ink", `${value.transcriptBodyInk}%`);
  root.style.setProperty("--appearance-transcript-chrome-ink", `${value.transcriptChromeInk}%`);
  // Unitless multiplier the transcript ink reads; Contrast 100 leaves it at 1.
  root.style.setProperty("--appearance-contrast-scale", String(value.contrast / 100));
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
