import { themePalette as P } from "../../../shared/theme/palette";
import {
  beadRects,
  METAL,
  NO_ITEM,
  paletteIndex,
  sharedItemRects,
  type AvatarLayers,
  type AvatarRect,
  type ColorSet,
} from "./memberAvatarShared";
import type { MemberAvatarTraits } from "./memberAvatarTraits";

const SKIN = P.hexf5e6d3;
const SKIN_SHADE = P.hexd6a77a;
const HAIR = P.hex3a2f28;
const LENS = P.hex10151a;
const GLINT = P.hex7ee787;
const EYE = P.hex2a211b;
const SHIRT = P.hexe8eef2;

/** Suits per palette index: black, bottle green, slate, burgundy, brown, charcoal. */
const SUITS: readonly ColorSet[] = [
  [P.hex1d2428, LENS, P.hex2e2e2e],
  [P.hex383e36, P.hex29231f, P.hex536044],
  [P.hex474d5b, P.hex2e2e2e, P.hex5f6677],
  [P.hex6c3033, P.hex29231f, P.hex85654a],
  [P.hex45382c, P.hex29231f, P.hex6b5744],
  [P.hex626366, P.hex414349, P.hex8c877c],
];

function suit(t: MemberAvatarTraits, [main, shade, light]: ColorSet): AvatarRect[] {
  const base: AvatarRect[] = [
    [3, 19, 18, 5, main],
    [3, 19, 3, 5, shade],
    [18, 19, 3, 5, shade],
  ];
  if (t.outfit === "cardigan") {
    // open collar, no tie
    return [
      ...base,
      [9, 19, 6, 3, SHIRT],
      [10, 22, 4, 2, SHIRT],
      [8, 19, 1, 5, light],
      [15, 19, 1, 5, light],
    ];
  }
  if (t.outfit === "vest") {
    return [...base, [8, 19, 8, 5, SHIRT], [9, 21, 6, 3, light], [11, 19, 2, 2, LENS]];
  }
  return [
    ...base,
    [9, 19, 6, 2, SHIRT],
    [11, 21, 2, 3, LENS],
    [8, 19, 1, 5, light],
    [15, 19, 1, 5, light],
  ];
}

function hair(t: MemberAvatarTraits): AvatarRect[] {
  switch (t.headwear) {
    case "flat-cap":
      return [
        [6, 3, 12, 3, HAIR],
        [6, 6, 12, 1, HAIR],
        [5, 6, 1, 4, HAIR],
        [18, 6, 1, 4, HAIR],
      ];
    case "takke":
      return [
        [6, 3, 12, 3, HAIR],
        [6, 6, 5, 1, HAIR],
        [11, 5, 6, 1, P.hexa09c8d],
        [5, 6, 1, 4, HAIR],
        [18, 6, 1, 4, HAIR],
      ];
    case "beret":
      return [
        [6, 3, 12, 3, HAIR],
        [6, 6, 8, 2, HAIR],
        [14, 6, 2, 1, HAIR],
        [11, 2, 5, 1, HAIR],
      ];
    case "bald":
      return [
        [8, 4, 8, 1, SKIN],
        [7, 5, 10, 1, SKIN],
        [5, 8, 1, 4, SKIN_SHADE],
        [18, 8, 1, 4, SKIN_SHADE],
        [9, 5, 3, 1, SHIRT],
      ];
    default:
      return [
        [6, 3, 12, 3, METAL],
        [6, 6, 12, 1, METAL],
        [5, 6, 1, 4, METAL],
        [18, 6, 1, 4, METAL],
        [9, 3, 4, 1, SHIRT],
      ];
  }
}

function jaw(t: MemberAvatarTraits): AvatarRect[] {
  const mouth: AvatarRect = [10, 16, 4, 1, SKIN_SHADE];
  switch (t.face) {
    case "walrus":
      return [mouth, [8, 14, 8, 1, SKIN_SHADE], [8, 17, 8, 1, SKIN_SHADE]];
    case "bushy":
      return [mouth, [7, 7, 4, 1, HAIR], [13, 7, 4, 1, HAIR]];
    case "short-beard":
      return [
        mouth,
        [7, 15, 1, 3, SKIN_SHADE],
        [16, 15, 1, 3, SKIN_SHADE],
        [8, 17, 8, 1, SKIN_SHADE],
        [9, 18, 6, 1, SKIN_SHADE],
      ];
    case "white-beard":
      return [mouth, [7, 14, 1, 4, METAL], [16, 14, 1, 4, METAL], [8, 17, 8, 1, METAL]];
    default:
      return [mouth];
  }
}

function accessory(t: MemberAvatarTraits) {
  if (t.accessory === "tespih") return beadRects(METAL, P.hex8c877c);
  return (
    sharedItemRects(t.accessory, {
      main: METAL,
      accent: P.hex626366,
      light: P.hex7e8795,
      ink: LENS,
    }) ?? NO_ITEM
  );
}

/**
 * Agent bust: pale face with dark hair, a wire earpiece and a dark suit. Glasses become the
 * wrap-around lens with a green glint (the eyes); without them the eyes are bare.
 */
export function agentLayers(t: MemberAvatarTraits): AvatarLayers {
  const suitColors = SUITS[paletteIndex(t, SUITS.length)];
  const body: AvatarRect[] = [
    ...suit(t, suitColors),
    [10, 17, 4, 2, SKIN_SHADE],
    [5, 10, 1, 3, SKIN_SHADE],
    [18, 10, 1, 3, SKIN_SHADE],
    [6, 5, 12, 13, SKIN],
    [6, 15, 2, 3, SKIN_SHADE],
    [16, 15, 2, 3, SKIN_SHADE],
    ...hair(t),
    [11, 10, 2, 3, SKIN_SHADE],
    ...jaw(t),
    [4, 11, 1, 5, METAL],
    [5, 15, 1, 1, METAL],
  ];
  const top: AvatarRect[] = t.glasses
    ? [
        [6, 8, 12, 4, LENS],
        [11, 9, 2, 1, METAL],
      ]
    : [
        [8, 8, 3, 1, HAIR],
        [13, 8, 3, 1, HAIR],
      ];
  const eyeColor = t.glasses ? GLINT : EYE;
  return {
    body,
    top,
    eyes: [
      [8, 9, 2, 2, eyeColor],
      [14, 9, 2, 2, eyeColor],
    ],
    accessory: accessory(t),
  };
}
