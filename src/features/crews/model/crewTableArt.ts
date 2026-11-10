import { themePalette as P } from "../../../shared/theme/palette";
import type { CrewTheme } from "../../settings";
import type { AvatarRect } from "./memberAvatarArt";
import { TABLE_SCENE, type CrewTableSeat, type CrewTableState } from "./crewTableLayout";

/** Colors of one theme's table and the props on it. */
type Kit = {
  top: string;
  edge: string;
  dark: string;
  accent: string;
  glass: string;
  glassLit: string;
  rim: string;
  board: string;
  boardLine: string;
  boardLight: string;
  checkerA: string;
  checkerB: string;
};

const KITS: Record<CrewTheme, Kit> = {
  classic: {
    top: P.hex8a7259,
    edge: P.hex6b5744,
    dark: P.hex45382c,
    accent: P.hex6b5744,
    glass: P.hexf0a92e,
    glassLit: P.hexffe08a,
    rim: P.hexece6d8,
    board: P.hex8b622b,
    boardLine: P.hex4a3520,
    boardLight: P.hexd3a35c,
    checkerA: P.hexece6d8,
    checkerB: P.hex2a211b,
  },
  "star-wars": {
    top: P.hexb0b8c4,
    edge: P.hex7e8795,
    dark: P.hex42474b,
    accent: P.hexf4b942,
    glass: P.hex65b4db,
    glassLit: P.hexe1ebf3,
    rim: P.hexb3c5d8,
    board: P.hex5c6370,
    boardLine: P.hex42474b,
    boardLight: P.hex7e8795,
    checkerA: P.hexf4b942,
    checkerB: P.hex2a211b,
  },
  lotr: {
    top: P.hex85654a,
    edge: P.hex69503a,
    dark: P.hex49372b,
    accent: P.hex536044,
    glass: P.hexd6a064,
    glassLit: P.hexfde68a,
    rim: P.hexece6d8,
    board: P.hex8b622b,
    boardLine: P.hex4a3520,
    boardLight: P.hexd3a35c,
    checkerA: P.hexece6d8,
    checkerB: P.hex2a211b,
  },
  matrix: {
    top: P.hex171a1a,
    edge: P.hex102016,
    dark: P.hex11181b,
    accent: P.hex00ff41,
    glass: P.hex00ff41,
    glassLit: P.hex7dffa0,
    rim: P.hex9fffb8,
    board: P.hex102016,
    boardLine: P.hex00ff41,
    boardLight: P.hex171a1a,
    checkerA: P.hex00ff41,
    checkerB: P.hex7dffa0,
  },
};

const TOP = TABLE_SCENE.tableTop;
const RIM = P.hex171717;
const SKIN = P.hexefbb92;
const SKIN_SHADE = P.hexcf926a;

function tableBody(theme: CrewTheme, k: Kit): AvatarRect[] {
  if (theme === "star-wars") {
    const stripes: AvatarRect[] = [];
    for (let x = 14; x < 226; x += 16) stripes.push([x, 86, 8, 3, k.accent]);
    return [
      [6, TOP, 228, 5, k.top],
      [10, TOP + 5, 220, 21, k.edge],
      ...stripes,
      [10, 92, 220, 4, k.dark],
    ];
  }
  if (theme === "lotr")
    return [
      [24, TOP, 192, 6, k.top],
      [20, TOP + 2, 4, 3, k.top],
      [216, TOP + 2, 4, 3, k.top],
      [30, TOP + 6, 180, 20, k.edge],
      [60, 78, 3, 14, k.dark],
      [118, 80, 3, 12, k.dark],
      [170, 77, 3, 14, k.dark],
      [24, TOP, 26, 2, k.accent],
      [190, TOP, 22, 2, k.accent],
      [28, 90, 14, 6, k.accent],
      [196, 92, 12, 4, k.accent],
    ];
  if (theme === "matrix")
    return [
      [8, TOP, 224, 2, k.accent],
      [8, TOP + 2, 224, 6, k.top],
      [12, TOP + 8, 216, 18, k.dark],
      [12, 84, 216, 1, k.edge],
      [12, 90, 216, 1, k.edge],
    ];
  return [
    [8, TOP, 224, 6, k.top],
    [12, TOP + 6, 216, 6, k.edge],
    [12, TOP + 12, 216, 2, k.dark],
    [20, 84, 6, 12, k.dark],
    [214, 84, 6, 12, k.dark],
  ];
}

const glass = (x: number, k: Kit): AvatarRect[] => [
  [x - 1, TOP - 1, 8, 1, k.rim],
  [x, TOP - 7, 6, 1, k.rim],
  [x + 1, TOP - 6, 4, 5, k.glass],
  [x + 1, TOP - 6, 1, 4, k.glassLit],
];

const overturnedGlass = (x: number, k: Kit): AvatarRect[] => [
  [x, TOP - 5, 1, 5, k.rim],
  [x + 1, TOP - 5, 6, 5, k.glass],
  [x + 1, TOP - 5, 6, 1, k.glassLit],
  [x + 7, TOP - 1, 12, 1, k.glass],
];

function board(open: boolean, k: Kit): AvatarRect[] {
  if (!open)
    return [
      [96, TOP - 6, 48, 6, k.board],
      [96, TOP - 6, 48, 1, k.boardLight],
      [119, TOP - 6, 2, 6, k.boardLine],
      [117, TOP - 4, 6, 2, k.boardLight],
    ];
  const points: AvatarRect[] = [];
  for (let i = 0; i < 6; i++)
    points.push([95 + i * 8, TOP - 4, 3, 4, i % 2 ? k.boardLine : k.boardLight]);
  return [
    [92, TOP - 5, 56, 5, k.board],
    ...points,
    [96, TOP - 6, 3, 2, k.checkerA],
    [112, TOP - 6, 3, 2, k.checkerB],
    [127, TOP - 6, 3, 2, k.checkerA],
    [140, TOP - 6, 3, 2, k.checkerB],
  ];
}

/** A raised hand beside the coordinator: the crew waits for the owner's decision. */
function raisedHand(seat: CrewTableSeat): AvatarRect[] {
  const x = seat.x + seat.size - 2;
  const y = seat.y + Math.round(seat.size * 0.25);
  return [
    [x - 1, y - 1, 7, 7, RIM],
    [x, y, 5, 5, SKIN],
    [x + 1, y + 5, 3, 14, SKIN_SHADE],
  ];
}

/** The table, its props and state signs on the 240 x 96 scene, drawn over the seated busts. */
export function crewTableRects(
  theme: CrewTheme,
  state: CrewTableState,
  seats: readonly CrewTableSeat[],
): AvatarRect[] {
  const k = KITS[theme];
  const rects = tableBody(theme, k);
  rects.push(...glass(26, k), ...glass(190, k), ...glass(208, k));
  rects.push(...(state === "blocked" ? overturnedGlass(40, k) : glass(44, k)));
  rects.push(...board(state === "working", k));
  const coordinator = seats.find((seat) => seat.role === "coordinator");
  if (state === "decision" && coordinator) rects.push(...raisedHand(coordinator));
  return rects;
}
