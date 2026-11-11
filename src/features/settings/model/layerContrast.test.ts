import { describe, expect, it } from "vitest";
import { hslToRgb } from "../../../shared/lib/colorUtils";
import { contrastRatio, mixInOklab } from "./accentContrast";

/**
 * JS mirror of the layer formulas in src/styles/index.css (the `html.theme-light` block and the
 * dark defaults). Keep the constants in sync with the CSS.
 */
const hex = (h: number, s: number, l: number) => {
  const { r, g, b } = hslToRgb(h, s, l);
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
};
const WHITE = "#ffffff";
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function lightLayers(hue: number, saturation: number, lightness: number, strength = 1) {
  const ground = hex(hue, saturation, lightness);
  const content = hex(hue, 8, 13);
  const lift = (slope: number) => clamp((lightness - 58) * slope * strength, 0, 100) / 100;
  const muted = mixInOklab(ground, WHITE, lift(1.6));
  const surface = mixInOklab(ground, WHITE, lift(1.9));
  const raised = mixInOklab(ground, WHITE, lift(2.5));
  return {
    ground,
    content,
    muted,
    surface,
    raised,
    paneBorder: mixInOklab(ground, content, (9 * strength) / 100),
    controlBorder: mixInOklab(muted, content, 0.52),
    fieldBorder: mixInOklab(muted, content, 0.38),
    selected: mixInOklab(ground, content, 0.1),
  };
}

/** Mirror of the dark `--ui-surface-hover|selected|pressed` percentages (12 / 20 / 28). */
function ladder(muted: string, content: string, strength: number) {
  const mix = (percent: number) => mixInOklab(muted, content, (percent * strength) / 100);
  return { hover: mix(12), selected: mix(20), pressed: mix(28) };
}

function darkLayers(lightness: number, strength = 1) {
  const canvas = hex(216, 24, lightness);
  const base = hex(216, 24, Math.max(lightness, 4));
  const content = hex(216, 24, 92);
  const step = (percent: number) => mixInOklab(base, content, (percent * strength) / 100);
  return {
    canvas,
    muted: step(5),
    surface: step(10),
    raised: step(16),
    paneBorder: mixInOklab(step(5), content, 0.21),
    controlBorder: mixInOklab(step(5), content, 0.44),
    ...ladder(step(5), content, strength),
  };
}

const grounds = [
  { name: "default light", h: 216, s: 4.8, l: 98.6 },
  { name: "mid-gray light", h: 170, s: 6, l: 71 },
];

describe("light layers derive from the real ground", () => {
  for (const g of grounds) {
    it(`${g.name}: fills are visible steps, borders are darker than the ground`, () => {
      const layers = lightLayers(g.h, g.s, g.l);
      for (const fill of [layers.muted, layers.surface, layers.raised]) {
        const ratio = contrastRatio(fill, layers.ground);
        expect(ratio).toBeGreaterThanOrEqual(1.02);
        expect(ratio).toBeLessThanOrEqual(1.6);
      }
      expect(contrastRatio(layers.fieldBorder, layers.muted)).toBeGreaterThanOrEqual(1.5);
      expect(contrastRatio(layers.controlBorder, layers.muted)).toBeGreaterThanOrEqual(1.5);
      expect(contrastRatio(layers.controlBorder, layers.ground)).toBeGreaterThanOrEqual(1.5);
      // A pane line darker than the ground, and a selected fill distinct from it.
      expect(contrastRatio(layers.paneBorder, WHITE)).toBeGreaterThan(
        contrastRatio(layers.ground, WHITE),
      );
      expect(contrastRatio(layers.paneBorder, layers.ground)).toBeGreaterThan(1.05);
      expect(contrastRatio(layers.selected, layers.ground)).toBeGreaterThan(1.05);
    });
  }

  it("keeps the default ground close to the former white surfaces", () => {
    const layers = lightLayers(216, 4.8, 98.6);
    expect(layers.raised).toBe("#ffffff");
    expect(contrastRatio(layers.surface, "#fcfcfd")).toBeLessThan(1.02);
  });

  it("never reaches pure white on a mid-tone ground", () => {
    const layers = lightLayers(170, 6, 71);
    expect(layers.raised).not.toBe("#ffffff");
    expect(contrastRatio(layers.raised, "#ffffff")).toBeGreaterThan(1.3);
  });

  it("scales the lift with the layer strength", () => {
    const base = lightLayers(170, 6, 71, 1);
    const strong = lightLayers(170, 6, 71, 1.5);
    const weak = lightLayers(170, 6, 71, 0.5);
    expect(contrastRatio(strong.surface, base.ground)).toBeGreaterThan(
      contrastRatio(base.surface, base.ground),
    );
    expect(contrastRatio(weak.surface, base.ground)).toBeLessThan(
      contrastRatio(base.surface, base.ground),
    );
  });

  it("keeps diff text at 3:1 on a mid-tone ground once ink is mixed in", () => {
    const ground = hex(170, 6, 71);
    const content = hex(170, 8, 13);
    const ink = clamp((92 - 71) * 1.4, 0, 60) / 100;
    const mixSrgb = (from: string, toward: string, amount: number) => {
      const channel = (hexColor: string, offset: number) =>
        Number.parseInt(hexColor.slice(offset, offset + 2), 16);
      return `#${[1, 3, 5]
        .map((o) => Math.round(channel(from, o) + (channel(toward, o) - channel(from, o)) * amount))
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("")}`;
    };
    for (const palette of ["#047857", "#be123c", "#0550ae", "#953800"]) {
      expect(contrastRatio(mixSrgb(palette, content, ink), ground)).toBeGreaterThanOrEqual(3);
    }
    expect(contrastRatio("#047857", ground)).toBeLessThan(3);
  });
});

describe("dark layers", () => {
  for (const lightness of [4, 0]) {
    it(`${lightness}% canvas: fills and borders step away from the ground`, () => {
      const layers = darkLayers(lightness);
      for (const fill of [layers.muted, layers.surface, layers.raised]) {
        const ratio = contrastRatio(fill, layers.canvas);
        expect(ratio).toBeGreaterThanOrEqual(1.02);
        expect(ratio).toBeLessThanOrEqual(1.6);
      }
      expect(contrastRatio(layers.controlBorder, layers.muted)).toBeGreaterThanOrEqual(1.5);
      expect(contrastRatio(layers.paneBorder, layers.muted)).toBeGreaterThan(1.1);
    });
  }
});

describe("dark interaction ladder", () => {
  for (const lightness of [4, 0]) {
    it(`${lightness}% canvas: rest < hover < selected < pressed, each step visible`, () => {
      const layers = darkLayers(lightness);
      expect(contrastRatio(layers.hover, layers.muted)).toBeGreaterThanOrEqual(1.2);
      expect(contrastRatio(layers.hover, layers.canvas)).toBeGreaterThanOrEqual(1.2);
      expect(contrastRatio(layers.selected, layers.hover)).toBeGreaterThanOrEqual(1.2);
      expect(contrastRatio(layers.pressed, layers.selected)).toBeGreaterThan(1.2);
      const lum = (c: string) => contrastRatio(c, "#000000");
      expect(lum(layers.muted)).toBeLessThan(lum(layers.hover));
      expect(lum(layers.hover)).toBeLessThan(lum(layers.selected));
      expect(lum(layers.selected)).toBeLessThan(lum(layers.pressed));
    });
  }

  it("scales with the interaction strength and stays quiet at the top step", () => {
    const base = darkLayers(4, 1);
    const strong = darkLayers(4, 1.5);
    expect(contrastRatio(strong.hover, base.muted)).toBeGreaterThan(
      contrastRatio(base.hover, base.muted),
    );
    // Pressed is the loudest state: at most 28% ink at strength 1 (about 30% ceiling).
    expect(contrastRatio(base.pressed, base.muted)).toBeLessThan(2);
  });
});
