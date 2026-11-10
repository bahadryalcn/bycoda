import { themePalette as P } from "../../../shared/theme/palette";
import type { CrewTheme } from "../../settings";
import { agentLayers } from "./memberAvatarAgent";
import { droidLayers } from "./memberAvatarDroid";
import { entLayers } from "./memberAvatarEnt";
import {
  AVATAR_GRID,
  composeAvatar,
  glassesFrame,
  isAvatarEye,
  METAL,
  RIM,
  SHIRT,
  type AvatarLayers,
  type AvatarRect,
} from "./memberAvatarShared";
import type { MemberAvatarTraits } from "./memberAvatarTraits";

export { AVATAR_GRID, isAvatarEye };
export type { AvatarRect };

const EYE = P.hex2a211b;
const SKIN = P.hexefbb92;
const SKIN_SHADE = P.hexcf926a;
const FRAME = P.hex3e3730;
const DARK_HAIR = P.hex3a2f28;
const GREY_HAIR = P.hexb9b3aa;

/** Outfit color sets: main, shade, light. Index is `MemberAvatarTraits.palette`. */
const OUTFITS: readonly (readonly [string, string, string])[] = [
  [P.hexb5853f, P.hex8b622b, P.hexd3a35c],
  [P.hex536044, P.hex383e36, P.hex75806b],
  [P.hex5f6677, P.hex474d5b, P.hex7e8795],
  [P.hex6c3033, P.hex49372b, P.hex85654a],
  [P.hex6b5744, P.hex45382c, P.hex8a7259],
  [P.hex626366, P.hex414349, P.hex8c877c],
];

function outfitRects(
  t: MemberAvatarTraits,
  [main, shade, light]: readonly [string, string, string],
) {
  const rects: AvatarRect[] = [];
  if (t.outfit === "cardigan") {
    rects.push(
      [3, 19, 18, 5, main],
      [3, 19, 3, 5, shade],
      [9, 19, 6, 2, SHIRT],
      [11, 21, 2, 3, SHIRT],
      [9, 21, 1, 3, light],
      [14, 21, 1, 3, light],
    );
  } else if (t.outfit === "vest") {
    rects.push(
      [3, 19, 18, 5, SHIRT],
      [6, 19, 12, 5, main],
      [6, 19, 2, 5, shade],
      [9, 19, 6, 2, SHIRT],
      [11, 21, 2, 3, SHIRT],
      [3, 19, 1, 5, P.hexb9b3aa],
    );
  } else {
    rects.push(
      [3, 19, 18, 5, main],
      [3, 19, 3, 5, shade],
      [9, 19, 6, 2, SHIRT],
      [11, 21, 2, 3, shade],
      [8, 19, 2, 5, light],
      [14, 19, 2, 5, light],
    );
  }
  return rects;
}

function headwearRects(
  t: MemberAvatarTraits,
  [main, shade, light]: readonly [string, string, string],
) {
  switch (t.headwear) {
    case "flat-cap":
      return [
        [6, 3, 12, 1, light],
        [5, 4, 14, 2, main],
        [6, 6, 12, 1, shade],
        [14, 6, 7, 2, shade],
        [15, 6, 5, 1, light],
      ] as AvatarRect[];
    case "takke":
      return [
        [8, 3, 8, 1, SHIRT],
        [7, 4, 10, 2, SHIRT],
        [7, 6, 10, 1, P.hexb9b3aa],
        [9, 4, 1, 1, P.hexf5e6d3],
        [12, 4, 1, 1, P.hexf5e6d3],
        [10, 5, 1, 1, P.hexf5e6d3],
        [14, 5, 1, 1, P.hexf5e6d3],
      ] as AvatarRect[];
    case "beret":
      return [
        [10, 1, 2, 1, shade],
        [9, 2, 7, 1, light],
        [5, 3, 13, 2, main],
        [3, 5, 13, 2, main],
        [3, 7, 4, 1, shade],
        [7, 7, 10, 1, shade],
      ] as AvatarRect[];
    case "bald":
      return [
        [8, 3, 8, 1, SKIN],
        [7, 4, 10, 1, SKIN],
        [9, 4, 4, 1, P.hexf5e6d3],
        [10, 3, 2, 1, P.hexf5e6d3],
        [5, 9, 1, 4, GREY_HAIR],
        [18, 9, 1, 4, GREY_HAIR],
      ] as AvatarRect[];
    default:
      return [
        [7, 3, 10, 1, GREY_HAIR],
        [6, 4, 12, 2, GREY_HAIR],
        [11, 2, 3, 1, GREY_HAIR],
        [5, 6, 2, 6, GREY_HAIR],
        [17, 6, 2, 6, GREY_HAIR],
        [4, 8, 1, 3, GREY_HAIR],
        [19, 8, 1, 3, GREY_HAIR],
        [7, 6, 3, 1, P.hexa09c8d],
      ] as AvatarRect[];
  }
}

function faceRects(t: MemberAvatarTraits) {
  const mouth: AvatarRect = [10, 16, 4, 1, SKIN_SHADE];
  switch (t.face) {
    case "walrus":
      return [
        [7, 13, 10, 3, DARK_HAIR],
        [7, 16, 2, 1, DARK_HAIR],
        [15, 16, 2, 1, DARK_HAIR],
        [7, 13, 2, 1, P.hex77695d],
        [15, 13, 2, 1, P.hex77695d],
      ] as AvatarRect[];
    case "bushy":
      return [
        [8, 13, 8, 2, DARK_HAIR],
        [8, 12, 2, 1, DARK_HAIR],
        [14, 12, 2, 1, DARK_HAIR],
        mouth,
      ] as AvatarRect[];
    case "short-beard":
      return [
        [6, 14, 12, 4, P.hex3e3730],
        [8, 13, 8, 1, P.hex3e3730],
        [10, 15, 4, 1, SKIN_SHADE],
        [7, 17, 10, 1, P.hex554b3d],
      ] as AvatarRect[];
    case "white-beard":
      return [
        [6, 13, 12, 5, SHIRT],
        [7, 18, 10, 1, SHIRT],
        [8, 13, 8, 1, P.hexb9b3aa],
        [10, 15, 4, 1, P.hexa09c8d],
        [8, 18, 8, 1, P.hexb9b3aa],
        [7, 19, 10, 1, FRAME],
      ] as AvatarRect[];
    default:
      return [mouth, [8, 15, 1, 1, SKIN_SHADE], [15, 15, 1, 1, SKIN_SHADE]] as AvatarRect[];
  }
}

/** Small item at the bottom front; `rim` outlines it against the outfit. */
function accessoryRects(t: MemberAvatarTraits): { rim: AvatarRect[]; art: AvatarRect[] } {
  switch (t.accessory) {
    case "tespih":
      return {
        rim: [[13, 19, 7, 5, RIM]],
        art: [
          [14, 20, 1, 1, P.hexf0a92e],
          [14, 21, 1, 1, P.hexffe08a],
          [15, 22, 1, 1, P.hexf0a92e],
          [16, 23, 1, 1, P.hexffe08a],
          [17, 22, 1, 1, P.hexf0a92e],
          [18, 21, 1, 1, P.hexffe08a],
          [18, 20, 1, 1, P.hexf0a92e],
        ],
      };
    case "magnifier":
      return {
        rim: [[15, 19, 5, 5, RIM]],
        art: [
          [15, 19, 4, 4, P.hexb0b8c4],
          [16, 20, 2, 2, P.hexe8eef2],
          [18, 22, 2, 2, P.hex8a7259],
        ],
      };
    case "brush":
      return {
        rim: [[15, 19, 3, 5, RIM]],
        art: [
          [16, 19, 1, 3, P.hex8a7259],
          [15, 22, 3, 1, P.hexb0b8c4],
          [15, 23, 3, 1, P.hex4078f2],
        ],
      };
    case "notebook":
      return {
        rim: [[14, 19, 7, 5, RIM]],
        art: [
          [14, 19, 6, 4, P.hex4078f2],
          [19, 19, 1, 4, SHIRT],
          [15, 20, 3, 1, SHIRT],
        ],
      };
    case "key":
      return {
        rim: [[16, 18, 5, 6, RIM]],
        art: [
          [17, 19, 3, 1, P.hexf4b942],
          [17, 21, 3, 1, P.hexf4b942],
          [17, 19, 1, 3, P.hexf4b942],
          [19, 19, 1, 3, P.hexf4b942],
          [18, 22, 1, 2, P.hexf4b942],
          [19, 23, 1, 1, P.hexf4b942],
        ],
      };
    case "wrench":
      return {
        rim: [[15, 18, 5, 6, RIM]],
        art: [
          [16, 19, 1, 2, P.hexb0b8c4],
          [18, 19, 1, 2, P.hexb0b8c4],
          [16, 21, 3, 1, P.hexb0b8c4],
          [17, 22, 1, 2, P.hexb0b8c4],
        ],
      };
    case "pen":
      return {
        rim: [[16, 18, 4, 6, RIM]],
        art: [
          [17, 19, 2, 4, P.hexe45649],
          [18, 19, 1, 2, SHIRT],
          [17, 23, 2, 1, EYE],
        ],
      };
    default:
      return { rim: [], art: [] };
  }
}

function classicLayers(t: MemberAvatarTraits): AvatarLayers {
  const outfit = OUTFITS[((t.palette % OUTFITS.length) + OUTFITS.length) % OUTFITS.length];
  const browColor = t.face === "white-beard" || t.headwear === "grey-hair" ? GREY_HAIR : DARK_HAIR;
  const browHeight = t.face === "bushy" ? 2 : 1;
  const body: AvatarRect[] = [
    ...outfitRects(t, outfit),
    [10, 17, 4, 2, SKIN_SHADE],
    [5, 10, 1, 3, SKIN_SHADE],
    [18, 10, 1, 3, SKIN_SHADE],
    [6, 5, 12, 13, SKIN],
    [6, 15, 2, 3, SKIN_SHADE],
    [16, 15, 2, 3, SKIN_SHADE],
    ...headwearRects(t, outfit),
    [11, 10, 2, 3, SKIN_SHADE],
    ...faceRects(t),
  ];
  const top: AvatarRect[] = [
    [8, 9 - browHeight, 3, browHeight, browColor],
    [13, 9 - browHeight, 3, browHeight, browColor],
    ...(t.glasses ? glassesFrame(METAL) : []),
  ];
  const eyes: AvatarRect[] = [
    [8, 9, 2, 2, EYE],
    [14, 9, 2, 2, EYE],
  ];
  return { body, top, eyes, accessory: accessoryRects(t) };
}

const THEME_LAYERS: Record<CrewTheme, (traits: MemberAvatarTraits) => AvatarLayers> = {
  classic: classicLayers,
  "star-wars": droidLayers,
  lotr: entLayers,
  matrix: agentLayers,
};

/**
 * Head-and-shoulders bust on a 24 x 24 grid, drawn back to front: dark rim first, then
 * outfit, head, headwear, beard, glasses, eyes and the accessory. `blink` squashes only
 * the two eye rects. `theme` (default classic) picks the character the same traits are
 * drawn as: uncle, protocol droid, Ent or Agent.
 */
export function memberAvatarRects(
  traits: MemberAvatarTraits,
  opts: { blink?: boolean; theme?: CrewTheme } = {},
): AvatarRect[] {
  return composeAvatar(THEME_LAYERS[opts.theme ?? "classic"](traits), Boolean(opts.blink));
}
