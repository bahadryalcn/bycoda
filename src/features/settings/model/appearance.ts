import { subscribePreferenceChanges } from "../../../shared/lib/storedSetting";
import { themePalette } from "../../../shared/theme/palette";
import { initWorkspaceBackground } from "./workspaceBackground";
import { clamp } from "../../../shared/lib/numbers";
import {
  APPEARANCE_PREFERENCES_EVENT,
  CANVAS_BACKGROUND_DEFAULT,
  initAppearancePreferences,
  loadAppearancePreferences,
  type CanvasBackground,
} from "./appearancePreferences";
import { matchThemePalette } from "./themePalettes";
import {
  deriveAccentRoles,
  isAccentReadability,
  mixInOklab,
  type AccentCanvas,
  type AccentReadability,
} from "./accentContrast";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { hslToRgb, isHexColor, type Rgb } from "../../../shared/lib/colorUtils";
import { IS_LINUX, IS_MAC } from "../../../platform/tauri/platform";
import { readFlag, writeFlag } from "./storageFlags";
import { initUiScale } from "./uiScale";
import { runThemeTransition } from "./themeTransition";
import {
  acceptAppearanceStorageChange,
  readAppearanceValue,
  writeAppearanceValue,
} from "./appearancePersistence";
import {
  applyPreparedNewThreadBackground,
  clearPreparedNewThreadBackground,
} from "./newThreadBackgroundEffects";

const ACCENT_COLOR_KEY = "bycoda.accentColor";
const THEME_HUE_KEY = "bycoda.themeHue";
const THEME_SATURATION_KEY = "bycoda.themeSaturation";
const THEME_DARK_LIGHTNESS_KEY = "bycoda.themeDarkLightness";
const OPACITY_KEY = "bycoda.sidebarOpacity";
const MAIN_OPACITY_KEY = "bycoda.mainOpacity";
const BLUR_KEY = "bycoda.sidebarBlur";
const PROJECT_RAIL_OPEN_KEY = "bycoda.projectRailOpen";
const SESSION_SIDEBAR_OPEN_KEY = "bycoda.sessionSidebarOpen";
const BODY_KEY = "bycoda.bodyGlass";
const WINDOW_GLASS_KEY = "bycoda.windowGlass";
const SCHEME_KEY = "bycoda.colorScheme";
const SIDEBAR_TAB_ORDER_KEY = "bycoda.sidebarTabOrder";
const PROJECT_RAIL_WIDTH_KEY = "bycoda.projectRailWidth";
const SESSION_SIDEBAR_WIDTH_KEY = "bycoda.sessionSidebarWidth";
const TRANSCRIPT_LAYOUT_KEY = "bycoda.transcriptLayout";
const TRANSCRIPT_ANCHOR_KEY = "bycoda.transcriptAnchor";
const CHAT_BACKGROUND_PATH_KEY = "bycoda.chatBackgroundPath";
const CHAT_BACKGROUND_OPACITY_KEY = "bycoda.chatBackgroundOpacity";
const CHAT_BACKGROUND_EMPTY_OPACITY_KEY = "bycoda.chatBackgroundEmptyOpacity";
const CHAT_BACKGROUND_SESSION_OPACITY_KEY = "bycoda.chatBackgroundSessionOpacity";
const CHAT_BACKGROUND_SCOPE_KEY = "bycoda.chatBackgroundScope";
const CHAT_BACKGROUND_BLUR_KEY = "bycoda.chatBackgroundBlur";
const NEW_THREAD_BACKGROUND_EFFECT_KEY = "bycoda.newThreadBackgroundEffect";
const CHANGES_VIEW_KEY = "bycoda.changesView";
const DIFF_PALETTE_KEY = "bycoda.diffPalette";
const SHOW_EXCLUDED_FILES_KEY = "bycoda.showExcludedFiles";
let chatBackgroundRevision = Date.now();
let nativeGlassReady = false;
let glassFadeTimer: number | undefined;
let glassSyncGeneration = 0;
let nativeGlassError = false;
let nativeGlassPending = false;
const NATIVE_GLASS_EVENT = "bycoda:native-glass-status";
export function readNativeGlassError() {
  return nativeGlassError;
}
export function readNativeGlassPending() {
  return nativeGlassPending;
}
export function subscribeNativeGlassStatus(listener: () => void) {
  window.addEventListener(NATIVE_GLASS_EVENT, listener);
  return () => window.removeEventListener(NATIVE_GLASS_EVENT, listener);
}
function setNativeGlassStatus(value: boolean, pending: boolean) {
  nativeGlassError = value;
  nativeGlassPending = pending;
  window.dispatchEvent(new Event(NATIVE_GLASS_EVENT));
}

export const CHAT_BACKGROUND_PATH_CHANGE_EVENT = "bycoda:chat-background-path-change";

export type ColorScheme = "dark" | "light";
export type ThemePreference = ColorScheme | "system";
export type TranscriptLayout = "full" | "chat";
export type ChatBackgroundScope = "empty" | "all";
export type NewThreadBackgroundEffect =
  | "none"
  | "dither"
  | "ascii"
  | "halftone"
  | "scanlines"
  | "gradient-blur";
export type ChangesView = "list" | "tree";
export type DiffPalette = "default" | "colorblind" | "high-contrast";

export const NEW_THREAD_BACKGROUND_EFFECTS: readonly NewThreadBackgroundEffect[] = [
  "none",
  "dither",
  "ascii",
  "halftone",
  "scanlines",
  "gradient-blur",
];

export const NEW_THREAD_BACKGROUND_EFFECT_DEFAULT: NewThreadBackgroundEffect = "none";

export const NEW_THREAD_BACKGROUND_EFFECT_LABELS: Record<NewThreadBackgroundEffect, string> = {
  none: "None",
  dither: "Dither",
  ascii: "ASCII",
  halftone: "Halftone",
  scanlines: "Scanlines",
  "gradient-blur": "Haze",
};

export const NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS: Record<NewThreadBackgroundEffect, string> =
  {
    none: "Shows the original artwork.",
    dither: "Rebuilds the artwork with a dithered color palette.",
    ascii: "Recreates the artwork with colored characters on black.",
    halftone: "Recreates the artwork with colored print dots on black.",
    scanlines: "Adds a pronounced horizontal display-line texture.",
    "gradient-blur": "Blurs and fades the artwork into the background below.",
  };

export const THEME_PREFERENCE_DEFAULT: ThemePreference = "dark";

export const ACCENT_COLOR_DEFAULT = themePalette.hexA3ACB8;

/** Fired on `window` whenever the color scheme flips (detail: ColorScheme). */
export const SCHEME_CHANGE_EVENT = "bycoda:schemechange";

export const TRANSCRIPT_LAYOUT_DEFAULT: TranscriptLayout = "chat";

export const CHANGES_VIEW_DEFAULT: ChangesView = "list";

export const DIFF_PALETTE_DEFAULT: DiffPalette = "default";

export const TRANSCRIPT_ANCHOR_DEFAULT = true;

/** Fired on `window` whenever prompt-to-top anchoring flips (detail: boolean). */
export const TRANSCRIPT_ANCHOR_CHANGE_EVENT = "bycoda:transcriptanchorchange";

/** Fired on `window` whenever the transcript layout flips (detail: TranscriptLayout). */
export const TRANSCRIPT_LAYOUT_CHANGE_EVENT = "bycoda:transcriptlayoutchange";

export const SHOW_EXCLUDED_FILES_DEFAULT = false;

/** Fired on `window` whenever the explorer excluded-files setting flips (detail: boolean). */
export const SHOW_EXCLUDED_FILES_CHANGE_EVENT = "bycoda:showexcludedfileschange";

export type SidebarTabId = "files" | "sessions" | "changes" | "inbox";

const DEFAULT_SIDEBAR_TAB_ORDER: SidebarTabId[] = ["sessions", "inbox", "files", "changes"];

export const THEME_HUE_MIN = 0;
export const THEME_HUE_MAX = 360;
export const THEME_HUE_DEFAULT = 216;

export const THEME_SATURATION_MIN = 0;
export const THEME_SATURATION_MAX = 100;
export const THEME_SATURATION_DEFAULT = 24;

export const THEME_DARK_LIGHTNESS_MIN = 0;
export const THEME_DARK_LIGHTNESS_MAX = 30;
export const THEME_DARK_LIGHTNESS_DEFAULT = 4;

export const SIDEBAR_OPACITY_MIN = 0.15;
export const SIDEBAR_OPACITY_MAX = 1;
export const SIDEBAR_OPACITY_DEFAULT = 1;

export const MAIN_OPACITY_MIN = 0.15;
export const MAIN_OPACITY_MAX = 1;
export const MAIN_OPACITY_DEFAULT = 1;

export const SIDEBAR_BLUR_MIN = 1;
export const SIDEBAR_BLUR_MAX = 64;
export const SIDEBAR_BLUR_DEFAULT = 24;

export const PROJECT_RAIL_WIDTH_MIN = 56;
/** Below this the rail drops its labels and shows icons only. */
export const PROJECT_RAIL_COMPACT_WIDTH = 140;
/** Below this the rail keeps labels but drops keyboard shortcut hints. */
export const PROJECT_RAIL_NARROW_WIDTH = 200;
export const PROJECT_RAIL_WIDTH_MAX = 360;
export const PROJECT_RAIL_WIDTH_DEFAULT = 176;

export const SESSION_SIDEBAR_WIDTH_MIN = 180;
export const SESSION_SIDEBAR_WIDTH_MAX = 560;
export const SESSION_SIDEBAR_WIDTH_DEFAULT = 244;

export const BODY_GLASS_DEFAULT = false;
/** Windows and macOS: the desktop shows through the window in dark mode (Linux uses
 * Main pane glass). Off gives an opaque window, which costs less to composite. */
export const WINDOW_GLASS_DEFAULT = true;

export const CHAT_BACKGROUND_OPACITY_MIN = 0.05;
export const CHAT_BACKGROUND_OPACITY_MAX = 0.65;
export const CHAT_BACKGROUND_OPACITY_DEFAULT = 0.24;
export const CHAT_BACKGROUND_BLUR_MIN = 0;
export const CHAT_BACKGROUND_BLUR_MAX = 40;
export const CHAT_BACKGROUND_BLUR_DEFAULT = 0;

export const CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT = CHAT_BACKGROUND_OPACITY_DEFAULT;
export const CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT = CHAT_BACKGROUND_OPACITY_DEFAULT;
export const CHAT_BACKGROUND_SCOPE_DEFAULT: ChatBackgroundScope = "all";

function readNumber(key: string): number | null {
  try {
    const raw = readAppearanceValue(key);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const SHARED_APPEARANCE_EVENT = "bycoda:sharedappearancechange";
function notifyAppearance(key: string) {
  if (typeof window !== "undefined" && SHARED_APPEARANCE_KEYS.has(key))
    window.dispatchEvent(new CustomEvent(SHARED_APPEARANCE_EVENT, { detail: key }));
}

function writeNumber(key: string, value: number) {
  if (!appearanceSettingIds[key]) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* Layout fallback unchanged. */
    }
    return;
  }
  return saveAppearanceValue(key, String(value));
}

const appearanceSettingIds: Record<string, string> = {
  [ACCENT_COLOR_KEY]: "accent-color",
  [SCHEME_KEY]: "theme",
  [THEME_HUE_KEY]: "hue",
  [THEME_SATURATION_KEY]: "saturation",
  [THEME_DARK_LIGHTNESS_KEY]: "dark-lightness",
  [OPACITY_KEY]: "sidebar-opacity",
  [MAIN_OPACITY_KEY]: "main-pane-opacity",
  [BLUR_KEY]: "blur",
  [BODY_KEY]: "main-pane-glass",
  [WINDOW_GLASS_KEY]: "window-glass",
  [CHAT_BACKGROUND_PATH_KEY]: "chat-background",
  [CHAT_BACKGROUND_EMPTY_OPACITY_KEY]: "chat-background",
  [CHAT_BACKGROUND_SESSION_OPACITY_KEY]: "chat-background",
  [CHAT_BACKGROUND_OPACITY_KEY]: "chat-background",
  [CHAT_BACKGROUND_BLUR_KEY]: "chat-background",
  [CHAT_BACKGROUND_SCOPE_KEY]: "chat-background",
  [NEW_THREAD_BACKGROUND_EFFECT_KEY]: "chat-background",
  [DIFF_PALETTE_KEY]: "diff-palette",
  [SHOW_EXCLUDED_FILES_KEY]: "show-excluded-files",
};
function saveAppearanceValue(key: string, value: string | null) {
  return writeAppearanceValue(key, value, appearanceSettingIds[key] ?? key, () =>
    notifyAppearance(key),
  );
}
function readAppearanceFlag(key: string, fallback: boolean) {
  try {
    const value = readAppearanceValue(key);
    return value == null ? fallback : value === "1" || value === "true";
  } catch {
    return fallback;
  }
}

function normalizeAccentColor(value: unknown): string | null {
  return typeof value === "string" && isHexColor(value)
    ? value.toLowerCase()
    : ACCENT_COLOR_DEFAULT;
}

/** Migrate only the previous shipped defaults, once; custom selections survive. */
export function migrateWorkbenchPalette() {
  try {
    const marker = "bycoda.workbenchPalette.v1";
    if (readAppearanceValue(marker) === "1") return;
    const hue = readNumber(THEME_HUE_KEY);
    const saturation = readNumber(THEME_SATURATION_KEY);
    const lightness = readNumber(THEME_DARK_LIGHTNESS_KEY);
    if (
      (hue == null || hue === 330) &&
      (saturation == null || saturation === 10) &&
      (lightness == null || lightness === 9)
    ) {
      for (const key of [THEME_HUE_KEY, THEME_SATURATION_KEY, THEME_DARK_LIGHTNESS_KEY])
        localStorage.removeItem(key);
    }
    if (readAppearanceValue(ACCENT_COLOR_KEY)?.toLowerCase() === themePalette.hexb39963)
      localStorage.removeItem(ACCENT_COLOR_KEY);
    localStorage.setItem(marker, "1");
  } catch {
    /* Storage may be unavailable; defaults still work without migration. */
  }
}

export function loadAccentColor(): string | null {
  migrateWorkbenchPalette();
  try {
    return normalizeAccentColor(readAppearanceValue(ACCENT_COLOR_KEY));
  } catch {
    return ACCENT_COLOR_DEFAULT;
  }
}

export function saveAccentColor(value: string | null) {
  migrateWorkbenchPalette();
  const next = normalizeAccentColor(value);
  return saveAppearanceValue(
    ACCENT_COLOR_KEY,
    value == null || next == null || next.toLowerCase() === ACCENT_COLOR_DEFAULT.toLowerCase()
      ? null
      : next,
  );
}

/** The level the accent roles are derived for: the live document value, else the saved one. */
function currentAccentReadability(): AccentReadability {
  const live = document.documentElement.dataset.accentReadability;
  return isAccentReadability(live) ? live : loadAppearancePreferences().accentReadability;
}

const ACCENT_PROPERTIES = [
  "--user-accent-color",
  "--user-accent-solid",
  "--user-accent-solid-hover",
  "--user-accent-solid-pressed",
  "--user-accent-foreground",
  "--user-accent-selection-dark",
  "--user-accent-selection-light",
  "--user-accent-selection-dark-ink",
  "--user-accent-selection-light-ink",
  "--user-accent-selection-paper",
] as const;

function hex(rgb: Rgb) {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Tint values applied to the document (live previews included); unset until first applied. */
const appliedTint: { hue?: number; saturation?: number; darkLightness?: number } = {};

/**
 * Conservative contrast envelope for selection surfaces, from the applied tint:
 * the dark editor/terminal `--ui-surface` (content 10% over the base) is the lightest
 * ground there. Keep the light envelope at content 3%, even though navigation now
 * shares the lighter chat canvas (V3-033), to retain the existing accent derivation.
 */
function themeCanvases(): AccentCanvas {
  const hue = appliedTint.hue ?? loadThemeHue();
  const saturation = appliedTint.saturation ?? loadThemeSaturation();
  const darkBase = hex(
    hslToRgb(hue, saturation, appliedTint.darkLightness ?? loadThemeDarkLightness()),
  );
  const darkContent = hex(hslToRgb(hue, saturation, 92));
  const lightBase = hex(hslToRgb(hue, saturation * 0.2, 98.6));
  const lightContent = hex(hslToRgb(hue, saturation * 0.35, 13));
  return {
    dark: mixInOklab(darkBase, darkContent, 0.1),
    light: mixInOklab(lightBase, lightContent, 0.03),
  };
}

/** Re-derives the accent roles when only their inputs (tint, canvas) changed. */
function refreshAccentRoles() {
  const saved = document.documentElement.style.getPropertyValue("--user-accent-color");
  if (saved) applyAccentColor(saved);
}

/**
 * Publishes the accent roles. `--user-accent-color` stays the saved colour and
 * `--user-accent-solid` equals it; the ink, hover/pressed steps and the two
 * selection fills are derived for the active readability level against the real
 * theme canvas (see accentContrast.ts) and only ever rendered.
 */
export function applyAccentColor(value: string | null) {
  const next = normalizeAccentColor(value);
  const root = document.documentElement;
  root.classList.toggle("has-user-accent", next != null);
  if (next == null) {
    for (const property of ACCENT_PROPERTIES) root.style.removeProperty(property);
    return next;
  }
  const roles = deriveAccentRoles(next, currentAccentReadability(), themeCanvases());
  root.style.setProperty("--user-accent-color", next);
  root.style.setProperty("--user-accent-solid", roles.solid.background);
  root.style.setProperty("--user-accent-solid-hover", roles.solid.hover);
  root.style.setProperty("--user-accent-solid-pressed", roles.solid.pressed);
  root.style.setProperty("--user-accent-foreground", roles.solid.foreground);
  root.style.setProperty("--user-accent-selection-dark", roles.selection.dark.background);
  root.style.setProperty("--user-accent-selection-light", roles.selection.light.background);
  root.style.setProperty("--user-accent-selection-dark-ink", roles.selection.dark.foreground);
  root.style.setProperty("--user-accent-selection-light-ink", roles.selection.light.foreground);
  root.style.setProperty("--user-accent-selection-paper", roles.selection.paper.background);
  return next;
}

export function loadThemeHue(): number {
  migrateWorkbenchPalette();
  return Math.round(
    clamp(readNumber(THEME_HUE_KEY) ?? THEME_HUE_DEFAULT, THEME_HUE_MIN, THEME_HUE_MAX),
  );
}

export function saveThemeHue(value: number) {
  migrateWorkbenchPalette();
  writeNumber(THEME_HUE_KEY, Math.round(clamp(value, THEME_HUE_MIN, THEME_HUE_MAX)));
}

export function loadThemeSaturation(): number {
  migrateWorkbenchPalette();
  return Math.round(
    clamp(
      readNumber(THEME_SATURATION_KEY) ?? THEME_SATURATION_DEFAULT,
      THEME_SATURATION_MIN,
      THEME_SATURATION_MAX,
    ),
  );
}

export function saveThemeSaturation(value: number) {
  migrateWorkbenchPalette();
  writeNumber(
    THEME_SATURATION_KEY,
    Math.round(clamp(value, THEME_SATURATION_MIN, THEME_SATURATION_MAX)),
  );
}

export function loadThemeDarkLightness(): number {
  migrateWorkbenchPalette();
  return Math.round(
    clamp(
      readNumber(THEME_DARK_LIGHTNESS_KEY) ?? THEME_DARK_LIGHTNESS_DEFAULT,
      THEME_DARK_LIGHTNESS_MIN,
      THEME_DARK_LIGHTNESS_MAX,
    ),
  );
}

export function saveThemeDarkLightness(value: number) {
  migrateWorkbenchPalette();
  writeNumber(
    THEME_DARK_LIGHTNESS_KEY,
    Math.round(clamp(value, THEME_DARK_LIGHTNESS_MIN, THEME_DARK_LIGHTNESS_MAX)),
  );
}

export function applyThemeDarkLightness(value: number) {
  const next = Math.round(clamp(value, THEME_DARK_LIGHTNESS_MIN, THEME_DARK_LIGHTNESS_MAX));
  document.documentElement.style.setProperty("--theme-dark-lightness", `${next}%`);
  appliedTint.darkLightness = next;
  refreshAccentRoles();
  applyCanvasBackground();
  return next;
}

/** The chosen canvas tone: the live document value, else the saved one. */
function currentCanvasBackground(): CanvasBackground {
  const live = document.documentElement.dataset.canvasBackgroundPreference;
  if (live === "pure" || live === "tinted") return live;
  try {
    return loadAppearancePreferences().canvasBackground;
  } catch {
    return CANVAS_BACKGROUND_DEFAULT;
  }
}

/**
 * True when the shared canvas is painted pure black (dark) or pure white (light). Custom surface
 * colors win: a tint that matches no theme palette keeps its own tinted canvas, so the Dark-mode
 * lightness and hue the user chose stay visible.
 */
export function canvasBackgroundIsPure(
  preference: CanvasBackground,
  tint: { themeHue: number; themeSaturation: number; themeDarkLightness: number },
) {
  return preference === "pure" && matchThemePalette(tint) !== undefined;
}

/**
 * Publishes the effective canvas tone as `data-canvas-background` on the document; the shared theme
 * (src/styles/index.css) maps "pure" to the canvasPure palette roles. Raised surfaces, borders and
 * text keep deriving from the palette tint, so they stay distinct on pure black or white.
 */
export function applyCanvasBackground(preference: CanvasBackground = currentCanvasBackground()) {
  const root = document.documentElement;
  const pure = canvasBackgroundIsPure(preference, {
    themeHue: appliedTint.hue ?? loadThemeHue(),
    themeSaturation: appliedTint.saturation ?? loadThemeSaturation(),
    themeDarkLightness: appliedTint.darkLightness ?? loadThemeDarkLightness(),
  });
  const next = pure ? "pure" : "tinted";
  if (root.dataset.canvasBackground === next) return pure;
  root.dataset.canvasBackground = next;
  // The opaque native window behind the page follows the canvas it shows through resize gaps.
  if (nativeGlassReady) syncNativeGlass(isLightScheme() ? "light" : "dark");
  return pure;
}

export function applyThemeTint(hue: number, saturation: number) {
  const nextHue = Math.round(clamp(hue, THEME_HUE_MIN, THEME_HUE_MAX));
  const nextSaturation = Math.round(clamp(saturation, THEME_SATURATION_MIN, THEME_SATURATION_MAX));
  document.documentElement.style.setProperty("--theme-hue", String(nextHue));
  document.documentElement.style.setProperty("--theme-saturation", `${nextSaturation}%`);
  appliedTint.hue = nextHue;
  appliedTint.saturation = nextSaturation;
  refreshAccentRoles();
  applyCanvasBackground();
  return { hue: nextHue, saturation: nextSaturation };
}

const THEME_KEYS = new Set([
  ACCENT_COLOR_KEY,
  THEME_HUE_KEY,
  THEME_SATURATION_KEY,
  THEME_DARK_LIGHTNESS_KEY,
  SCHEME_KEY,
]);

const SHARED_APPEARANCE_KEYS = new Set([
  ...THEME_KEYS,
  OPACITY_KEY,
  MAIN_OPACITY_KEY,
  BLUR_KEY,
  BODY_KEY,
  WINDOW_GLASS_KEY,
  CHAT_BACKGROUND_PATH_KEY,
  CHAT_BACKGROUND_OPACITY_KEY,
  CHAT_BACKGROUND_EMPTY_OPACITY_KEY,
  CHAT_BACKGROUND_SESSION_OPACITY_KEY,
  CHAT_BACKGROUND_SCOPE_KEY,
  CHAT_BACKGROUND_BLUR_KEY,
  NEW_THREAD_BACKGROUND_EFFECT_KEY,
  DIFF_PALETTE_KEY,
]);

/** Shared preference notifications; window layout/open state stays local. */
export function subscribeThemeStorage(onChange: (key: string | null) => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key === null || SHARED_APPEARANCE_KEYS.has(event.key)) {
      acceptAppearanceStorageChange(event.key);
      onChange(event.key);
    }
  };
  const onLocal = (event: Event) => onChange((event as CustomEvent<string>).detail);
  window.addEventListener("storage", onStorage);
  window.addEventListener(SHARED_APPEARANCE_EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SHARED_APPEARANCE_EVENT, onLocal);
  };
}

function applyStoredAppearance(key: string | null = null) {
  if (key === null || THEME_KEYS.has(key)) applyStoredTheme();
  if (key === null || key === OPACITY_KEY) applySidebarOpacity(loadSidebarOpacity());
  if (key === null || key === MAIN_OPACITY_KEY || key === OPACITY_KEY)
    applyMainOpacity(loadMainOpacity());
  if (key === null || key === BLUR_KEY) applySidebarBlur(loadSidebarBlur());
  if (key === null || key === BODY_KEY) {
    applyBodyGlass(loadBodyGlass());
    if (nativeGlassReady && IS_LINUX) syncNativeGlass(isLightScheme() ? "light" : "dark");
  }
  if (key === WINDOW_GLASS_KEY && nativeGlassReady && !IS_LINUX)
    syncNativeGlass(isLightScheme() ? "light" : "dark");
  if (
    key === null ||
    key === CHAT_BACKGROUND_PATH_KEY ||
    key === NEW_THREAD_BACKGROUND_EFFECT_KEY
  ) {
    applyChatBackground(loadChatBackgroundPath());
    window.dispatchEvent(new Event(CHAT_BACKGROUND_PATH_CHANGE_EVENT));
  }
  if (
    key === null ||
    key === CHAT_BACKGROUND_EMPTY_OPACITY_KEY ||
    key === CHAT_BACKGROUND_OPACITY_KEY
  )
    applyChatBackgroundEmptyOpacity(loadChatBackgroundEmptyOpacity());
  if (
    key === null ||
    key === CHAT_BACKGROUND_SESSION_OPACITY_KEY ||
    key === CHAT_BACKGROUND_OPACITY_KEY
  )
    applyChatBackgroundSessionOpacity(loadChatBackgroundSessionOpacity());
  if (key === null || key === CHAT_BACKGROUND_SCOPE_KEY)
    applyChatBackgroundScope(loadChatBackgroundScope());
  if (key === null || key === CHAT_BACKGROUND_BLUR_KEY)
    applyChatBackgroundBlur(loadChatBackgroundBlur());
  if (key === null || key === DIFF_PALETTE_KEY) applyDiffPalette(loadDiffPalette());
}

function applyStoredTheme() {
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  applyThemePreference(loadThemePreference());
}

let themeStorageWatching = false;

export function initAppearance() {
  initAppearancePreferences();
  initWorkspaceBackground();
  document.documentElement.classList.toggle("is-mac", IS_MAC);
  applyStoredAppearance();
  watchSystemColorScheme();
  if (!themeStorageWatching) {
    themeStorageWatching = true;
    subscribeThemeStorage(applyStoredAppearance);
    // The readability level is part of the appearance record; this also fires for sibling windows.
    window.addEventListener(APPEARANCE_PREFERENCES_EVENT, () => {
      applyAccentColor(loadAccentColor());
      applyCanvasBackground();
    });
  }
  initUiScale();
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

export function loadThemePreference(): ThemePreference {
  try {
    const raw = readAppearanceValue(SCHEME_KEY);
    return isThemePreference(raw) ? raw : THEME_PREFERENCE_DEFAULT;
  } catch {
    return THEME_PREFERENCE_DEFAULT;
  }
}

export function saveThemePreference(value: ThemePreference) {
  return saveAppearanceValue(SCHEME_KEY, value);
}

function systemQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia("(prefers-color-scheme: light)");
}

function systemColorScheme(): ColorScheme {
  return systemQuery()?.matches ? "light" : "dark";
}

export function resolveColorScheme(value: ThemePreference): ColorScheme {
  return value === "system" ? systemColorScheme() : value;
}

export function isLightScheme(): boolean {
  return document.documentElement.classList.contains("theme-light");
}

export function applyThemePreference(
  value: ThemePreference,
  { animate = false }: { animate?: boolean } = {},
): ColorScheme {
  const next = resolveColorScheme(value);
  if (animate) {
    runThemeTransition(() => applyThemePreference(value), isLightScheme() !== (next === "light"));
    return next;
  }
  document.documentElement.classList.toggle("theme-light", next === "light");
  if (nativeGlassReady) syncNativeGlass(next);
  window.dispatchEvent(new CustomEvent<ColorScheme>(SCHEME_CHANGE_EVENT, { detail: next }));
  const backgroundPath = loadChatBackgroundPath();
  if (backgroundPath && document.documentElement.classList.contains("has-chat-background")) {
    renderChatBackground(backgroundPath);
  }
  return next;
}

/** The page colour the native window sits behind while glass is off. */
function opaqueWindowBackground(): Rgb {
  if (document.documentElement.dataset.canvasBackground === "pure")
    return hslToRgb(0, 0, isLightScheme() ? 100 : 0);
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: number) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  return hslToRgb(
    read("--theme-hue", THEME_HUE_DEFAULT),
    read("--theme-saturation", THEME_SATURATION_DEFAULT),
    read("--background-lightness", THEME_DARK_LIGHTNESS_DEFAULT),
  );
}

/** How long the page takes to reach opaque, from the same token the CSS uses. */
function glassFadeMs(): number {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--motion-feedback-duration")
    .trim();
  const milliseconds = parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
}

/**
 * `has-native-glass` follows the window, not the platform: Linux can turn glass
 * off in dark mode too. Whichever side moves second has to wait for the other,
 * or one of them shows through the gap - so entering glass settles the window
 * first, and leaving it fades the page first. A call that a newer one has
 * overtaken is dropped rather than left to settle last.
 */
export function syncNativeGlass(scheme: ColorScheme) {
  const enabled = scheme === "dark" && (IS_LINUX ? loadBodyGlass() : loadWindowGlass());
  const root = document.documentElement;
  const generation = ++glassSyncGeneration;
  setNativeGlassStatus(nativeGlassError, true);
  const setWindow = () =>
    invoke("set_window_glass_enabled", {
      enabled,
      background: opaqueWindowBackground(),
    });

  if (glassFadeTimer !== undefined) {
    window.clearTimeout(glassFadeTimer);
    glassFadeTimer = undefined;
  }

  if (enabled) {
    void setWindow()
      .then(() => {
        if (generation === glassSyncGeneration) {
          setNativeGlassStatus(false, false);
          root.classList.add("has-native-glass");
        }
      })
      .catch(() => {
        if (generation === glassSyncGeneration) {
          root.classList.remove("has-native-glass");
          setNativeGlassStatus(true, false);
        }
      });
    return;
  }

  root.classList.remove("has-native-glass");
  glassFadeTimer = window.setTimeout(() => {
    glassFadeTimer = undefined;
    void setWindow()
      .then(() => {
        if (generation === glassSyncGeneration) setNativeGlassStatus(false, false);
      })
      .catch(() => {
        if (generation === glassSyncGeneration) setNativeGlassStatus(true, false);
      });
  }, glassFadeMs());
}

/** Applies native transparency once the opaque launch cover can be removed. */
export function activateWindowAppearance() {
  nativeGlassReady = true;
  syncNativeGlass(isLightScheme() ? "light" : "dark");
}

let systemColorSchemeWatching = false;

/** Keeps the "system" preference in sync when the OS flips appearance. */
export function watchSystemColorScheme() {
  if (systemColorSchemeWatching) return;
  const query = systemQuery();
  if (!query) return;
  systemColorSchemeWatching = true;
  query.addEventListener("change", () => {
    const preference = loadThemePreference();
    if (preference === "system") applyThemePreference(preference, { animate: true });
  });
}

export function loadSidebarOpacity(): number {
  return clamp(
    readNumber(OPACITY_KEY) ?? SIDEBAR_OPACITY_DEFAULT,
    SIDEBAR_OPACITY_MIN,
    SIDEBAR_OPACITY_MAX,
  );
}

export function saveSidebarOpacity(value: number) {
  writeNumber(OPACITY_KEY, clamp(value, SIDEBAR_OPACITY_MIN, SIDEBAR_OPACITY_MAX));
}

export function applySidebarOpacity(value: number) {
  const next = clamp(value, SIDEBAR_OPACITY_MIN, SIDEBAR_OPACITY_MAX);
  document.documentElement.style.setProperty("--sidebar-opacity", String(next));
  return next;
}

/** Before this had its own key, the main pane followed the sidebar value. */
export function loadMainOpacity(): number {
  return clamp(
    readNumber(MAIN_OPACITY_KEY) ?? readNumber(OPACITY_KEY) ?? MAIN_OPACITY_DEFAULT,
    MAIN_OPACITY_MIN,
    MAIN_OPACITY_MAX,
  );
}

export function saveMainOpacity(value: number) {
  writeNumber(MAIN_OPACITY_KEY, clamp(value, MAIN_OPACITY_MIN, MAIN_OPACITY_MAX));
}

export function applyMainOpacity(value: number) {
  const next = clamp(value, MAIN_OPACITY_MIN, MAIN_OPACITY_MAX);
  document.documentElement.style.setProperty("--main-opacity", String(next));
  return next;
}

export function loadSidebarBlur(): number {
  return Math.round(
    clamp(readNumber(BLUR_KEY) ?? SIDEBAR_BLUR_DEFAULT, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX),
  );
}

export function saveSidebarBlur(value: number) {
  writeNumber(BLUR_KEY, Math.round(clamp(value, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX)));
}

let pendingSidebarBlur: number | undefined;
let applyingSidebarBlur = false;

async function flushSidebarBlur() {
  if (applyingSidebarBlur) return;
  applyingSidebarBlur = true;
  try {
    while (pendingSidebarBlur !== undefined) {
      const radius = pendingSidebarBlur;
      pendingSidebarBlur = undefined;
      await invoke("set_window_background_blur", { radius }).catch(() => {});
    }
  } finally {
    applyingSidebarBlur = false;
  }
}

export function applySidebarBlur(value: number) {
  const next = Math.round(clamp(value, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX));
  if (IS_MAC) {
    pendingSidebarBlur = next;
    void flushSidebarBlur().catch(() => {});
  }
  return next;
}

export function loadBodyGlass(): boolean {
  return readAppearanceFlag(BODY_KEY, BODY_GLASS_DEFAULT);
}

export function saveBodyGlass(value: boolean) {
  return saveAppearanceValue(BODY_KEY, value ? "1" : "0");
}

export function loadWindowGlass(): boolean {
  return readAppearanceFlag(WINDOW_GLASS_KEY, WINDOW_GLASS_DEFAULT);
}

export function saveWindowGlass(value: boolean) {
  return saveAppearanceValue(WINDOW_GLASS_KEY, value ? "1" : "0");
}

export function applyBodyGlass(value: boolean) {
  document.documentElement.classList.toggle("glass-body", value);
  return value;
}

export function loadChatBackgroundPath(): string | null {
  try {
    return readAppearanceValue(CHAT_BACKGROUND_PATH_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function saveChatBackgroundPath(value: string | null) {
  const saved = saveAppearanceValue(CHAT_BACKGROUND_PATH_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHAT_BACKGROUND_PATH_CHANGE_EVENT));
  return saved;
}

export function subscribeChatBackgroundPath(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHAT_BACKGROUND_PATH_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(CHAT_BACKGROUND_PATH_CHANGE_EVENT, onStoreChange);
}

export function applyChatBackground(path: string | null) {
  const root = document.documentElement;
  root.classList.toggle("has-chat-background", !!path);
  if (!path) {
    clearPreparedNewThreadBackground();
    return null;
  }
  chatBackgroundRevision += 1;
  renderChatBackground(path);
  return path;
}

export function chatBackgroundSrc(path: string | null): string | null {
  return path ? `${convertFileSrc(path)}?v=${chatBackgroundRevision}` : null;
}

function isNewThreadBackgroundEffect(value: unknown): value is NewThreadBackgroundEffect {
  return NEW_THREAD_BACKGROUND_EFFECTS.includes(value as NewThreadBackgroundEffect);
}

export function loadNewThreadBackgroundEffect(): NewThreadBackgroundEffect {
  try {
    const raw = readAppearanceValue(NEW_THREAD_BACKGROUND_EFFECT_KEY);
    return isNewThreadBackgroundEffect(raw) ? raw : NEW_THREAD_BACKGROUND_EFFECT_DEFAULT;
  } catch {
    return NEW_THREAD_BACKGROUND_EFFECT_DEFAULT;
  }
}

export function saveNewThreadBackgroundEffect(effect: NewThreadBackgroundEffect) {
  return saveAppearanceValue(NEW_THREAD_BACKGROUND_EFFECT_KEY, effect);
}

function renderChatBackground(path: string, effect = loadNewThreadBackgroundEffect()) {
  const src = chatBackgroundSrc(path);
  if (!src) return;
  void applyPreparedNewThreadBackground(
    `${path}?v=${chatBackgroundRevision}`,
    src,
    effect,
    isLightScheme(),
  );
}

export function applyNewThreadBackgroundEffect(effect: NewThreadBackgroundEffect) {
  const path = loadChatBackgroundPath();
  if (path) renderChatBackground(path, effect);
  return effect;
}

export function setNewThreadBackgroundEffect(effect: NewThreadBackgroundEffect) {
  saveNewThreadBackgroundEffect(effect);
  applyNewThreadBackgroundEffect(effect);
  window.dispatchEvent(new Event(CHAT_BACKGROUND_PATH_CHANGE_EVENT));
}

export function loadChatBackgroundOpacity(): number {
  return loadChatBackgroundEmptyOpacity();
}

export function saveChatBackgroundOpacity(value: number) {
  const next = clamp(value, CHAT_BACKGROUND_OPACITY_MIN, CHAT_BACKGROUND_OPACITY_MAX);
  saveChatBackgroundEmptyOpacity(next);
  saveChatBackgroundSessionOpacity(next);
  writeNumber(CHAT_BACKGROUND_OPACITY_KEY, next);
}

export function applyChatBackgroundOpacity(value: number) {
  const next = applyChatBackgroundEmptyOpacity(value);
  applyChatBackgroundSessionOpacity(next);
  return next;
}

function loadChatBackgroundOpacityValue(key: string): number {
  const next = clamp(
    readNumber(key) ?? readNumber(CHAT_BACKGROUND_OPACITY_KEY) ?? CHAT_BACKGROUND_OPACITY_DEFAULT,
    CHAT_BACKGROUND_OPACITY_MIN,
    CHAT_BACKGROUND_OPACITY_MAX,
  );
  return next;
}

function saveChatBackgroundOpacityValue(key: string, value: number) {
  writeNumber(key, clamp(value, CHAT_BACKGROUND_OPACITY_MIN, CHAT_BACKGROUND_OPACITY_MAX));
}

function applyChatBackgroundOpacityValue(variable: string, value: number) {
  const next = clamp(value, CHAT_BACKGROUND_OPACITY_MIN, CHAT_BACKGROUND_OPACITY_MAX);
  document.documentElement.style.setProperty(variable, String(next));
  return next;
}

export function loadChatBackgroundEmptyOpacity(): number {
  return loadChatBackgroundOpacityValue(CHAT_BACKGROUND_EMPTY_OPACITY_KEY);
}

export function saveChatBackgroundEmptyOpacity(value: number) {
  saveChatBackgroundOpacityValue(CHAT_BACKGROUND_EMPTY_OPACITY_KEY, value);
}

export function applyChatBackgroundEmptyOpacity(value: number) {
  return applyChatBackgroundOpacityValue("--chat-background-empty-opacity", value);
}

export function loadChatBackgroundSessionOpacity(): number {
  return loadChatBackgroundOpacityValue(CHAT_BACKGROUND_SESSION_OPACITY_KEY);
}

export function saveChatBackgroundSessionOpacity(value: number) {
  saveChatBackgroundOpacityValue(CHAT_BACKGROUND_SESSION_OPACITY_KEY, value);
}

export function applyChatBackgroundSessionOpacity(value: number) {
  return applyChatBackgroundOpacityValue("--chat-background-session-opacity", value);
}

export function loadChatBackgroundBlur(): number {
  return Math.round(
    clamp(
      readNumber(CHAT_BACKGROUND_BLUR_KEY) ?? CHAT_BACKGROUND_BLUR_DEFAULT,
      CHAT_BACKGROUND_BLUR_MIN,
      CHAT_BACKGROUND_BLUR_MAX,
    ),
  );
}

export function saveChatBackgroundBlur(value: number) {
  writeNumber(
    CHAT_BACKGROUND_BLUR_KEY,
    Math.round(clamp(value, CHAT_BACKGROUND_BLUR_MIN, CHAT_BACKGROUND_BLUR_MAX)),
  );
}

/** Zero drops the filter entirely so an unblurred image costs nothing extra. */
export function applyChatBackgroundBlur(value: number) {
  const next = Math.round(clamp(value, CHAT_BACKGROUND_BLUR_MIN, CHAT_BACKGROUND_BLUR_MAX));
  const root = document.documentElement;
  root.style.setProperty("--chat-background-blur", `${next}px`);
  root.classList.toggle("chat-background-blurred", next > 0);
  return next;
}

function isChatBackgroundScope(value: unknown): value is ChatBackgroundScope {
  return value === "empty" || value === "all";
}

export function loadChatBackgroundScope(): ChatBackgroundScope {
  try {
    const raw = readAppearanceValue(CHAT_BACKGROUND_SCOPE_KEY);
    return isChatBackgroundScope(raw) ? raw : CHAT_BACKGROUND_SCOPE_DEFAULT;
  } catch {
    return CHAT_BACKGROUND_SCOPE_DEFAULT;
  }
}

export function saveChatBackgroundScope(value: ChatBackgroundScope) {
  return saveAppearanceValue(CHAT_BACKGROUND_SCOPE_KEY, value);
}

export function applyChatBackgroundScope(value: ChatBackgroundScope) {
  document.documentElement.classList.toggle("chat-background-empty-only", value === "empty");
  return value;
}

function isDiffPalette(value: unknown): value is DiffPalette {
  return value === "default" || value === "colorblind" || value === "high-contrast";
}

export function loadDiffPalette(): DiffPalette {
  try {
    const raw = readAppearanceValue(DIFF_PALETTE_KEY);
    return isDiffPalette(raw) ? raw : DIFF_PALETTE_DEFAULT;
  } catch {
    return DIFF_PALETTE_DEFAULT;
  }
}

export function saveDiffPalette(value: DiffPalette) {
  return saveAppearanceValue(DIFF_PALETTE_KEY, value);
}

/** Swaps the diff color tokens in index.css via an html class. */
export function applyDiffPalette(value: DiffPalette) {
  const root = document.documentElement.classList;
  root.toggle("diff-palette-colorblind", value === "colorblind");
  root.toggle("diff-palette-high-contrast", value === "high-contrast");
  return value;
}

function isSidebarTabId(value: unknown): value is SidebarTabId {
  return value === "files" || value === "sessions" || value === "changes" || value === "inbox";
}

export function loadProjectRailOpen(): boolean {
  return readFlag(PROJECT_RAIL_OPEN_KEY) ?? true;
}

export function saveProjectRailOpen(value: boolean) {
  writeFlag(PROJECT_RAIL_OPEN_KEY, value);
}

export function loadSessionSidebarOpen(): boolean {
  return readFlag(SESSION_SIDEBAR_OPEN_KEY) ?? true;
}

export function saveSessionSidebarOpen(value: boolean) {
  writeFlag(SESSION_SIDEBAR_OPEN_KEY, value);
}

export function loadSidebarTabOrder(): SidebarTabId[] {
  try {
    const raw = readAppearanceValue(SIDEBAR_TAB_ORDER_KEY);
    if (!raw) return [...DEFAULT_SIDEBAR_TAB_ORDER];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SIDEBAR_TAB_ORDER];
    const next = parsed.filter(isSidebarTabId);
    for (const id of DEFAULT_SIDEBAR_TAB_ORDER) {
      if (!next.includes(id)) next.push(id);
    }
    return next.length === DEFAULT_SIDEBAR_TAB_ORDER.length ? next : [...DEFAULT_SIDEBAR_TAB_ORDER];
  } catch {
    return [...DEFAULT_SIDEBAR_TAB_ORDER];
  }
}

export function saveSidebarTabOrder(order: SidebarTabId[]) {
  try {
    localStorage.setItem(SIDEBAR_TAB_ORDER_KEY, JSON.stringify(order));
  } catch {
    // private mode / quota
  }
}

export function loadProjectRailWidth(): number {
  return Math.round(
    clamp(
      readNumber(PROJECT_RAIL_WIDTH_KEY) ?? PROJECT_RAIL_WIDTH_DEFAULT,
      PROJECT_RAIL_WIDTH_MIN,
      PROJECT_RAIL_WIDTH_MAX,
    ),
  );
}

export function saveProjectRailWidth(value: number) {
  writeNumber(
    PROJECT_RAIL_WIDTH_KEY,
    Math.round(clamp(value, PROJECT_RAIL_WIDTH_MIN, PROJECT_RAIL_WIDTH_MAX)),
  );
}

export function loadSessionSidebarWidth(): number {
  return Math.round(
    clamp(
      readNumber(SESSION_SIDEBAR_WIDTH_KEY) ?? SESSION_SIDEBAR_WIDTH_DEFAULT,
      SESSION_SIDEBAR_WIDTH_MIN,
      SESSION_SIDEBAR_WIDTH_MAX,
    ),
  );
}

export function saveSessionSidebarWidth(value: number) {
  writeNumber(
    SESSION_SIDEBAR_WIDTH_KEY,
    Math.round(clamp(value, SESSION_SIDEBAR_WIDTH_MIN, SESSION_SIDEBAR_WIDTH_MAX)),
  );
}

function isTranscriptLayout(value: unknown): value is TranscriptLayout {
  return value === "full" || value === "chat";
}

export function loadTranscriptLayout(): TranscriptLayout {
  try {
    const raw = readAppearanceValue(TRANSCRIPT_LAYOUT_KEY);
    return isTranscriptLayout(raw) ? raw : TRANSCRIPT_LAYOUT_DEFAULT;
  } catch {
    return TRANSCRIPT_LAYOUT_DEFAULT;
  }
}

export function saveTranscriptLayout(value: TranscriptLayout) {
  const next = isTranscriptLayout(value) ? value : TRANSCRIPT_LAYOUT_DEFAULT;
  try {
    localStorage.setItem(TRANSCRIPT_LAYOUT_KEY, next);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TranscriptLayout>(TRANSCRIPT_LAYOUT_CHANGE_EVENT, {
      detail: next,
    }),
  );
}

export const subscribeTranscriptLayout = (onChange: () => void) =>
  subscribePreferenceChanges([TRANSCRIPT_LAYOUT_KEY], TRANSCRIPT_LAYOUT_CHANGE_EVENT, onChange);

function isChangesView(value: unknown): value is ChangesView {
  return value === "list" || value === "tree";
}

export function loadChangesView(): ChangesView {
  try {
    const raw = readAppearanceValue(CHANGES_VIEW_KEY);
    return isChangesView(raw) ? raw : CHANGES_VIEW_DEFAULT;
  } catch {
    return CHANGES_VIEW_DEFAULT;
  }
}

export function saveChangesView(value: ChangesView) {
  try {
    localStorage.setItem(CHANGES_VIEW_KEY, value);
  } catch {
    // private mode / quota
  }
}

export function loadTranscriptAnchor(): boolean {
  return readFlag(TRANSCRIPT_ANCHOR_KEY) ?? TRANSCRIPT_ANCHOR_DEFAULT;
}

export function saveTranscriptAnchor(value: boolean) {
  writeFlag(TRANSCRIPT_ANCHOR_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(TRANSCRIPT_ANCHOR_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export const subscribeTranscriptAnchor = (onChange: () => void) =>
  subscribePreferenceChanges([TRANSCRIPT_ANCHOR_KEY], TRANSCRIPT_ANCHOR_CHANGE_EVENT, onChange);

export function loadShowExcludedFiles(): boolean {
  return readFlag(SHOW_EXCLUDED_FILES_KEY) ?? SHOW_EXCLUDED_FILES_DEFAULT;
}

export function saveShowExcludedFiles(value: boolean) {
  return writeAppearanceValue(
    SHOW_EXCLUDED_FILES_KEY,
    value ? "1" : "0",
    "show-excluded-files",
    () => {
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event(SHOW_EXCLUDED_FILES_CHANGE_EVENT));
    },
    false,
  );
}

export function subscribeShowExcludedFiles(onStoreChange: () => void) {
  return subscribePreferenceChanges(
    [SHOW_EXCLUDED_FILES_KEY],
    SHOW_EXCLUDED_FILES_CHANGE_EVENT,
    () => {
      acceptAppearanceStorageChange(SHOW_EXCLUDED_FILES_KEY);
      onStoreChange();
    },
  );
}
