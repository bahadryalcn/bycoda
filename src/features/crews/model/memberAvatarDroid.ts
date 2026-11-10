import { themePalette as P } from "../../../shared/theme/palette";
import {
  beadRects,
  glassesFrame,
  METAL,
  NO_ITEM,
  paletteIndex,
  sharedItemRects,
  type AvatarLayers,
  type AvatarRect,
  type ColorSet,
} from "./memberAvatarShared";
import type { MemberAvatarTraits } from "./memberAvatarTraits";

const JOINT = P.hex42474b;
const SOCKET = P.hex29231f;
const EYE = P.hexffe08a;
const SILVER_SHADE = P.hex7e8795;
const BRIGHT = P.hexe8eef2;

/** Plating per palette index: amber gold, green, silver, red, bronze, steel. */
const PLATING: readonly ColorSet[] = [
  [P.hexd19a2f, P.hex9c6300, P.hexf4b942],
  [P.hex536044, P.hex383e36, P.hex75806b],
  [METAL, SILVER_SHADE, BRIGHT],
  [P.hexe45649, P.hex6c3033, P.hex85654a],
  [P.hex85654a, P.hex49372b, P.hex8a7259],
  [P.hex626366, P.hex414349, P.hex8c877c],
];

function torso(t: MemberAvatarTraits, [main, shade, light]: ColorSet): AvatarRect[] {
  if (t.outfit === "cardigan") {
    return [
      [3, 19, 18, 5, main],
      [3, 19, 3, 5, shade],
      [9, 19, 6, 3, light],
      [11, 22, 2, 2, JOINT],
      [7, 19, 1, 5, shade],
      [16, 19, 1, 5, shade],
    ];
  }
  if (t.outfit === "vest") {
    return [
      [3, 19, 18, 5, JOINT],
      [6, 19, 12, 5, main],
      [6, 19, 2, 5, shade],
      [9, 19, 6, 2, METAL],
      [10, 21, 4, 3, SILVER_SHADE],
    ];
  }
  return [
    [3, 19, 18, 5, main],
    [3, 19, 5, 5, shade],
    [16, 19, 5, 5, shade],
    [8, 21, 8, 1, JOINT],
    [11, 19, 2, 2, light],
  ];
}

function headwear(t: MemberAvatarTraits, [main, shade, light]: ColorSet): AvatarRect[] {
  switch (t.headwear) {
    case "flat-cap":
      return [
        [7, 3, 10, 2, METAL],
        [6, 5, 12, 1, SILVER_SHADE],
        [8, 3, 3, 1, BRIGHT],
      ];
    case "takke":
      return [
        [8, 3, 8, 1, light],
        [7, 4, 10, 2, light],
        [7, 6, 10, 1, shade],
        [11, 1, 2, 1, light],
        [12, 2, 1, 1, light],
      ];
    case "beret":
      return [
        [15, 0, 3, 1, P.hexe45649],
        [16, 1, 1, 3, METAL],
        [4, 8, 2, 4, METAL],
        [18, 8, 2, 4, METAL],
        [7, 3, 10, 3, main],
      ];
    case "bald":
      return [
        [8, 3, 8, 1, light],
        [7, 4, 10, 2, main],
      ];
    default:
      return [
        [7, 3, 10, 1, METAL],
        [6, 4, 12, 2, main],
        [6, 4, 12, 1, METAL],
        [11, 2, 3, 1, METAL],
        [5, 7, 1, 4, METAL],
        [18, 7, 1, 4, METAL],
      ];
  }
}

function face(t: MemberAvatarTraits, [, shade, light]: ColorSet): AvatarRect[] {
  switch (t.face) {
    case "walrus":
      return [
        [7, 14, 10, 3, JOINT],
        [7, 14, 10, 1, SILVER_SHADE],
        [9, 16, 1, 1, METAL],
        [12, 16, 1, 1, METAL],
        [14, 16, 1, 1, METAL],
      ];
    case "bushy":
      return [
        [8, 14, 8, 2, JOINT],
        [8, 15, 8, 1, METAL],
        [7, 7, 4, 1, P.hexe45649],
        [13, 7, 4, 1, P.hex4078f2],
      ];
    case "short-beard":
      return [
        [7, 15, 10, 4, shade],
        [9, 15, 6, 1, JOINT],
        [8, 18, 8, 1, SOCKET],
      ];
    case "white-beard":
      return [
        [7, 14, 10, 5, METAL],
        [9, 15, 6, 1, JOINT],
        [8, 17, 8, 1, light],
        [8, 18, 8, 1, SILVER_SHADE],
      ];
    default:
      return [
        [10, 15, 4, 1, JOINT],
        [8, 16, 8, 1, shade],
      ];
  }
}

function accessory(t: MemberAvatarTraits, [main]: ColorSet) {
  if (t.accessory === "tespih") return beadRects(P.hex4078f2, BRIGHT);
  return (
    sharedItemRects(t.accessory, {
      main: METAL,
      accent: main,
      light: BRIGHT,
      ink: JOINT,
    }) ?? NO_ITEM
  );
}

/** Protocol-droid bust: plated dome, glowing photoreceptor eyes, no mouth, joints at the neck. */
export function droidLayers(t: MemberAvatarTraits): AvatarLayers {
  const plating = PLATING[paletteIndex(t, PLATING.length)];
  const [main, shade] = plating;
  const body: AvatarRect[] = [
    ...torso(t, plating),
    [10, 18, 4, 2, JOINT],
    [9, 18, 1, 2, P.hexe45649],
    [14, 18, 1, 2, P.hex4078f2],
    [6, 4, 12, 14, main],
    [7, 3, 10, 1, main],
    [6, 14, 2, 4, shade],
    [16, 14, 2, 4, shade],
    [5, 10, 1, 3, METAL],
    [18, 10, 1, 3, METAL],
    ...headwear(t, plating),
    [7, 8, 4, 4, SOCKET],
    [13, 8, 4, 4, SOCKET],
    [7, 7, 10, 1, JOINT],
    ...face(t, plating),
  ];
  const top: AvatarRect[] = t.glasses ? glassesFrame(METAL) : [];
  return {
    body,
    top,
    eyes: [
      [8, 9, 2, 2, EYE],
      [14, 9, 2, 2, EYE],
    ],
    accessory: accessory(t, plating),
  };
}
