import { describe, expect, it } from "vitest";
import { solidAccentPair } from "./accentContrast";
import {
  accentForHue,
  ensureAccentContrast,
  hslToHex,
  normalizeThemeSuggestion,
  parseThemeSuggestions,
  RANDOM_LOOK_COUNT,
  randomThemeSuggestions,
  suggestionSwatches,
} from "./themeSuggestions";

const valid = { name: "Dusk", hue: 232, saturation: 24, accent: "#8B5CF6" };

describe("hslToHex", () => {
  it("converts primaries and greys", () => {
    expect(hslToHex(0, 100, 50)).toBe("#ff0000");
    expect(hslToHex(120, 100, 50)).toBe("#00ff00");
    expect(hslToHex(240, 100, 50)).toBe("#0000ff");
    expect(hslToHex(0, 0, 100)).toBe("#ffffff");
    expect(hslToHex(360, 100, 50)).toBe("#ff0000");
  });
});

describe("normalizeThemeSuggestion", () => {
  it("keeps a valid entry and lowercases the accent", () => {
    expect(normalizeThemeSuggestion(valid)).toEqual({ ...valid, accent: "#8b5cf6" });
  });
  it("clamps hue and saturation to their ranges", () => {
    expect(normalizeThemeSuggestion({ ...valid, hue: 400, saturation: 95 })).toMatchObject({
      hue: 360,
      saturation: 60,
    });
    expect(normalizeThemeSuggestion({ ...valid, hue: -20, saturation: -4 })).toMatchObject({
      hue: 0,
      saturation: 0,
    });
  });
  it("drops entries with invalid fields", () => {
    expect(normalizeThemeSuggestion({ ...valid, name: "   " })).toBeNull();
    expect(normalizeThemeSuggestion({ ...valid, hue: Number.NaN })).toBeNull();
    expect(normalizeThemeSuggestion({ ...valid, saturation: "20" })).toBeNull();
    expect(normalizeThemeSuggestion({ ...valid, accent: "red" })).toBeNull();
    expect(normalizeThemeSuggestion({ ...valid, accent: "#12345" })).toBeNull();
    expect(normalizeThemeSuggestion(null)).toBeNull();
  });
  it("cuts long names without splitting a grapheme", () => {
    const name = normalizeThemeSuggestion({ ...valid, name: "🚀".repeat(60) })!.name;
    expect(Array.from(name)).toHaveLength(40);
    expect(name).not.toMatch(/\uD83D$/);
  });
});

describe("parseThemeSuggestions", () => {
  it("accepts an array or a suggestions object and keeps at most three valid entries", () => {
    const entries = [valid, { bad: true }, valid, valid, valid];
    expect(parseThemeSuggestions(entries)).toHaveLength(3);
    expect(parseThemeSuggestions({ suggestions: [valid] })).toHaveLength(1);
    expect(parseThemeSuggestions("nope")).toEqual([]);
  });
});

describe("accent contrast", () => {
  it("always returns an accent that meets the solid action target", () => {
    for (const hue of [0, 60, 120, 200, 240, 300]) {
      const accent = ensureAccentContrast(accentForHue(hue));
      expect(solidAccentPair(accent, "auto").ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps an already passing accent unchanged", () => {
    expect(ensureAccentContrast("#f59e0b")).toBe("#f59e0b");
  });
});

describe("randomThemeSuggestions", () => {
  it("rolls six distinct looks spread about the wheel with readable accents", () => {
    for (const seed of [0.1, 0.5, 0.9]) {
      let state = seed;
      const random = () => {
        state = (state * 9301 + 0.49297) % 1;
        return state;
      };
      const suggestions = randomThemeSuggestions(random);
      expect(suggestions).toHaveLength(RANDOM_LOOK_COUNT);
      expect(new Set(suggestions.map((item) => item.name)).size).toBe(RANDOM_LOOK_COUNT);
      const hues = suggestions.map((item) => item.hue).sort((a, b) => a - b);
      // Jitter stays within a quarter step, so neighbours never collapse onto one hue.
      for (let index = 1; index < hues.length; index++)
        expect(hues[index]! - hues[index - 1]!).toBeGreaterThanOrEqual(25);
      for (const suggestion of suggestions) {
        expect(suggestion.saturation).toBeGreaterThanOrEqual(8);
        expect(suggestion.saturation).toBeLessThanOrEqual(45);
        expect(suggestion.darkLightness).toBeGreaterThanOrEqual(2);
        expect(suggestion.darkLightness).toBeLessThanOrEqual(12);
        expect(solidAccentPair(suggestion.accent, "auto").ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("suggestionSwatches", () => {
  it("returns canvas, surface, line and accent in order", () => {
    const [canvas, surface, line, accent] = suggestionSwatches({
      name: "Fern",
      hue: 140,
      saturation: 30,
      accent: "#10b981",
    });
    expect(canvas).toMatch(/^#[0-9a-f]{6}$/);
    expect(surface).toMatch(/^#[0-9a-f]{6}$/);
    expect(line).toMatch(/^#[0-9a-f]{6}$/);
    expect(accent).toBe("#10b981");
  });
});

describe("optional Appearance fields", () => {
  const base = { name: "Forest", hue: 140, saturation: 20, accent: "#22C55E" };

  it("keeps valid optional fields and clamps numbers", () => {
    const entry = normalizeThemeSuggestion({
      ...base,
      scheme: "dark",
      darkLightness: 99,
      canvas: "tinted",
      gradient: { name: "Moss", type: "radial", angle: 400, stops: ["#0B1F14", "#123323"] },
      interfaceFont: "Inter",
      codeFont: "JetBrains Mono",
      codeTheme: "dracula",
      density: "compact",
      chatWidth: "wide",
      imagePrompt: "  misty   pine forest at night ",
    });
    expect(entry).toMatchObject({
      scheme: "dark",
      darkLightness: 30,
      canvas: "tinted",
      gradient: { type: "radial", angle: 360, stops: ["#0b1f14", "#123323", "#123323"] },
      interfaceFont: "Inter",
      codeFont: "JetBrains Mono",
      codeTheme: "dracula",
      density: "compact",
      imagePrompt: "misty pine forest at night",
    });
    // Chat width is a Chat setting the owner keeps for themselves; the model may not move it.
    expect(entry).not.toHaveProperty("chatWidth");
  });

  it("drops invalid optional fields without dropping the theme", () => {
    const entry = normalizeThemeSuggestion({
      ...base,
      scheme: "sepia",
      darkLightness: "dim",
      gradient: { stops: ["red"] },
      interfaceFont: "Comic Sans",
      codeFont: "Inter",
      density: "huge",
      imagePrompt: "   ",
    });
    expect(entry).toEqual({ ...base, accent: "#22c55e" });
  });
});
