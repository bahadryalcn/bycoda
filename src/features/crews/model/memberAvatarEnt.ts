import { themePalette as P } from "../../../shared/theme/palette";
import {
  beadRects,
  glassesFrame,
  NO_ITEM,
  paletteIndex,
  sharedItemRects,
  type AvatarLayers,
  type AvatarRect,
  type ColorSet,
} from "./memberAvatarShared";
import type { MemberAvatarTraits } from "./memberAvatarTraits";

const EYE = P.hexf4b942;
const BARK_DEEP = P.hex29231f;
const LEAF = P.hex657150;
const LEAF_DARK = P.hex536044;
const LEAF_LIT = P.hexb5d984;
const MOSS = P.hex75806b;

/** Bark per palette index: oak brown, leafy, stone grey, red cedar, dark root, birch. */
const BARK: readonly ColorSet[] = [
  [P.hex69503a, P.hex49372b, P.hex85654a],
  [LEAF, LEAF_DARK, LEAF_LIT],
  [P.hex5f6677, P.hex474d5b, P.hex7e8795],
  [P.hex6c3033, P.hex49372b, P.hex85654a],
  [P.hex3e3730, BARK_DEEP, P.hex6b5744],
  [P.hex8c877c, P.hex626366, P.hexb9b3aa],
];

function trunk(t: MemberAvatarTraits, [main, shade, light]: ColorSet): AvatarRect[] {
  const grain: AvatarRect[] = [
    [8, 20, 1, 4, shade],
    [15, 20, 1, 4, shade],
  ];
  if (t.outfit === "cardigan") {
    return [
      [3, 19, 18, 5, main],
      [3, 19, 3, 5, shade],
      [8, 19, 3, 2, MOSS],
      [14, 21, 4, 2, LEAF_DARK],
      [12, 22, 1, 2, light],
      ...grain,
    ];
  }
  if (t.outfit === "vest") {
    return [
      [3, 19, 18, 5, shade],
      [6, 19, 12, 5, main],
      [6, 21, 12, 1, MOSS],
      [6, 19, 1, 5, light],
      [17, 19, 1, 5, light],
    ];
  }
  return [
    [3, 19, 18, 5, main],
    [3, 19, 3, 5, shade],
    [18, 19, 3, 5, shade],
    ...grain,
    [11, 20, 2, 4, BARK_DEEP],
  ];
}

function crown(t: MemberAvatarTraits, [main, shade, light]: ColorSet): AvatarRect[] {
  switch (t.headwear) {
    case "flat-cap":
      return [
        [6, 3, 12, 2, LEAF_DARK],
        [5, 5, 14, 1, LEAF],
        [8, 2, 3, 1, LEAF_LIT],
        [16, 4, 4, 1, LEAF_DARK],
      ];
    case "takke":
      return [
        [7, 3, 10, 2, MOSS],
        [8, 2, 8, 1, MOSS],
        [7, 5, 10, 1, LEAF_DARK],
      ];
    case "beret":
      return [
        [7, 4, 10, 2, main],
        [10, 2, 4, 2, LEAF],
        [11, 1, 2, 1, LEAF_LIT],
      ];
    case "bald":
      return [
        [8, 3, 8, 1, shade],
        [7, 4, 10, 2, main],
        [10, 3, 3, 1, light],
      ];
    default:
      return [
        [7, 3, 10, 2, main],
        [4, 5, 3, 4, LEAF_DARK],
        [17, 5, 3, 4, LEAF_DARK],
        [8, 2, 3, 1, MOSS],
        [13, 2, 3, 1, MOSS],
        [9, 4, 6, 1, P.hexb9b3aa],
      ];
  }
}

function mouth(t: MemberAvatarTraits, [, shade, light]: ColorSet): AvatarRect[] {
  const slit: AvatarRect = [8, 16, 8, 1, BARK_DEEP];
  switch (t.face) {
    case "walrus":
      return [slit, [7, 15, 10, 1, light], [7, 17, 2, 1, shade], [15, 17, 2, 1, shade]];
    case "bushy":
      return [slit, [7, 14, 10, 2, MOSS], [7, 17, 10, 1, LEAF_DARK]];
    case "short-beard":
      return [slit, [7, 17, 10, 3, shade], [8, 20, 8, 1, shade]];
    case "white-beard":
      return [slit, [6, 16, 12, 4, P.hexb9b3aa], [8, 20, 8, 1, P.hexb9b3aa], [9, 17, 6, 1, MOSS]];
    default:
      return [[10, 16, 4, 1, shade]];
  }
}

function accessory(t: MemberAvatarTraits, [, shade, light]: ColorSet) {
  if (t.accessory === "tespih") return beadRects(P.hexe45649, LEAF_LIT);
  return (
    sharedItemRects(t.accessory, {
      main: shade === BARK_DEEP ? P.hex6b5744 : P.hex8a7259,
      accent: LEAF,
      light: light === LEAF_LIT ? P.hexe8eef2 : LEAF_LIT,
      ink: BARK_DEEP,
    }) ?? NO_ITEM
  );
}

/** Ent bust: a bark face under a leafy crown, a mouth slit, amber eyes and a mossy trunk. */
export function entLayers(t: MemberAvatarTraits): AvatarLayers {
  const bark = BARK[paletteIndex(t, BARK.length)];
  const [main, shade, light] = bark;
  const body: AvatarRect[] = [
    ...trunk(t, bark),
    [9, 17, 6, 2, shade],
    [6, 5, 12, 13, main],
    [6, 5, 2, 13, shade],
    [16, 5, 2, 13, shade],
    [5, 9, 1, 4, shade],
    [18, 9, 1, 4, shade],
    ...crown(t, bark),
    [4, 3, 3, 2, LEAF_DARK],
    [17, 3, 3, 2, LEAF_DARK],
    [4, 2, 2, 1, LEAF_LIT],
    [18, 2, 2, 1, LEAF_LIT],
    [8, 8, 3, 4, shade],
    [13, 8, 3, 4, shade],
    [11, 10, 2, 4, light],
    ...mouth(t, bark),
  ];
  const top: AvatarRect[] = [
    [8, 7, 3, 1, BARK_DEEP],
    [13, 7, 3, 1, BARK_DEEP],
    ...(t.glasses ? glassesFrame(MOSS) : []),
  ];
  return {
    body,
    top,
    eyes: [
      [8, 9, 2, 2, EYE],
      [14, 9, 2, 2, EYE],
    ],
    accessory: accessory(t, bark),
  };
}
