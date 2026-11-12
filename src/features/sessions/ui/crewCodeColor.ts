import { themePalette } from "../../../shared/theme/palette";
import type { CrewActivity } from "./crewMotion";
import type { CrewPlace } from "./crewLayout";

/** Same stable palette roles as the rigged crews; luminance still comes from the original mask. */
export function classicAccent(id: number): string {
  return [
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hexfa7384,
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hexcbb6ed,
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hex75cfff,
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hexb5d984,
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hex84dfae,
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hexd6a064,
  ][id % 6];
}
function regionColor(id: number, region: number): string {
  return [
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hexfff,
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hexd6a064,
    classicAccent(id),
    classicAccent(id),
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hex8eafff,
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hex565656,
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hexd0d0d0,
    // ui-drift-ignore: theme-palette-literal -- Code-art pigment preserves artwork, not UI surface styling.
    themePalette.hexfa7384,
  ][region];
}
/** Red retains tone; green carries a palette region; blue carries its horizontal fill edge. */
export function classicInk(
  value: number,
  charge: number | undefined,
  id: number,
  region: number,
  edge = 0,
) {
  return charge !== undefined && charge > 0 && region > 0
    ? `rgb(${value},${(id % 6) * 7 + region},${edge})`
    : `rgb(${value},${value},${value})`;
}
/** Per-member edge travels with its ink, so overflow members never share a context level. */
export function classicColorEdge(
  place: CrewPlace,
  activity: CrewActivity | undefined,
  rows: number,
) {
  const charge = activity?.charge;
  if (charge === undefined || charge <= 0) return 255;
  const bottom = place.y + 70;
  const top = bottom - (214 + (activity?.stand ?? 0) * 48) * place.scale;
  return charge >= 1 ? 0 : Math.ceil(((bottom - (bottom - top) * charge) * rows) / 390);
}
export function classicColorTable() {
  const table = new Uint8Array(1024);
  for (let id = 0; id < 6; id++)
    for (let region = 1; region <= 7; region++) {
      const rgb = regionColor(id, region).replace("#", "");
      const value = Number.parseInt(
        rgb.length === 3
          ? rgb
              .split("")
              .map((c) => c + c)
              .join("")
          : rgb,
        16,
      );
      table.set([value >> 16, (value >> 8) & 255, value & 255, 255], (id * 7 + region) * 4);
    }
  return table;
}
/** Choose the same most-covered sample in both backends; never average region identifiers. */
export function sampleColorTag(pixels: Uint8ClampedArray, offset: number, stride: number) {
  let best = offset;
  for (const at of [offset + 4, offset + stride, offset + stride + 4])
    if (pixels[at + 3] > pixels[best + 3]) best = at;
  return pixels[best] === pixels[best + 1] && pixels[best] === pixels[best + 2]
    ? 0
    : pixels[best + 1] | (pixels[best + 2] << 8);
}
export function colorCell(sample: number, row: number) {
  return row >= sample >> 8 ? sample & 255 : 0;
}
