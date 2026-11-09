import {
  loadSessionListDisplay,
  type SessionListDensity,
} from "../../sessions/public/sessionListDisplay";
import {
  loadAccentColor,
  loadBodyGlass,
  loadChatBackgroundBlur,
  loadChatBackgroundEmptyOpacity,
  loadChatBackgroundScope,
  loadChatBackgroundSessionOpacity,
  loadDiffPalette,
  loadMainOpacity,
  loadNewThreadBackgroundEffect,
  loadSidebarBlur,
  loadSidebarOpacity,
  loadThemeDarkLightness,
  loadThemeHue,
  loadThemePreference,
  loadThemeSaturation,
  loadWindowGlass,
  type ChatBackgroundScope,
  type DiffPalette,
  type NewThreadBackgroundEffect,
  type ThemePreference,
} from "./appearance";
import { loadAppearancePreferences, normalizeAppearancePreferences } from "./appearancePreferences";
import type { AppearancePreferences } from "./appearancePreferences";
import { loadDecorativeMotionEnabled } from "./decorativeMotion";
import {
  loadInteractionTint,
  normalizeInteractionTint,
  type InteractionTint,
} from "./interactionTint";
import {
  loadLiveBackground,
  loadLiveBackgroundIntensity,
  type LiveBackground,
} from "./liveBackground";
import { loadScrollbarStyle, normalizeScrollbarStyle, type ScrollbarStyle } from "./scrollbarStyle";
import {
  loadCrewGrowthEnabled,
  loadCrewSceneEnabled,
  loadCrewTheme,
  loadTabAnimationsEnabled,
  type CrewTheme,
} from "./settings";
import { APPEARANCE_CHOICES, APPEARANCE_RANGES } from "./themeRanges";
import { loadUiScale } from "./uiScale";
import {
  loadWorkingIndicator,
  normalizeWorkingIndicator,
  type WorkingIndicator,
} from "./workingIndicator";
import {
  loadWorkspaceBackground,
  normalizeWorkspaceBackground,
  type WorkspaceBackground,
} from "./workspaceBackground";

/**
 * Every Appearance setting a saved theme restores, grouped like the Appearance tabs. A group or
 * field that failed validation when read is simply absent, and applying a snapshot leaves that
 * setting as it is. The chat background image itself is not part of it: saved themes refer to a
 * library image by id.
 */
export type AppearanceSnapshot = {
  scheme?: ThemePreference;
  hue?: number;
  saturation?: number;
  darkLightness?: number;
  /** `null` is the default accent. */
  accent?: string | null;
  preferences?: AppearancePreferences;
  gradient?: WorkspaceBackground;
  uiScale?: number;
  diffPalette?: DiffPalette;
  sessionList?: {
    density: SessionListDensity;
    showModel: boolean;
    showBranch: boolean;
  };
  scrollbar?: ScrollbarStyle;
  tint?: InteractionTint;
  working?: WorkingIndicator;
  glass?: {
    sidebarOpacity: number;
    mainOpacity: number;
    sidebarBlur: number;
    bodyGlass: boolean;
    windowGlass: boolean;
  };
  live?: { scene: LiveBackground; intensity: number };
  image?: {
    scope: ChatBackgroundScope;
    emptyOpacity: number;
    sessionOpacity: number;
    blur: number;
    effect: NewThreadBackgroundEffect;
  };
  motion?: {
    crewTheme: CrewTheme;
    showCrew: boolean;
    crewGrowth: boolean;
    decorative: boolean;
    tabAnimations: boolean;
  };
};

/** The current Appearance settings, read from their stores. */
export function captureAppearanceSnapshot(): AppearanceSnapshot {
  const display = loadSessionListDisplay();
  return {
    scheme: loadThemePreference(),
    hue: loadThemeHue(),
    saturation: loadThemeSaturation(),
    darkLightness: loadThemeDarkLightness(),
    accent: loadAccentColor(),
    preferences: loadAppearancePreferences(),
    gradient: loadWorkspaceBackground(),
    uiScale: loadUiScale(),
    diffPalette: loadDiffPalette(),
    sessionList: {
      density: display.density,
      showModel: display.showModel,
      showBranch: display.showBranch,
    },
    scrollbar: loadScrollbarStyle(),
    tint: loadInteractionTint(),
    working: loadWorkingIndicator(),
    glass: {
      sidebarOpacity: loadSidebarOpacity(),
      mainOpacity: loadMainOpacity(),
      sidebarBlur: loadSidebarBlur(),
      bodyGlass: loadBodyGlass(),
      windowGlass: loadWindowGlass(),
    },
    live: {
      scene: loadLiveBackground(),
      intensity: loadLiveBackgroundIntensity(),
    },
    image: {
      scope: loadChatBackgroundScope(),
      emptyOpacity: loadChatBackgroundEmptyOpacity(),
      sessionOpacity: loadChatBackgroundSessionOpacity(),
      blur: loadChatBackgroundBlur(),
      effect: loadNewThreadBackgroundEffect(),
    },
    motion: {
      crewTheme: loadCrewTheme(),
      showCrew: loadCrewSceneEnabled(),
      crewGrowth: loadCrewGrowthEnabled(),
      decorative: loadDecorativeMotionEnabled(),
      tabAnimations: loadTabAnimationsEnabled(),
    },
  };
}

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown, range: { min: number; max: number }): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(range.max, Math.max(range.min, value))
    : undefined;
const choice = <T extends string | number>(values: readonly T[], value: unknown): T | undefined =>
  values.includes(value as T) ? (value as T) : undefined;
const flag = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

/** Keeps `group` only when every field of it is valid. */
function whole<T extends Raw>(
  raw: unknown,
  read: (raw: Raw) => { [K in keyof T]: T[K] | undefined },
) {
  if (!isRecord(raw)) return undefined;
  const fields = read(raw);
  return Object.values(fields).every((value) => value !== undefined) ? (fields as T) : undefined;
}

const ACCENT = /^#[0-9a-f]{6}$/i;
const SCHEMES: readonly ThemePreference[] = ["system", "light", "dark"];
const DENSITIES: readonly SessionListDensity[] = APPEARANCE_CHOICES.rowDensity;

/**
 * Reads a stored snapshot. Values outside their range are clamped and unknown choices dropped
 * field by field; a group with any invalid field is left out, so applying never half-sets it.
 */
export function normalizeAppearanceSnapshot(input: unknown): AppearanceSnapshot {
  const raw: Raw = isRecord(input) ? input : {};
  const snapshot: AppearanceSnapshot = {};
  const put = <K extends keyof AppearanceSnapshot>(key: K, value: AppearanceSnapshot[K]) => {
    if (value !== undefined) snapshot[key] = value;
  };
  put("scheme", choice(SCHEMES, raw.scheme));
  put("hue", number(raw.hue, { min: 0, max: 360 }));
  put("saturation", number(raw.saturation, { min: 0, max: 100 }));
  put("darkLightness", number(raw.darkLightness, APPEARANCE_RANGES.darkLightness));
  if (raw.accent === null) snapshot.accent = null;
  else if (typeof raw.accent === "string" && ACCENT.test(raw.accent)) snapshot.accent = raw.accent;
  if (isRecord(raw.preferences))
    snapshot.preferences = normalizeAppearancePreferences(raw.preferences);
  if (isRecord(raw.gradient)) snapshot.gradient = normalizeWorkspaceBackground(raw.gradient);
  put("uiScale", number(raw.uiScale, APPEARANCE_RANGES.uiScale));
  put("diffPalette", choice(APPEARANCE_CHOICES.diffPalette, raw.diffPalette));
  put(
    "sessionList",
    whole<NonNullable<AppearanceSnapshot["sessionList"]>>(raw.sessionList, (list) => ({
      density: choice(DENSITIES, list.density),
      showModel: flag(list.showModel),
      showBranch: flag(list.showBranch),
    })),
  );
  if (isRecord(raw.scrollbar)) snapshot.scrollbar = normalizeScrollbarStyle(raw.scrollbar);
  if (isRecord(raw.tint)) snapshot.tint = normalizeInteractionTint(raw.tint);
  if (isRecord(raw.working)) snapshot.working = normalizeWorkingIndicator(raw.working);
  put(
    "glass",
    whole<NonNullable<AppearanceSnapshot["glass"]>>(raw.glass, (glass) => ({
      sidebarOpacity: number(glass.sidebarOpacity, APPEARANCE_RANGES.sidebarOpacity),
      mainOpacity: number(glass.mainOpacity, APPEARANCE_RANGES.mainOpacity),
      sidebarBlur: number(glass.sidebarBlur, APPEARANCE_RANGES.sidebarBlur),
      bodyGlass: flag(glass.bodyGlass),
      windowGlass: flag(glass.windowGlass),
    })),
  );
  put(
    "live",
    whole<NonNullable<AppearanceSnapshot["live"]>>(raw.live, (live) => ({
      scene: choice(APPEARANCE_CHOICES.liveScene, live.scene),
      intensity: number(live.intensity, APPEARANCE_RANGES.liveIntensity),
    })),
  );
  put(
    "image",
    whole<NonNullable<AppearanceSnapshot["image"]>>(raw.image, (image) => ({
      scope: choice(APPEARANCE_CHOICES.chatBackgroundScope, image.scope),
      emptyOpacity: number(image.emptyOpacity, APPEARANCE_RANGES.chatBackgroundOpacity),
      sessionOpacity: number(image.sessionOpacity, APPEARANCE_RANGES.chatBackgroundOpacity),
      blur: number(image.blur, APPEARANCE_RANGES.chatBackgroundBlur),
      effect: choice(APPEARANCE_CHOICES.newThreadEffect, image.effect),
    })),
  );
  put(
    "motion",
    whole<NonNullable<AppearanceSnapshot["motion"]>>(raw.motion, (motion) => ({
      crewTheme: choice(APPEARANCE_CHOICES.crewTheme, motion.crewTheme),
      showCrew: flag(motion.showCrew),
      crewGrowth: flag(motion.crewGrowth),
      decorative: flag(motion.decorative),
      tabAnimations: flag(motion.tabAnimations),
    })),
  );
  return snapshot;
}
