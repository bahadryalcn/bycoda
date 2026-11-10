import { themePalette as P } from "../../../shared/theme/palette";
import type { MemberAvatarTraits } from "./memberAvatarTraits";

/** [x, y, w, h, color] on the 24 x 24 avatar grid. Data only, so any renderer can draw it. */
export type AvatarRect = [x: number, y: number, w: number, h: number, color: string];
export const AVATAR_GRID = 24;

/** Opaque, so overlapping rim rects form one uniform outline. */
export const RIM = P.hex171717;
export const METAL = P.hexb0b8c4;
export const SHIRT = P.hexece6d8;

/** Outfit color set: main, shade, light. Index is `MemberAvatarTraits.palette`. */
export type ColorSet = readonly [main: string, shade: string, light: string];

export const paletteIndex = (traits: MemberAvatarTraits, count: number) =>
  ((traits.palette % count) + count) % count;

/** Eye colors of every theme; an eye is a 2 x 2 rect in one of them. */
const EYE_COLORS: ReadonlySet<string> = new Set([
  P.hex2a211b, // classic and bare Agent eyes
  P.hexffe08a, // droid photoreceptor
  P.hexf4b942, // Ent eyes
  P.hex7ee787, // Agent lens glint
]);

/** The two open eyes; a renderer animating a blink targets exactly these. */
export const isAvatarEye = (rect: AvatarRect) =>
  rect[2] === 2 && rect[3] === 2 && EYE_COLORS.has(rect[4]);

export type AvatarLayers = {
  /** Silhouette parts, drawn after their rim. */
  body: AvatarRect[];
  /** Brows, glasses: drawn over the body, under the eyes. */
  top: AvatarRect[];
  /** Exactly the two open eye rects. */
  eyes: AvatarRect[];
  /** Small item at the bottom front; `rim` outlines it against the outfit. */
  accessory: { rim: AvatarRect[]; art: AvatarRect[] };
};

/** Rims whose silhouette pieces are the big parts only; small details stay inside them. */
const silhouette = (rect: AvatarRect) => rect[2] * rect[3] >= 4;

/** Back to front: rim, body, accessory rim, top, eyes (squashed on `blink`), accessory. */
export function composeAvatar(layers: AvatarLayers, blink: boolean): AvatarRect[] {
  const { body, top, eyes, accessory } = layers;
  const rim = body.filter(silhouette).map(([x, y, w, h]): AvatarRect => {
    const x0 = Math.max(0, x - 1);
    const y0 = Math.max(0, y - 1);
    return [
      x0,
      y0,
      Math.min(AVATAR_GRID, x + w + 1) - x0,
      Math.min(AVATAR_GRID, y + h + 1) - y0,
      RIM,
    ];
  });
  const eyeRects = blink ? eyes.map(([x, y, w, , c]): AvatarRect => [x, y + 1, w, 1, c]) : eyes;
  return [...rim, ...body, ...accessory.rim, ...top, ...eyeRects, ...accessory.art];
}

/** Thin frames: a 1 unit outline per lens, bridge and temples; the eyes stay open inside. */
export function glassesFrame(color: string): AvatarRect[] {
  const lens = (x: number): AvatarRect[] => [
    [x, 8, 4, 1, color],
    [x, 11, 4, 1, color],
    [x, 9, 1, 2, color],
    [x + 3, 9, 1, 2, color],
  ];
  return [...lens(7), ...lens(13), [11, 9, 2, 1, color], [6, 9, 1, 1, color], [17, 9, 1, 1, color]];
}

/** Colors a themed hand item is drawn in. `ink` must not be an eye color. */
export type ItemColors = { main: string; accent: string; light: string; ink: string };

/**
 * Items shared by the droid, Ent and Agent drawings: the same shapes as the classic
 * bust, recolored per theme. `tespih` is theme specific and handled by each theme.
 */
export function sharedItemRects(
  accessory: MemberAvatarTraits["accessory"],
  c: ItemColors,
): { rim: AvatarRect[]; art: AvatarRect[] } | undefined {
  switch (accessory) {
    case "magnifier":
      return {
        rim: [[15, 19, 5, 5, RIM]],
        art: [
          [15, 19, 4, 4, c.main],
          [16, 20, 2, 2, c.light],
          [18, 22, 2, 2, c.accent],
        ],
      };
    case "brush":
      return {
        rim: [[15, 19, 3, 5, RIM]],
        art: [
          [16, 19, 1, 3, c.accent],
          [15, 22, 3, 1, c.main],
          [15, 23, 3, 1, c.light],
        ],
      };
    case "notebook":
      return {
        rim: [[14, 19, 7, 5, RIM]],
        art: [
          [14, 19, 6, 4, c.main],
          [19, 19, 1, 4, c.light],
          [15, 20, 3, 1, c.light],
        ],
      };
    case "key":
      return {
        rim: [[16, 18, 5, 6, RIM]],
        art: [
          [17, 19, 3, 1, c.main],
          [17, 21, 3, 1, c.main],
          [17, 19, 1, 3, c.main],
          [19, 19, 1, 3, c.main],
          [18, 22, 1, 2, c.main],
          [19, 23, 1, 1, c.main],
        ],
      };
    case "wrench":
      return {
        rim: [[15, 18, 5, 6, RIM]],
        art: [
          [16, 19, 1, 2, c.main],
          [18, 19, 1, 2, c.main],
          [16, 21, 3, 1, c.main],
          [17, 22, 1, 2, c.main],
        ],
      };
    case "pen":
      return {
        rim: [[16, 18, 4, 6, RIM]],
        art: [
          [17, 19, 2, 4, c.accent],
          [18, 19, 1, 2, c.light],
          [17, 23, 2, 1, c.ink],
        ],
      };
    default:
      return undefined;
  }
}

/** Seven beads on a curve, rim behind; each theme picks the two bead colors. */
export function beadRects(a: string, b: string): { rim: AvatarRect[]; art: AvatarRect[] } {
  return {
    rim: [[13, 19, 7, 5, RIM]],
    art: [
      [14, 20, 1, 1, a],
      [14, 21, 1, 1, b],
      [15, 22, 1, 1, a],
      [16, 23, 1, 1, b],
      [17, 22, 1, 1, a],
      [18, 21, 1, 1, b],
      [18, 20, 1, 1, a],
    ],
  };
}

export const NO_ITEM = { rim: [], art: [] } as { rim: AvatarRect[]; art: AvatarRect[] };
