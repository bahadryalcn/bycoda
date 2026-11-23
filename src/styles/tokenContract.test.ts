import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mixInOklab } from "../features/settings/model/accentContrast";
import { APPEARANCE_RANGES } from "../features/settings/model/themeRanges";
import { hslToRgb } from "../shared/lib/colorUtils";

/**
 * Token contract: reads the real declarations from index.css, arc.css and the shared module CSS,
 * then measures contrast with the values it finds, so a value change fails here instead of
 * drifting from a hand-typed mirror. The floating and on-state recipes use Oklab; the
 * near-neutral state and focus steps use an sRGB approximation.
 */
const index = readFileSync("src/styles/index.css", "utf8");
const arc = readFileSync("src/styles/arc.css", "utf8");
const kbdCss = readFileSync(
  "src/shared/ui/arc/shortcut-recorder/shortcut-recorder.module.css",
  "utf8",
);

type Rgb = [number, number, number];
const fromHsl = (h: number, s: number, l: number): Rgb => {
  const { r, g, b } = hslToRgb(h, s, l);
  return [r, g, b];
};
const mix = (host: Rgb, ink: Rgb, percent: number): Rgb =>
  host.map((c, i) => c + (ink[i]! - c) * (percent / 100)) as Rgb;
const toHex = (rgb: Rgb) =>
  `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
const mixOklab = (host: Rgb, ink: Rgb, percent: number): Rgb => {
  const hex = mixInOklab(toHex(host), toHex(ink), percent / 100);
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;
};
const lum = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
  return (hi + 0.05) / (lo + 0.05);
};
const num = (re: RegExp, source = index) => {
  const match = re.exec(source);
  if (!match) throw new Error(`token not found: ${re}`);
  return Number(match[1]);
};
const all = (re: RegExp, source = index) => [...source.matchAll(re)].map((m) => Number(m[1]));

// Dark and light declarations, in file order (dark defaults first, then html.theme-light).
const states = (name: string) => all(new RegExp(`--ui-state-${name}: ([0-9]+)%`, "g"));
const [hoverDark, hoverLight] = states("hover");
const [selectedDark, selectedLight] = states("selected");
const [pressedDark, pressedLight] = states("pressed");
const [chipDark, chipLight] = all(/--ui-tone-subtle-strength: (\d+)%;/g);
const floatingDark = num(
  /--ui-floating-lift: calc\((\d+)% \* var\(--appearance-layer-strength, 1\)\);/,
);
const floatingLight = /--ui-floating-lift: clamp\(\s*0%,\s*calc\(\(var\(--ui-ground-lightness\) - ([\d.]+)%\) \* ([\d.]+) \* var\(--appearance-layer-strength, 1\)\),\s*([\d.]+)%\s*\);/;
const lightness = num(/--theme-light-lightness: ([\d.]+)%;/);
const hue = num(/--theme-hue: (\d+);/);
const saturation = num(/--theme-saturation: (\d+)%;/);
const darkLayerLightness = Math.max(
  num(/--theme-dark-lightness: (\d+)%;/),
  num(/max\(var\(--background-lightness\), (\d+)%\)/),
);
const [lightFloor, lightFactor, lightCap] = floatingLight.exec(index)!.slice(1).map(Number);
const composerPure = num(
  /html\[data-canvas-background="pure"\] \{[\s\S]*?--ui-composer-surface: color-mix\(in srgb, var\(--color-content\) (\d+)%/,
);
const cardPure = num(
  /html\[data-canvas-background="pure"\] \{[\s\S]*?--ui-card-surface: color-mix\(\s*in srgb,\s*var\(--color-content\) calc\((\d+)%/,
);
const focusInk = num(
  /html\[data-input-modality="keyboard"\]:root \{\s*--ui-focus-ring-color: color-mix\(in oklab, var\(--color-content\) (\d+)%, transparent\)/,
  arc,
);
const controlOnInk = num(
  /--ui-control-on: var\(\s*--user-accent-solid,\s*var\(\s*--user-accent-color,\s*color-mix\(in oklab, var\(--color-content\) (\d+)%/,
);

const themes = {
  dark: {
    ground: [0, 0, 0] as Rgb,
    ink: fromHsl(hue, saturation, 92),
    base: fromHsl(hue, saturation, darkLayerLightness),
    hover: hoverDark!,
    selected: selectedDark!,
    pressed: pressedDark!,
    chip: chipDark!,
  },
  light: {
    ground: [255, 255, 255] as Rgb,
    ink: fromHsl(hue, saturation * 0.35, 13),
    base: fromHsl(hue, saturation * 0.2, lightness),
    hover: hoverLight!,
    selected: selectedLight!,
    pressed: pressedLight!,
    chip: chipLight!,
  },
};

describe.each(Object.entries(themes))("%s pure canvas token contract", (name, t) => {
  const floating =
    name === "dark"
      ? mixOklab(t.base, t.ink, floatingDark)
      : mixOklab(
          t.base,
          t.ground,
          Math.max(0, Math.min(lightCap!, (lightness - lightFloor!) * lightFactor!)),
        );
  const hosts: [string, Rgb][] = [
    ["canvas", t.ground],
    ["floating", floating],
    ["hover row", mix(floating, t.ink, t.hover)],
    ["selected row", mix(floating, t.ink, t.selected)],
    ["selected row on canvas", mix(t.ground, t.ink, t.selected)],
  ];

  it("keeps the state ladder ascending with visible steps (SU-16)", () => {
    const hover = mix(t.ground, t.ink, t.hover);
    const selected = mix(t.ground, t.ink, t.selected);
    const pressed = mix(t.ground, t.ink, t.pressed);
    expect(t.hover).toBeLessThan(t.selected);
    expect(t.selected).toBeLessThan(t.pressed);
    expect(ratio(hover, t.ground)).toBeGreaterThanOrEqual(1.04);
    expect(ratio(selected, hover)).toBeGreaterThanOrEqual(t.ground[0] === 0 ? 1.04 : 1.15);
    expect(ratio(pressed, selected)).toBeGreaterThanOrEqual(1.04);
  });

  it("paints chips and key caps off every host, selected rows included (SU-01, SU-02, SU-21)", () => {
    for (const [name, host] of hosts) {
      expect(ratio(mix(host, t.ink, t.chip), host), name).toBeGreaterThanOrEqual(1.1);
    }
  });

  it("keeps the keyboard focus ring at 3:1 on every host (SU-03)", () => {
    for (const [name, host] of hosts) {
      expect(ratio(mix(host, t.ink, focusInk), host), name).toBeGreaterThanOrEqual(3);
    }
  });

  it("draws the neutral on-state and its glyph at 3:1 (SU-18)", () => {
    const on = mixOklab(t.ground, t.ink, controlOnInk);
    expect(ratio(on, t.ground)).toBeGreaterThanOrEqual(3);
    expect(ratio(on, t.ground)).toBeLessThan(ratio(t.ink, t.ground));
  });
});

describe("pure dark floating role (SU-07)", () => {
  const { ink, ground, base, selected } = themes.dark;
  const { min, max } = APPEARANCE_RANGES.surfaceContrast;

  it.each([min, 100, max])("sits above the Pure dark layers at %i%% contrast", (contrast) => {
    const strength = contrast / 100;
    const floating = mixOklab(base, ink, floatingDark * strength);
    expect(lum(floating)).toBeGreaterThanOrEqual(lum(mix(ground, ink, composerPure)));
    expect(lum(floating)).toBeGreaterThan(lum(mix(ground, ink, cardPure * strength)));
    expect(lum(floating)).toBeGreaterThan(lum(mix(ground, ink, selected * strength)));
    expect(ratio(floating, ground)).toBeGreaterThanOrEqual(1.1);
  });
});

describe("shared declarations", () => {
  it("derives the floating ground from one theme-layer recipe", () => {
    expect(index.match(/--ui-surface-floating:\s*color-mix\(/g)).toHaveLength(1);
    expect(index).toMatch(/--ui-floating-base:\s*var\(--ui-layer-base\);/);
    expect(index).toMatch(
      /--ui-surface-floating:\s*color-mix\(\s*in oklab,\s*var\(--ui-floating-lift-color\) var\(--ui-floating-lift\),\s*var\(--ui-floating-base\)\s*\);/,
    );
  });
  it("never paints the on-state with the saturated active hue (SU-18)", () => {
    expect(arc).not.toMatch(/--control-(on|fill):\s*var\(--color-active\)/);
  });

  it("gives key caps the translucent chip fill and no opaque border (SU-21)", () => {
    const kbd = kbdCss.slice(
      kbdCss.indexOf(".kbd {"),
      kbdCss.indexOf("}", kbdCss.indexOf(".kbd {")),
    );
    expect(kbd).toContain("background: var(--ui-tone-neutral-subtle)");
    expect(kbd).toContain("border: 1px solid transparent");
  });

  it("checked menu items show the glyph, not the selected fill (SU-20)", () => {
    const rows = readFileSync("src/shared/ui/ListRow.module.css", "utf8");
    expect(rows).toContain('[aria-checked="true"]:not([role^="menuitem"])');
  });

  it("skeleton bars use the translucent fill role, not a state role (SU-06)", () => {
    const css = readFileSync("src/shared/ui/arc/skeleton/skeleton.module.css", "utf8");
    expect(css).toContain("background: var(--ui-fill-muted)");
    expect(css).not.toContain("--ui-surface-selected");
  });
});
