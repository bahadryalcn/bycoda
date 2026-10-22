// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCENT_COLOR_DEFAULT,
  DIFF_PALETTE_DEFAULT,
  loadDiffPalette,
  saveDiffPalette,
  applyDiffPalette,
  CHAT_BACKGROUND_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  loadChatBackgroundOpacity,
  loadAccentColor,
  loadChatBackgroundPath,
  loadChatBackgroundScope,
  loadNewThreadBackgroundEffect,
  loadTranscriptLayout,
  saveChatBackgroundOpacity,
  saveAccentColor,
  saveChatBackgroundPath,
  saveChatBackgroundScope,
  saveNewThreadBackgroundEffect,
  saveTranscriptLayout,
  TRANSCRIPT_LAYOUT_DEFAULT,
  loadTranscriptAnchor,
  saveTranscriptAnchor,
  TRANSCRIPT_ANCHOR_DEFAULT,
  loadShowExcludedFiles,
  saveShowExcludedFiles,
  SHOW_EXCLUDED_FILES_DEFAULT,
  loadThemePreference,
  loadThemeDarkLightness,
  saveThemeDarkLightness,
  saveThemePreference,
  resolveColorScheme,
  THEME_PREFERENCE_DEFAULT,
  THEME_DARK_LIGHTNESS_DEFAULT,
  loadThemeHue,
  loadThemeSaturation,
  migrateWorkbenchPalette,
  NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  loadProjectRailWidth,
  saveProjectRailWidth,
  PROJECT_RAIL_COMPACT_WIDTH,
  PROJECT_RAIL_WIDTH_DEFAULT,
  PROJECT_RAIL_WIDTH_MAX,
  PROJECT_RAIL_WIDTH_MIN,
  loadSessionSidebarWidth,
  saveSessionSidebarWidth,
  SESSION_SIDEBAR_WIDTH_DEFAULT,
  SESSION_SIDEBAR_WIDTH_MAX,
  SESSION_SIDEBAR_WIDTH_MIN,
} from "./appearance";

const KEY = "bycoda.transcriptLayout";
const ACCENT_COLOR_KEY = "bycoda.accentColor";
const SCHEME_KEY = "bycoda.colorScheme";
const ANCHOR_KEY = "bycoda.transcriptAnchor";
const SHOW_EXCLUDED_FILES_KEY = "bycoda.showExcludedFiles";
const CHAT_BACKGROUND_PATH_KEY = "bycoda.chatBackgroundPath";
const CHAT_BACKGROUND_OPACITY_KEY = "bycoda.chatBackgroundOpacity";
const CHAT_BACKGROUND_SCOPE_KEY = "bycoda.chatBackgroundScope";
const NEW_THREAD_BACKGROUND_EFFECT_KEY = "bycoda.newThreadBackgroundEffect";
const THEME_DARK_LIGHTNESS_KEY = "bycoda.themeDarkLightness";
const DIFF_PALETTE_KEY = "bycoda.diffPalette";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("accent color setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(ACCENT_COLOR_KEY);
  });

  it("defaults to a restrained cool-gray accent", () => {
    expect(ACCENT_COLOR_DEFAULT).toBe("#A3ACB8");
    expect(loadAccentColor()).toBe(ACCENT_COLOR_DEFAULT);
  });

  it("migrates the previous shipped palette while preserving custom colors", () => {
    localStorage.setItem("bycoda.themeHue", "330");
    localStorage.setItem("bycoda.themeSaturation", "10");
    localStorage.setItem(THEME_DARK_LIGHTNESS_KEY, "9");
    localStorage.setItem(ACCENT_COLOR_KEY, "#B39963");
    migrateWorkbenchPalette();
    expect(loadThemeHue()).toBe(216);
    expect(loadThemeSaturation()).toBe(24);
    expect(loadThemeDarkLightness()).toBe(4);
    expect(loadAccentColor()).toBe(ACCENT_COLOR_DEFAULT);

    // After migration an explicit choice matching the former palette stays put.
    localStorage.setItem("bycoda.themeHue", "330");
    localStorage.setItem(ACCENT_COLOR_KEY, "#B39963");
    expect(loadThemeHue()).toBe(330);
    expect(loadAccentColor()).toBe("#b39963");
  });

  it("does not replace a personalized tint or accent during migration", () => {
    localStorage.setItem("bycoda.themeHue", "270");
    localStorage.setItem("bycoda.themeSaturation", "10");
    localStorage.setItem(THEME_DARK_LIGHTNESS_KEY, "9");
    localStorage.setItem(ACCENT_COLOR_KEY, "#778899");
    expect(loadThemeHue()).toBe(270);
    expect(loadThemeSaturation()).toBe(10);
    expect(loadThemeDarkLightness()).toBe(9);
    expect(loadAccentColor()).toBe("#778899");
  });

  it("persists normalized hex colors and clears default or invalid values", () => {
    saveAccentColor("#AABBCC");
    expect(localStorage.getItem(ACCENT_COLOR_KEY)).toBe("#aabbcc");
    expect(loadAccentColor()).toBe("#aabbcc");

    saveAccentColor(ACCENT_COLOR_DEFAULT);
    expect(localStorage.getItem(ACCENT_COLOR_KEY)).toBeNull();

    saveAccentColor("tomato");
    expect(localStorage.getItem(ACCENT_COLOR_KEY)).toBeNull();
    expect(loadAccentColor()).toBe(ACCENT_COLOR_DEFAULT);
  });
});

describe("transcript layout setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("defaults to chat", () => {
    expect(TRANSCRIPT_LAYOUT_DEFAULT).toBe("chat");
    expect(loadTranscriptLayout()).toBe("chat");
  });

  it("persists an explicit full width layout", () => {
    saveTranscriptLayout("full");
    expect(localStorage.getItem(KEY)).toBe("full");
    expect(loadTranscriptLayout()).toBe("full");
    saveTranscriptLayout("chat");
    expect(loadTranscriptLayout()).toBe("chat");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(KEY, "bubbles");
    expect(loadTranscriptLayout()).toBe("chat");
  });
});

describe("transcript prompt-to-top setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(ANCHOR_KEY);
  });

  it("defaults to on", () => {
    expect(TRANSCRIPT_ANCHOR_DEFAULT).toBe(true);
    expect(loadTranscriptAnchor()).toBe(true);
  });

  it("persists across loads", () => {
    saveTranscriptAnchor(true);
    expect(loadTranscriptAnchor()).toBe(true);
    saveTranscriptAnchor(false);
    expect(loadTranscriptAnchor()).toBe(false);
  });
});

describe("show excluded files setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(SHOW_EXCLUDED_FILES_KEY);
  });

  it("defaults to off", () => {
    expect(SHOW_EXCLUDED_FILES_DEFAULT).toBe(false);
    expect(loadShowExcludedFiles()).toBe(false);
  });

  it("persists across loads", () => {
    saveShowExcludedFiles(true);
    expect(loadShowExcludedFiles()).toBe(true);
    saveShowExcludedFiles(false);
    expect(loadShowExcludedFiles()).toBe(false);
  });
});

describe("diff palette setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(DIFF_PALETTE_KEY);
  });

  it("defaults, persists, and validates the palette", () => {
    expect(DIFF_PALETTE_DEFAULT).toBe("default");
    expect(loadDiffPalette()).toBe("default");
    saveDiffPalette("colorblind");
    expect(loadDiffPalette()).toBe("colorblind");
    saveDiffPalette("high-contrast");
    expect(loadDiffPalette()).toBe("high-contrast");
    saveDiffPalette("default");
    expect(localStorage.getItem(DIFF_PALETTE_KEY)).toBe("default");
    localStorage.setItem(DIFF_PALETTE_KEY, "rainbow");
    expect(loadDiffPalette()).toBe(DIFF_PALETTE_DEFAULT);
  });
});

describe("diff palette classes", () => {
  const COLORBLIND = "diff-palette-colorblind";
  const HIGH_CONTRAST = "diff-palette-high-contrast";
  const classes = () => document.documentElement.classList;

  beforeEach(() => {
    document.documentElement.className = "";
  });

  it("sets only the colorblind class", () => {
    classes().add(HIGH_CONTRAST);
    applyDiffPalette("colorblind");
    expect(classes().contains(COLORBLIND)).toBe(true);
    expect(classes().contains(HIGH_CONTRAST)).toBe(false);
  });

  it("sets only the high-contrast class", () => {
    classes().add(COLORBLIND);
    applyDiffPalette("high-contrast");
    expect(classes().contains(HIGH_CONTRAST)).toBe(true);
    expect(classes().contains(COLORBLIND)).toBe(false);
  });

  it("clears both classes for the default palette", () => {
    classes().add(COLORBLIND, HIGH_CONTRAST, "theme-light");
    applyDiffPalette("default");
    expect(classes().contains(COLORBLIND)).toBe(false);
    expect(classes().contains(HIGH_CONTRAST)).toBe(false);
    expect(classes().contains("theme-light")).toBe(true);
  });
});

describe("chat background setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(CHAT_BACKGROUND_PATH_KEY);
    localStorage.removeItem(CHAT_BACKGROUND_OPACITY_KEY);
    localStorage.removeItem(CHAT_BACKGROUND_SCOPE_KEY);
    localStorage.removeItem(NEW_THREAD_BACKGROUND_EFFECT_KEY);
  });

  it("stores and clears the app-owned background path", () => {
    expect(loadChatBackgroundPath()).toBeNull();
    saveChatBackgroundPath("/app-data/backgrounds/chat-background.webp");
    expect(loadChatBackgroundPath()).toBe("/app-data/backgrounds/chat-background.webp");
    saveChatBackgroundPath(null);
    expect(loadChatBackgroundPath()).toBeNull();
  });

  it("defaults and clamps background visibility", () => {
    expect(loadChatBackgroundOpacity()).toBe(CHAT_BACKGROUND_OPACITY_DEFAULT);
    saveChatBackgroundOpacity(1);
    expect(loadChatBackgroundOpacity()).toBe(0.65);
    saveChatBackgroundOpacity(0);
    expect(loadChatBackgroundOpacity()).toBe(0.05);
  });

  it("persists where the background is shown", () => {
    expect(loadChatBackgroundScope()).toBe(CHAT_BACKGROUND_SCOPE_DEFAULT);
    saveChatBackgroundScope("empty");
    expect(loadChatBackgroundScope()).toBe("empty");
    saveChatBackgroundScope("all");
    expect(loadChatBackgroundScope()).toBe("all");
    localStorage.setItem(CHAT_BACKGROUND_SCOPE_KEY, "transcript");
    expect(loadChatBackgroundScope()).toBe(CHAT_BACKGROUND_SCOPE_DEFAULT);
  });

  it("defaults, persists, and validates the new-thread background effect", () => {
    expect(loadNewThreadBackgroundEffect()).toBe(NEW_THREAD_BACKGROUND_EFFECT_DEFAULT);
    for (const effect of [
      "none",
      "dither",
      "ascii",
      "halftone",
      "scanlines",
      "gradient-blur",
    ] as const) {
      saveNewThreadBackgroundEffect(effect);
      expect(loadNewThreadBackgroundEffect()).toBe(effect);
    }
    localStorage.setItem(NEW_THREAD_BACKGROUND_EFFECT_KEY, "blur");
    expect(loadNewThreadBackgroundEffect()).toBe(NEW_THREAD_BACKGROUND_EFFECT_DEFAULT);
  });
});

function mockSystemScheme(scheme: "dark" | "light") {
  Object.defineProperty(globalThis, "window", {
    value: {
      matchMedia: (query: string) => ({
        matches: query.includes("light") && scheme === "light",
      }),
    },
    configurable: true,
  });
}

describe("theme preference setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(SCHEME_KEY);
    Reflect.deleteProperty(globalThis, "window");
  });

  it("defaults to dark", () => {
    expect(THEME_PREFERENCE_DEFAULT).toBe("dark");
    expect(loadThemePreference()).toBe("dark");
  });

  it("persists each preference", () => {
    for (const value of ["system", "light", "dark"] as const) {
      saveThemePreference(value);
      expect(localStorage.getItem(SCHEME_KEY)).toBe(value);
      expect(loadThemePreference()).toBe(value);
    }
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(SCHEME_KEY, "solarized");
    expect(loadThemePreference()).toBe(THEME_PREFERENCE_DEFAULT);
  });

  it("resolves system against the OS appearance", () => {
    mockSystemScheme("light");
    expect(resolveColorScheme("system")).toBe("light");
    mockSystemScheme("dark");
    expect(resolveColorScheme("system")).toBe("dark");
  });

  it("keeps explicit picks regardless of the OS appearance", () => {
    mockSystemScheme("light");
    expect(resolveColorScheme("dark")).toBe("dark");
    mockSystemScheme("dark");
    expect(resolveColorScheme("light")).toBe("light");
  });

  it("falls back to dark without matchMedia", () => {
    expect(resolveColorScheme("system")).toBe("dark");
  });
});

describe("dark theme lightness setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(THEME_DARK_LIGHTNESS_KEY);
  });

  it("defaults to the existing dark background lightness", () => {
    expect(THEME_DARK_LIGHTNESS_DEFAULT).toBe(4);
    expect(loadThemeDarkLightness()).toBe(4);
  });

  it("persists true black and clamps overly light values", () => {
    saveThemeDarkLightness(0);
    expect(loadThemeDarkLightness()).toBe(0);
    saveThemeDarkLightness(100);
    expect(loadThemeDarkLightness()).toBe(30);
  });
});

describe("project rail width", () => {
  const WIDTH_KEY = "bycoda.projectRailWidth";
  beforeEach(() => localStorage.removeItem(WIDTH_KEY));

  it("goes down to an icon-only strip", () => {
    expect(PROJECT_RAIL_WIDTH_MIN).toBe(56);
    expect(PROJECT_RAIL_COMPACT_WIDTH).toBeGreaterThan(PROJECT_RAIL_WIDTH_MIN);
    expect(PROJECT_RAIL_COMPACT_WIDTH).toBeLessThan(PROJECT_RAIL_WIDTH_DEFAULT);
  });

  it("defaults, and keeps widths saved before the lower minimum", () => {
    expect(loadProjectRailWidth()).toBe(PROJECT_RAIL_WIDTH_DEFAULT);
    localStorage.setItem(WIDTH_KEY, "260");
    expect(loadProjectRailWidth()).toBe(260);
    localStorage.setItem(WIDTH_KEY, "180");
    expect(loadProjectRailWidth()).toBe(180);
  });

  it("clamps saved and loaded widths into range", () => {
    saveProjectRailWidth(20);
    expect(localStorage.getItem(WIDTH_KEY)).toBe(String(PROJECT_RAIL_WIDTH_MIN));
    saveProjectRailWidth(900);
    expect(loadProjectRailWidth()).toBe(PROJECT_RAIL_WIDTH_MAX);
    localStorage.setItem(WIDTH_KEY, "10");
    expect(loadProjectRailWidth()).toBe(PROJECT_RAIL_WIDTH_MIN);
    localStorage.setItem(WIDTH_KEY, "nope");
    expect(loadProjectRailWidth()).toBe(PROJECT_RAIL_WIDTH_DEFAULT);
  });
});

describe("session sidebar width", () => {
  const WIDTH_KEY = "bycoda.sessionSidebarWidth";
  beforeEach(() => localStorage.removeItem(WIDTH_KEY));

  it("defaults to the old fixed width and goes down to 180", () => {
    expect(SESSION_SIDEBAR_WIDTH_MIN).toBe(180);
    expect(loadSessionSidebarWidth()).toBe(SESSION_SIDEBAR_WIDTH_DEFAULT);
  });

  it("persists the width and rounds it", () => {
    saveSessionSidebarWidth(301.6);
    expect(localStorage.getItem(WIDTH_KEY)).toBe("302");
    expect(loadSessionSidebarWidth()).toBe(302);
  });

  it("clamps out-of-range widths", () => {
    saveSessionSidebarWidth(100);
    expect(loadSessionSidebarWidth()).toBe(SESSION_SIDEBAR_WIDTH_MIN);
    localStorage.setItem(WIDTH_KEY, "5000");
    expect(loadSessionSidebarWidth()).toBe(SESSION_SIDEBAR_WIDTH_MAX);
    localStorage.setItem(WIDTH_KEY, "x");
    expect(loadSessionSidebarWidth()).toBe(SESSION_SIDEBAR_WIDTH_DEFAULT);
  });
});
