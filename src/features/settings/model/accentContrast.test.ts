import { describe, expect, it } from "vitest";
import {
  ACCENT_CONTRAST_TARGET,
  ACCENT_INK_DARK,
  ACCENT_INK_LIGHT,
  contrastRatio,
  deriveAccentRoles,
  relativeLuminance,
  selectionAccentPair,
  solidAccentPair,
  type AccentReadability,
} from "./accentContrast";

// Built-in palette accents, plus the awkward customs: very light, very dark,
// saturated, mid-tone purples that sit near the black/white crossover.
const ACCENTS = {
  defaultGray: "#a3acb8",
  white: "#ffffff",
  nearWhite: "#fafafa",
  black: "#000000",
  nearBlack: "#0a0a0a",
  lightYellow: "#fde68a",
  pureYellow: "#ffff00",
  deepPurple: "#3b0764",
  brightPurple: "#a855f7",
  midPurple: "#8b5cf6",
  saturatedRed: "#ff0000",
  saturatedGreen: "#00ff00",
  saturatedBlue: "#0000ff",
  midGray: "#777777",
  teal: "#14b8a6",
  orange: "#f59e0b",
} as const;

const LEVELS: AccentReadability[] = ["auto", "strong"];

describe("WCAG helpers", () => {
  it("matches the reference ratios", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 3);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("accepts uppercase hex like the stored default", () => {
    expect(relativeLuminance("#A3ACB8")).toBeCloseTo(relativeLuminance("#a3acb8"), 8);
  });
});

describe("solid accent pair", () => {
  for (const level of LEVELS) {
    for (const [name, accent] of Object.entries(ACCENTS)) {
      it(`${name} keeps its saved fill with a measured ink in ${level}`, () => {
        const pair = solidAccentPair(accent, level);
        expect(pair.background).toBe(accent);
        expect([ACCENT_INK_LIGHT, ACCENT_INK_DARK]).toContain(pair.foreground);
        // Pure black or white always reaches the AA text level on any colour.
        expect(contrastRatio(pair.background, pair.foreground)).toBeGreaterThanOrEqual(4.5);
        const other = pair.foreground === ACCENT_INK_LIGHT ? ACCENT_INK_DARK : ACCENT_INK_LIGHT;
        expect(pair.ratio).toBeGreaterThanOrEqual(contrastRatio(accent, other));
      });
    }
  }

  it("chooses the ink from measured contrast, not from the colour name or scheme", () => {
    expect(solidAccentPair(ACCENTS.deepPurple, "auto").foreground).toBe(ACCENT_INK_LIGHT);
    expect(solidAccentPair(ACCENTS.lightYellow, "auto").foreground).toBe(ACCENT_INK_DARK);
    expect(solidAccentPair(ACCENTS.saturatedBlue, "auto").foreground).toBe(ACCENT_INK_LIGHT);
    expect(solidAccentPair(ACCENTS.saturatedGreen, "auto").foreground).toBe(ACCENT_INK_DARK);
  });

  it("never recolours the fill for strong, and the level does not change a solid", () => {
    for (const accent of Object.values(ACCENTS)) {
      expect(solidAccentPair(accent, "strong")).toEqual(solidAccentPair(accent, "auto"));
    }
  });

  it("derives hover and pressed that never lower the contrast", () => {
    for (const accent of Object.values(ACCENTS)) {
      const solid = solidAccentPair(accent, "auto");
      for (const state of [solid.hover, solid.pressed]) {
        expect(contrastRatio(state, solid.foreground)).toBeGreaterThanOrEqual(
          Math.min(solid.ratio, 4.5),
        );
      }
    }
    // A mid-tone fill visibly moves away from its ink.
    const purple = solidAccentPair(ACCENTS.deepPurple, "auto");
    expect(purple.hover).not.toBe(purple.background);
    expect(purple.pressed).not.toBe(purple.hover);
  });
});

describe("text selection pair", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const level of LEVELS) {
      for (const [name, accent] of Object.entries(ACCENTS)) {
        it(`${name} in ${scheme}/${level} keeps the ink readable`, () => {
          const pair = selectionAccentPair(accent, scheme, level);
          expect(pair.foreground).toBe(scheme === "dark" ? ACCENT_INK_LIGHT : ACCENT_INK_DARK);
          expect(pair.ratio).toBeGreaterThanOrEqual(ACCENT_CONTRAST_TARGET[level]);
        });
      }
    }
    for (const [name, accent] of Object.entries(ACCENTS)) {
      it(`${name} in ${scheme}/auto stays visible against the canvas (3:1)`, () => {
        const canvas = scheme === "dark" ? "#171717" : "#fafafa";
        const pair = selectionAccentPair(accent, scheme, "auto");
        expect(contrastRatio(pair.background, canvas)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("uses the real canvas: a lighter custom dark canvas lifts the dark fill", () => {
    const base = selectionAccentPair(ACCENTS.deepPurple, "dark", "auto");
    const lifted = selectionAccentPair(ACCENTS.deepPurple, "dark", "auto", {
      dark: "#3a4350",
      light: "#fafafa",
    });
    expect(relativeLuminance(lifted.background)).toBeGreaterThan(relativeLuminance(base.background));
    expect(lifted.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the saved colour when it already sits in the readable band", () => {
    expect(selectionAccentPair(ACCENTS.deepPurple, "dark", "auto").background).not.toBe(
      ACCENTS.deepPurple,
    ); // too dark to see on a dark canvas, so it is lifted
    expect(selectionAccentPair(ACCENTS.midGray, "light", "auto").background).toBe(
      ACCENTS.midGray,
    );
  });
});

describe("deriveAccentRoles", () => {
  it("returns all roles for the active level", () => {
    const roles = deriveAccentRoles(ACCENTS.midPurple, "strong");
    expect(roles.solid.background).toBe(ACCENTS.midPurple);
    expect(roles.selection.dark.ratio).toBeGreaterThanOrEqual(7);
    expect(roles.selection.light.ratio).toBeGreaterThanOrEqual(7);
  });
});
