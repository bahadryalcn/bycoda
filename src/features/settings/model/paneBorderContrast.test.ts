import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The default pane separator is a deliberately quiet hairline (about 8% ink dark, 9% light); the
 * owner does not want it louder, and Appearance > Contrast raises it on request. This only guards
 * against it being weakened (or erased) by a later edit: it reads the ink from the stylesheet.
 */
const css = readFileSync(new URL("../../../styles/index.css", import.meta.url), "utf8");

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

describe("pane separator default ink", () => {
  const [dark, light] = paneBorderInk(css);

  it("keeps the dark hairline at no less than 8% ink and the light one at 9%", () => {
    expect(dark).toBeGreaterThanOrEqual(8);
    expect(light).toBeGreaterThanOrEqual(9);
  });

  it("stays a calm hairline, never a heavy rule", () => {
    expect(dark).toBeLessThanOrEqual(16);
    expect(light).toBeLessThanOrEqual(16);
  });
});
