import { describe, expect, it } from "vitest";
import {
  ACCENT_CONTRAST_TARGET,
  ACCENT_INK_DARK,
  ACCENT_INK_LIGHT,
  contrastRatio,
  deriveAccentRoles,
  paperSelectionPair,
  PAPER_CANVAS,
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

const CANVAS = { dark: "#171717", light: "#fafafa" } as const;

function hsv(hex: string) {
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta + 6) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  return { hue: hue * 60, saturation: max === 0 ? 0 : delta / max };
}

function hueDistance(a: number, b: number) {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

describe("text selection pair", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const level of LEVELS) {
      for (const [name, accent] of Object.entries(ACCENTS)) {
        it(`${name} in ${scheme}/${level} reaches the text target and stays visible (3:1)`, () => {
          const pair = selectionAccentPair(accent, scheme, level);
          expect([ACCENT_INK_LIGHT, ACCENT_INK_DARK]).toContain(pair.foreground);
          expect(pair.ratio).toBeGreaterThanOrEqual(ACCENT_CONTRAST_TARGET[level]);
          expect(contrastRatio(pair.background, CANVAS[scheme])).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }

  it("cannot satisfy 7:1 text and 3:1 canvas with the scheme ink, so the opposite ink is used", () => {
    // White ink at 7:1 needs a fill luminance <= 0.1; 3:1 on #171717 needs >= 0.126.
    const whiteBand = (1 + 0.05) / 7 - 0.05;
    const visibleMin = (relativeLuminance(CANVAS.dark) + 0.05) * 3 - 0.05;
    expect(whiteBand).toBeLessThan(visibleMin);
    expect(selectionAccentPair(ACCENTS.midPurple, "dark", "strong").foreground).toBe(ACCENT_INK_DARK);
    // Black ink at 7:1 needs >= 0.3; 3:1 on #fafafa needs <= 0.285.
    const blackBand = 7 * 0.05 - 0.05;
    const visibleMax = (relativeLuminance(CANVAS.light) + 0.05) / 3 - 0.05;
    expect(blackBand).toBeGreaterThan(visibleMax);
    expect(selectionAccentPair(ACCENTS.midPurple, "light", "strong").foreground).toBe(ACCENT_INK_LIGHT);
  });

  it("keeps the scheme ink when the accent barely has to move", () => {
    expect(selectionAccentPair(ACCENTS.midPurple, "dark", "auto").foreground).toBe(ACCENT_INK_LIGHT);
    expect(selectionAccentPair(ACCENTS.midPurple, "light", "auto").foreground).toBe(ACCENT_INK_DARK);
  });

  it("keeps a pale accent on a dark canvas instead of darkening it into mustard", () => {
    const pair = selectionAccentPair(ACCENTS.lightYellow, "dark", "auto");
    expect(pair.background).toBe(ACCENTS.lightYellow);
    expect(pair.foreground).toBe(ACCENT_INK_DARK);
    expect(selectionAccentPair(ACCENTS.deepPurple, "light", "auto").background).toBe(ACCENTS.deepPurple);
  });

  it("keeps hue and chroma when the fill must move (no grey-khaki from mixing towards black)", () => {
    const moved = [
      [ACCENTS.lightYellow, "light"],
      [ACCENTS.pureYellow, "light"],
      [ACCENTS.orange, "light"],
      [ACCENTS.teal, "light"],
      [ACCENTS.deepPurple, "dark"],
    ] as const;
    for (const [accent, scheme] of moved) {
      const pair = selectionAccentPair(accent, scheme, "auto");
      expect(pair.background).not.toBe(accent);
      expect(hueDistance(hsv(pair.background).hue, hsv(accent).hue)).toBeLessThan(8);
      // Darkening must not drain the colour; lifting a deep accent legitimately lowers HSV saturation.
      if (scheme === "light") {
        expect(hsv(pair.background).saturation).toBeGreaterThanOrEqual(hsv(accent).saturation * 0.8);
      }
    }
  });

  it("uses the real canvas: a lighter custom dark canvas lifts the dark fill", () => {
    const base = selectionAccentPair(ACCENTS.deepPurple, "dark", "auto");
    const canvas = { dark: "#3a4350", light: "#fafafa" };
    const lifted = selectionAccentPair(ACCENTS.deepPurple, "dark", "auto", canvas);
    expect(relativeLuminance(lifted.background)).toBeGreaterThan(relativeLuminance(base.background));
    expect(lifted.ratio).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lifted.background, canvas.dark)).toBeGreaterThanOrEqual(3);
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

describe("paper selection pair (glyphs painted on a white page)", () => {
  for (const [name, accent] of Object.entries(ACCENTS)) {
    it(`${name}: dark glyphs stay readable in auto and strong`, () => {
      for (const level of LEVELS) {
        const pair = paperSelectionPair(accent, level);
        expect(pair.foreground).toBe(ACCENT_INK_DARK);
        expect(pair.ratio).toBeGreaterThanOrEqual(ACCENT_CONTRAST_TARGET[level]);
      }
    });
    it(`${name}: stays 3:1 apart from the page in auto`, () => {
      expect(contrastRatio(paperSelectionPair(accent, "auto").background, PAPER_CANVAS)).toBeGreaterThanOrEqual(3);
    });
  }

  it("strong sits at the 7:1 / 3:1 crossover: the text target wins, separation stays within a hair of 3:1", () => {
    for (const accent of Object.values(ACCENTS)) {
      const pair = paperSelectionPair(accent, "strong");
      expect(pair.ratio).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(pair.background, PAPER_CANVAS)).toBeGreaterThanOrEqual(2.9);
    }
  });
});

describe("deriveAccentRoles", () => {
  it("returns all roles for the active level", () => {
    const roles = deriveAccentRoles(ACCENTS.midPurple, "strong");
    expect(roles.solid.background).toBe(ACCENTS.midPurple);
    expect(roles.selection.dark.ratio).toBeGreaterThanOrEqual(7);
    expect(roles.selection.light.ratio).toBeGreaterThanOrEqual(7);
    expect(roles.selection.paper.ratio).toBeGreaterThanOrEqual(7);
  });
});
