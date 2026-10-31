import { themePalette } from "../../../shared/theme/palette";

/** A theme palette: the surface tint (hue, saturation, dark lightness) and its accent. */
export type ThemePalettePreset = {
  name: string;
  note: string;
  hue: number;
  saturation: number;
  lightness: number;
  accent: string;
};

export const THEME_PALETTE_PRESETS: readonly ThemePalettePreset[] = [
  {
    name: "bycoda",
    note: "Cool silver, quiet surfaces",
    hue: 216,
    saturation: 24,
    lightness: 4,
    accent: themePalette.hexA3ACB8,
  },
  {
    name: "Olive",
    note: "A softer green workspace",
    hue: 150,
    saturation: 22,
    lightness: 7,
    accent: themePalette.hex69b68e,
  },
  {
    name: "Tide",
    note: "Clear blue, a little air",
    hue: 205,
    saturation: 30,
    lightness: 7,
    accent: themePalette.hex65b4db,
  },
  {
    name: "Kiln",
    note: "Warm clay, mellow light",
    hue: 25,
    saturation: 24,
    lightness: 7,
    accent: themePalette.hexdba276,
  },
  {
    name: "Dusk",
    note: "Muted violet, evening calm",
    hue: 275,
    saturation: 24,
    lightness: 7,
    accent: themePalette.hexb297d4,
  },
  {
    name: "Ink",
    note: "A study in neutral tones",
    hue: 216,
    saturation: 0,
    lightness: 5,
    accent: themePalette.hexb8b8b8,
  },
];

/**
 * The palette whose surface tint matches. Only surface values count: an accent override never
 * unselects a palette, and hue is meaningless at zero saturation (Ink is the neutral palette).
 * No match means the user's own custom surface colors are active.
 */
export function matchThemePalette(a: {
  themeHue: number;
  themeSaturation: number;
  themeDarkLightness: number;
}) {
  return THEME_PALETTE_PRESETS.find(
    (p) =>
      p.saturation === a.themeSaturation &&
      p.lightness === a.themeDarkLightness &&
      (p.saturation === 0 || p.hue === a.themeHue),
  );
}
