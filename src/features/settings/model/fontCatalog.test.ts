import { describe, expect, it } from "vitest";
import { BUNDLED_FONT_FACES } from "./fontFaceSources";
import {
  CODE_FONT_CATALOG,
  FONT_CATEGORIES,
  FONT_PAIRINGS,
  INTERFACE_FONT_CATALOG,
  findFont,
  fontFamilyValue,
  fontsInCategory,
  normalizeFontId,
  randomFontPairing,
} from "./fontCatalog";
import { APPEARANCE_DEFAULTS, CODE_FONTS, INTERFACE_FONTS } from "./appearancePreferences";

/** True when a CSS unicode-range such as "U+0000-00FF,U+0131" covers the code point. */
function coversCodePoint(range: string, codePoint: number) {
  return range.split(",").some((part) => {
    const [start, end = start] = part.trim().replace(/^U\+/, "").split("-");
    return codePoint >= parseInt(start!, 16) && codePoint <= parseInt(end!, 16);
  });
}

const TURKISH_LETTERS = [..."ğüşıöçĞÜŞİÖÇ"].map((char) => char.codePointAt(0)!);

describe("font catalog", () => {
  it("uses only known categories and keeps the system default first in both lists", () => {
    for (const catalog of [INTERFACE_FONT_CATALOG, CODE_FONT_CATALOG]) {
      expect(catalog[0]!.id).toBe("System");
      for (const font of catalog) expect(FONT_CATEGORIES).toContain(font.category);
      expect(new Set(catalog.map((font) => font.id)).size).toBe(catalog.length);
    }
    expect(findFont(INTERFACE_FONT_CATALOG, "System")!.bundled).toBe(false);
  });

  it("bundles exactly the fonts whose faces were generated", () => {
    for (const catalog of [INTERFACE_FONT_CATALOG, CODE_FONT_CATALOG]) {
      for (const font of catalog.filter((item) => item.bundled)) {
        expect(BUNDLED_FONT_FACES[font.family!], font.id).toBeDefined();
        expect(font.family).not.toMatch(/\s{2,}/);
      }
    }
  });

  it("covers Turkish letters with bundled latin-ext faces, except Commit Mono", () => {
    // Commit Mono ships a latin subset only; its ğ, ş and İ fall back to the platform font.
    const exceptions = new Set(["Commit Mono"]);
    for (const catalog of [INTERFACE_FONT_CATALOG, CODE_FONT_CATALOG]) {
      for (const font of catalog.filter((item) => item.bundled && !exceptions.has(item.id))) {
        const faces = BUNDLED_FONT_FACES[font.family!]!;
        for (const codePoint of TURKISH_LETTERS) {
          expect(
            faces.some((face) => coversCodePoint(face.unicodeRange, codePoint)),
            `${font.id} U+${codePoint.toString(16)}`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps saved values from before the catalog valid and maps unknown values to System", () => {
    expect(normalizeFontId(INTERFACE_FONT_CATALOG, "Arial")).toBe("Arial");
    expect(normalizeFontId(INTERFACE_FONT_CATALOG, "Verdana")).toBe("Verdana");
    expect(normalizeFontId(INTERFACE_FONT_CATALOG, "Segoe UI")).toBe("Segoe UI");
    expect(normalizeFontId(CODE_FONT_CATALOG, "Menlo")).toBe("Menlo");
    expect(normalizeFontId(CODE_FONT_CATALOG, "Courier New")).toBe("Courier New");
    expect(normalizeFontId(CODE_FONT_CATALOG, "Not installed")).toBe("System");
    expect(normalizeFontId(CODE_FONT_CATALOG, 12)).toBe("System");
    expect(INTERFACE_FONTS).toContain("Arial");
    expect(CODE_FONTS).toContain("Menlo");
    expect(APPEARANCE_DEFAULTS.interfaceFont).toBe("System");
    expect(APPEARANCE_DEFAULTS.codeFont).toBe("System");
  });

  it("resolves CSS families: bundled faces by their package name, system fonts by their own name", () => {
    expect(fontFamilyValue(INTERFACE_FONT_CATALOG, "Inter")).toBe("Inter Variable");
    expect(fontFamilyValue(INTERFACE_FONT_CATALOG, "Arial")).toBe("Arial");
    expect(fontFamilyValue(INTERFACE_FONT_CATALOG, "System")).toBeUndefined();
    expect(fontFamilyValue(CODE_FONT_CATALOG, "Not installed")).toBeUndefined();
  });

  it("filters by category and offers valid, bundled pairings", () => {
    const readable = fontsInCategory(CODE_FONT_CATALOG, "readable");
    expect(readable.every((font) => font.category === "readable")).toBe(true);
    expect(fontsInCategory(CODE_FONT_CATALOG, "all")).toHaveLength(CODE_FONT_CATALOG.length);
    for (const pair of FONT_PAIRINGS) {
      expect(findFont(INTERFACE_FONT_CATALOG, pair.interfaceFont)?.bundled).toBe(true);
      expect(findFont(CODE_FONT_CATALOG, pair.codeFont)?.bundled).toBe(true);
    }
    expect(randomFontPairing(() => 0)).toBe(FONT_PAIRINGS[0]);
    expect(randomFontPairing(() => 0.999)).toBe(FONT_PAIRINGS[FONT_PAIRINGS.length - 1]);
  });
});
