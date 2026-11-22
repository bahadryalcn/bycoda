import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hslToRgb } from "../../../shared/lib/colorUtils";
import { contrastRatio, mixInOklab } from "./accentContrast";

/**
 * Pane separators are a 1px --ui-pane-border between the rail, the session panel and the chat.
 * Dark panes sit on near-black grounds, so a too-faint ink (it once measured 1.08:1) melts the
 * three panes into one block, most of all on Retina and translucent macOS windows. This reads the
 * ink percentage from the real stylesheet and pins a minimum contrast for every ground.
 */
const css = readFileSync(new URL("../../../styles/index.css", import.meta.url), "utf8");

const hex = (h: number, s: number, l: number) => {
  const { r, g, b } = hslToRgb(h, s, l);
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
};

function paneBorderInk(source: string): number[] {
  const inks: number[] = [];
  for (const match of source.matchAll(/--ui-pane-border:\s*color-mix\(([\s\S]*?)\);/g)) {
    const body = match[1];
    const dark = body.match(/--appearance-stroke-strength,\s*([\d.]+)%\)\s*\*\s*([\d.]+)/);
    const light = body.match(/calc\(([\d.]+)%\s*\*\s*var\(--appearance-layer-strength/);
    if (dark) inks.push(Number(dark[1]) * Number(dark[2]));
    else if (light) inks.push(Number(light[1]));
  }
  return inks;
}

const MIN_CONTRAST = 1.3;

describe("pane separator contrast", () => {
  const [dark, light] = paneBorderInk(css);

  it("finds both the dark and the light --ui-pane-border definitions", () => {
    expect(dark).toBeGreaterThan(0);
    expect(light).toBeGreaterThan(0);
  });

  it("dark: stays visible against a black canvas and the lifted dark grounds", () => {
    const content = hex(216, 24, 92);
    for (const ground of [0, 4, 8, 12]) {
      const base = hex(216, 24, Math.max(ground, 4));
      const border = mixInOklab(base, content, dark / 100);
      expect(contrastRatio(border, "#000000")).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(border, hex(216, 24, ground))).toBeGreaterThanOrEqual(
        ground === 0 ? MIN_CONTRAST : 1.2,
      );
    }
  });

  it("light: stays visible against the default and the mid-gray light grounds", () => {
    for (const [h, s, l] of [
      [216, 4.8, 98.6],
      [170, 6, 71],
    ] as const) {
      const ground = hex(h, s, l);
      const border = mixInOklab(ground, hex(h, 8, 13), light / 100);
      expect(contrastRatio(border, ground)).toBeGreaterThanOrEqual(1.25);
    }
  });

  it("stays a calm hairline, never a heavy rule", () => {
    expect(dark).toBeLessThanOrEqual(16);
    expect(light).toBeLessThanOrEqual(16);
  });
});
