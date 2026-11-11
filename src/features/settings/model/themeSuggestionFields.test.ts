// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_LIST_DISPLAY,
  parseSessionListDisplay,
} from "../../sessions/model/sessionListDisplay";
import { normalizeAppearancePreferences } from "./appearancePreferences";
import { DIFF_PALETTE_DEFAULT } from "./appearance";
import { normalizeInteractionTint } from "./interactionTint";
import { normalizeScrollbarStyle } from "./scrollbarStyle";
import { normalizeWorkingIndicator } from "./workingIndicator";
import {
  THEME_FIELD_GROUPS,
  THEME_FIELD_SPECS,
  THEME_IMAGE_DEFAULTS,
  describeThemeFieldGroups,
  resolveImageTuning,
  resolveThemeTypography,
  sanitizeThemeGroup,
} from "./themeSuggestionFields";
import { APPEARANCE_CHOICES } from "./themeRanges";
import { normalizeThemeSuggestion, suggestionAreas } from "./themeSuggestions";

const base = { name: "Dusk", hue: 232, saturation: 24, accent: "#8b5cf6" };

describe("sanitizeThemeGroup", () => {
  it("keeps valid values and drops invalid ones field by field", () => {
    expect(
      sanitizeThemeGroup("typography", {
        codeSize: 15,
        ligatures: "yes",
        terminalWeight: 450,
        terminalLineHeight: 1.35,
        terminalFont: "No Such Font",
        extra: 1,
      }),
    ).toEqual({ codeSize: 15, terminalLineHeight: 1.35 });
  });

  it("clamps numbers to their range", () => {
    expect(sanitizeThemeGroup("typography", { codeSize: 40, terminalSize: 2 })).toEqual({
      codeSize: 18,
      terminalSize: 11,
    });
    expect(
      sanitizeThemeGroup("image", {
        emptyOpacity: 100,
        sessionOpacity: 0,
        blur: 99,
      }),
    ).toEqual({ emptyOpacity: 65, sessionOpacity: 15, blur: 12 });
  });

  it("keeps accessibility guards tighter than the sliders", () => {
    expect(sanitizeThemeGroup("interface", { contrast: 75, uiScale: 200 })).toEqual({
      contrast: 100,
      uiScale: 150,
    });
    expect(sanitizeThemeGroup("interface", { surfaceContrast: 250 })).toEqual({
      surfaceContrast: 200,
    });
    expect(sanitizeThemeGroup("interface", { surfaceContrast: 20 })).toEqual({
      surfaceContrast: 50,
    });
    expect(sanitizeThemeGroup("background", { sidebarOpacity: 15, mainOpacity: 30 })).toEqual({
      sidebarOpacity: 70,
      mainOpacity: 70,
    });
    expect(sanitizeThemeGroup("interface", { accentReadability: "auto" })).toBeUndefined();
    expect(sanitizeThemeGroup("interface", { accentReadability: "strong" })).toEqual({
      accentReadability: "strong",
    });
  });

  it("returns nothing for a non-object or a group with no valid field", () => {
    expect(sanitizeThemeGroup("motion", "calm")).toBeUndefined();
    expect(sanitizeThemeGroup("motion", [true])).toBeUndefined();
    expect(sanitizeThemeGroup("motion", { crewTheme: "pirates", decorative: 1 })).toBeUndefined();
  });

  it("accepts every group's documented values", () => {
    expect(
      sanitizeThemeGroup("background", {
        liveScene: "silk",
        newThreadEffect: "dither",
        bodyGlass: true,
      }),
    ).toEqual({
      liveScene: "silk",
      newThreadEffect: "dither",
      bodyGlass: true,
    });
    expect(
      sanitizeThemeGroup("motion", {
        crewTheme: "matrix",
        showCrew: false,
        tabAnimations: false,
      }),
    ).toEqual({ crewTheme: "matrix", showCrew: false, tabAnimations: false });
    expect(
      sanitizeThemeGroup("interface", {
        rowDensity: "detailed",
        diffPalette: "colorblind",
        scrollbarSize: "large",
      }),
    ).toEqual({
      rowDensity: "detailed",
      diffPalette: "colorblind",
      scrollbarSize: "large",
    });
  });
});

describe("generated typography coherence", () => {
  it("normalizes related values before the Host returns a generated theme", () => {
    expect(
      normalizeThemeSuggestion({ ...base, typography: { codeSize: 12, terminalSize: 40 } })
        ?.typography,
    ).toEqual({ codeSize: 12, terminalSize: 14 });
  });
  it("couples terminal size to the suggested code size, or the current size when omitted", () => {
    expect(resolveThemeTypography({ codeSize: 12, terminalSize: 18 }, 15)).toEqual({
      codeSize: 12,
      terminalSize: 14,
    });
    expect(resolveThemeTypography({ terminalSize: 11 }, 16)).toEqual({ terminalSize: 14 });
    expect(resolveThemeTypography({ codeSize: 15, terminalSize: 14 }, 13)).toEqual({
      codeSize: 15,
      terminalSize: 14,
    });
    expect(resolveThemeTypography({ ligatures: true }, 13)).toEqual({ ligatures: true });
  });
});

describe("normalizeThemeSuggestion groups", () => {
  it("carries every valid group and omits invalid ones", () => {
    const suggestion = normalizeThemeSuggestion({
      ...base,
      typography: { codeSize: 14 },
      interface: { contrast: 120 },
      background: { liveScene: "bogus" },
      image: { scope: "empty" },
      motion: null,
    })!;
    expect(suggestion.typography).toEqual({ codeSize: 14 });
    expect(suggestion.interface).toEqual({ contrast: 120 });
    expect(suggestion.image).toEqual({ scope: "empty" });
    expect(suggestion).not.toHaveProperty("background");
    expect(suggestion).not.toHaveProperty("motion");
  });

  it("lists the tabs a suggestion changes", () => {
    expect(suggestionAreas(normalizeThemeSuggestion(base)!)).toEqual(["theme"]);
    expect(
      suggestionAreas(
        normalizeThemeSuggestion({
          ...base,
          codeTheme: "dracula",
          density: "touch",
          image: { blur: 4 },
          motion: { decorative: false },
        })!,
      ),
    ).toEqual(["theme", "typography", "interface", "background", "motion"]);
  });
});

describe("image tuning", () => {
  it("also guards cached suggestions drawn after the model validation step", () => {
    expect(resolveImageTuning({ emptyOpacity: 5, sessionOpacity: 0, blur: 40 })).toEqual({
      scope: "all",
      emptyOpacity: 30,
      sessionOpacity: 15,
      blur: 12,
    });
  });
  it("falls back to readable defaults and lets the model override", () => {
    expect(resolveImageTuning(undefined)).toEqual(THEME_IMAGE_DEFAULTS);
    expect(resolveImageTuning({ blur: 12 })).toEqual({
      ...THEME_IMAGE_DEFAULTS,
      blur: 12,
    });
    expect(THEME_IMAGE_DEFAULTS.sessionOpacity).toBeLessThan(THEME_IMAGE_DEFAULTS.emptyOpacity);
  });
});

describe("prompt description", () => {
  it("names every group and key", () => {
    const text = describeThemeFieldGroups().join("\n");
    for (const group of THEME_FIELD_GROUPS) {
      expect(text).toContain(`"${group}"`);
      for (const key of Object.keys(THEME_FIELD_SPECS[group])) expect(text).toContain(`"${key}"`);
    }
  });
});

/** The choice lists live in themeRanges.ts; each must still be accepted by its settings normalizer. */
describe("choice lists match the settings models", () => {
  it("terminal weights, line heights and diff palettes", () => {
    for (const terminalWeight of APPEARANCE_CHOICES.terminalWeight)
      expect(normalizeAppearancePreferences({ terminalWeight }).terminalWeight).toBe(
        terminalWeight,
      );
    for (const terminalLineHeight of APPEARANCE_CHOICES.terminalLineHeight)
      expect(normalizeAppearancePreferences({ terminalLineHeight }).terminalLineHeight).toBe(
        terminalLineHeight,
      );
    expect(APPEARANCE_CHOICES.diffPalette).toContain(DIFF_PALETTE_DEFAULT);
  });

  it("scrollbar, tint and working indicator", () => {
    for (const color of APPEARANCE_CHOICES.scrollbarColor)
      expect(normalizeScrollbarStyle({ color }).color).toBe(color);
    for (const size of APPEARANCE_CHOICES.scrollbarSize)
      expect(normalizeScrollbarStyle({ size }).size).toBe(size);
    for (const visibility of APPEARANCE_CHOICES.scrollbarVisibility)
      expect(normalizeScrollbarStyle({ visibility }).visibility).toBe(visibility);
    for (const source of APPEARANCE_CHOICES.tintSource)
      expect(normalizeInteractionTint({ source }).source).toBe(source);
    for (const color of APPEARANCE_CHOICES.workingColor)
      expect(normalizeWorkingIndicator({ color }).color).toBe(color);
    for (const style of APPEARANCE_CHOICES.workingStyle)
      expect(normalizeWorkingIndicator({ style }).style).toBe(style);
  });

  it("row density", () => {
    for (const density of APPEARANCE_CHOICES.rowDensity)
      expect(parseSessionListDisplay(JSON.stringify({ density })).density).toBe(density);
    expect(APPEARANCE_CHOICES.rowDensity).toContain(DEFAULT_SESSION_LIST_DISPLAY.density);
  });
});
