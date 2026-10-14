import { themePalette } from "../../../shared/theme/palette";
/** Integer-pixel scenery for the miniature bycoda crew. No character layer. */
export const SCENE_WIDTH = 1040;
export const SCENE_HEIGHT = 340;

const C = {
  night: themePalette.hex10151a,
  ceiling: themePalette.hex171b20,
  wall: themePalette.hex292a29,
  plaster: themePalette.hex34332d,
  plasterLight: themePalette.hex414038,
  mortar: themePalette.hex222628,
  brick: themePalette.hex423830,
  brickLight: themePalette.hex514238,
  woodDark: themePalette.hex29231f,
  wood: themePalette.hex49372b,
  woodLight: themePalette.hex69503a,
  woodEdge: themePalette.hex85654a,
  shadow: themePalette.hex17191a,
  floor: themePalette.hex292923,
  floorLight: themePalette.hex35332a,
  floorDark: themePalette.hex20241f,
  olive: themePalette.hex414936,
  leaf: themePalette.hex536044,
  leafLight: themePalette.hex657150,
  stem: themePalette.hex464837,
  glass: themePalette.hex404b4a,
  glassLight: themePalette.hex6f7e75,
  ivory: themePalette.hexb2aa8e,
  cream: themePalette.hexd0c5a4,
  amber: themePalette.hexa27d49,
  tea: themePalette.hex785035,
  red: themePalette.hex634737,
  rug: themePalette.hex403b31,
  rugEdge: themePalette.hex777055,
};

function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function arch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  // Explicit stair steps keep the arch pixelated even on a native-size canvas.
  const step = 6;
  rect(ctx, x, y + 30, w, h - 30, color);
  for (let row = 0; row < 5; row++) {
    const inset = (5 - row) * step;
    rect(ctx, x + inset, y + row * step, w - inset * 2, step, color);
  }
}

function windowFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  arch(ctx, x - 5, y - 5, w + 10, 139, C.woodDark);
  arch(ctx, x, y, w, 128, C.night);
  rect(ctx, x + 5, y + 33, w - 10, 89, themePalette.hex202c2b);
  rect(ctx, x + 9, y + 37, w - 18, 3, themePalette.hex3d4840);
  rect(ctx, x + 5, y + 82, w - 10, 4, C.wood);
  rect(ctx, x + Math.floor(w / 2) - 2, y + 26, 4, 100, C.woodLight);
  rect(ctx, x - 7, y + 126, w + 14, 7, C.woodLight);
  rect(ctx, x - 10, y + 133, w + 20, 3, C.woodDark);
  for (let k = 0; k < 3; k++) {
    rect(ctx, x + 11 + k * 7, y + 49 + k * 13, 2, 20, themePalette.hex384740);
  }
}

function lamp(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x - 1, 0, 2, y, C.woodDark);
  rect(ctx, x - 7, y, 14, 3, C.woodLight);
  rect(ctx, x - 11, y + 3, 22, 3, C.woodLight);
  rect(ctx, x - 14, y + 6, 28, 4, C.wood);
  rect(ctx, x - 9, y + 10, 18, 2, C.amber);
  rect(ctx, x - 5, y + 12, 10, 4, C.ivory);
  rect(ctx, x - 8, y + 16, 16, 2, C.woodDark);
  // A small stepped pool of warm reflected light, never a blurred glow.
  for (let row = 0; row < 6; row++) {
    rect(
      ctx,
      x - 14 - row * 5,
      y + 20 + row * 7,
      28 + row * 10,
      7,
      row < 2 ? themePalette.hex3b382b : themePalette.hex333229,
    );
  }
}

function foliage(ctx: CanvasRenderingContext2D, x: number, y: number, count: number) {
  for (let k = 0; k < count; k++) {
    const px = x + k * 17;
    const py = y + ((k * 13) % 4) * 7;
    rect(ctx, px, py, 4, 22, C.stem);
    rect(ctx, px - 9, py + 2, 12, 5, C.olive);
    rect(ctx, px - 6, py - 1, 9, 3, C.leaf);
    rect(ctx, px + 3, py + 9, 13, 5, C.leaf);
    rect(ctx, px + 5, py + 6, 8, 3, C.leafLight);
    rect(ctx, px - 5, py + 19, 10, 5, C.olive);
    if (k % 3 === 0) {
      rect(ctx, px + 5, py + 23, 3, 3, themePalette.hex48413e);
      rect(ctx, px + 8, py + 26, 3, 3, themePalette.hex39343a);
      rect(ctx, px + 4, py + 29, 3, 3, themePalette.hex454039);
    }
  }
}

function chair(ctx: CanvasRenderingContext2D, x: number, ground: number) {
  rect(ctx, x - 25, ground - 80, 5, 78, C.woodDark);
  rect(ctx, x + 20, ground - 80, 5, 78, C.woodDark);
  rect(ctx, x - 25, ground - 83, 50, 6, C.woodLight);
  rect(ctx, x - 23, ground - 67, 46, 4, C.wood);
  for (let k = 0; k < 4; k++) rect(ctx, x - 16 + k * 10, ground - 75, 3, 22, C.woodLight);
  rect(ctx, x - 26, ground - 37, 52, 6, C.wood);
  rect(ctx, x - 21, ground - 31, 4, 27, C.woodLight);
  rect(ctx, x + 16, ground - 31, 4, 27, C.woodLight);
  rect(ctx, x - 22, ground - 13, 44, 3, C.woodDark);
}

function table(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, bottom: number) {
  const left = x - Math.floor(width / 2);
  rect(ctx, left - 6, bottom, width + 12, 4, C.shadow);
  rect(ctx, left + 8, y + 12, 6, bottom - y - 12, C.woodDark);
  rect(ctx, left + width - 14, y + 12, 6, bottom - y - 12, C.woodDark);
  rect(ctx, left + 10, y + 14, 2, bottom - y - 17, C.woodLight);
  rect(ctx, left + 12, bottom - 13, width - 24, 4, C.wood);
  rect(ctx, left, y, width, 11, C.wood);
  rect(ctx, left + 3, y + 1, width - 6, 2, C.woodEdge);
  rect(ctx, left, y + 11, width, 5, C.woodDark);
  for (let k = 0; k < 3; k++) {
    rect(ctx, left + 10 + k * 24, y + 6, 17, 1, C.woodLight);
  }
}

function teaGlass(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x - 6, y + 8, 13, 2, C.ivory);
  rect(ctx, x - 4, y - 3, 8, 2, C.glassLight);
  rect(ctx, x - 3, y - 1, 6, 3, C.glass);
  rect(ctx, x - 2, y + 2, 4, 3, C.tea);
  rect(ctx, x - 3, y + 5, 6, 3, C.tea);
  rect(ctx, x - 3, y - 1, 1, 7, C.ivory);
  rect(ctx, x + 2, y, 1, 6, C.glassLight);
}

function kettle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  rect(ctx, x - 10, y + 6, 22, 10, themePalette.hex777567);
  rect(ctx, x - 7, y + 2, 16, 4, themePalette.hex8b8775);
  rect(ctx, x - 8, y + 16, 18, 2, C.woodDark);
  rect(ctx, x - 2, y - 1, 6, 3, C.woodDark);
  rect(ctx, x + 12, y + 3, 4, 7, C.woodDark);
  rect(ctx, x + 15, y + 5, 3, 8, C.woodDark);
  rect(ctx, x - 15, y + 5, 6, 3, themePalette.hex817f70);
  rect(ctx, x - 18, y + 2, 4, 5, themePalette.hex817f70);
  rect(ctx, x - 5, y + 7, 3, 7, themePalette.hex9a9480);
}

export function drawCrewEnvironment(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 0, 0, SCENE_WIDTH, SCENE_HEIGHT, C.night);
  rect(ctx, 0, 0, 1040, 212, C.wall);
  rect(ctx, 18, 19, 1005, 186, C.plaster);
  rect(ctx, 0, 0, 1040, 16, C.ceiling);
  for (let x = 0; x < 1040; x += 94) {
    rect(ctx, x, 14, 8, 20, C.woodDark);
    rect(ctx, x + 3, 16, 2, 16, C.wood);
  }
  rect(ctx, 0, 16, 1040, 4, C.woodLight);
  // Worn plaster has quiet, irregular patches rather than a uniform wall plane.
  for (let k = 0; k < 25; k++) {
    const x = 23 + ((k * 83) % 990);
    const y = 38 + ((k * 47) % 147);
    rect(ctx, x, y, 12 + (k % 4) * 8, 3 + (k % 3), k % 2 ? C.plasterLight : themePalette.hex302f29);
  }
  for (let y = 160; y < 214; y += 12) {
    for (let x = -20 + ((y / 12) % 2) * 22; x < 1040; x += 46) {
      rect(ctx, Math.floor(x), y, 42, 10, (x + y) % 3 ? C.brick : C.brickLight);
      rect(ctx, Math.floor(x) + 3, y + 1, 31, 1, C.woodLight);
    }
  }
  windowFrame(ctx, 83, 43, 122);
  windowFrame(ctx, 702, 42, 130);
  arch(ctx, 435, 24, 128, 190, C.woodDark);
  arch(ctx, 443, 32, 112, 182, themePalette.hex171f21);
  // The doorway looks into a courtyard: cobbles, a tree and distant masonry.
  rect(ctx, 449, 73, 100, 121, themePalette.hex242d28);
  rect(ctx, 450, 136, 99, 57, themePalette.hex35362d);
  for (let k = 0; k < 7; k++) rect(ctx, 452 + k * 14, 148 + (k % 3) * 11, 11, 3, themePalette.hex45463a);
  rect(ctx, 523, 81, 5, 55, C.wood);
  foliage(ctx, 475, 76, 4);
  rect(ctx, 432, 208, 134, 5, C.woodLight);
  rect(ctx, 427, 213, 144, 5, C.shadow);
  // Timber counter and working tea stove at the left of the central doorway.
  rect(ctx, 299, 133, 102, 62, C.woodDark);
  rect(ctx, 303, 142, 94, 43, C.wood);
  for (let x = 309; x < 394; x += 17) rect(ctx, x, 145, 2, 38, C.woodLight);
  rect(ctx, 293, 128, 113, 8, C.woodLight);
  rect(ctx, 316, 92, 37, 35, themePalette.hex4a4d47);
  rect(ctx, 312, 122, 45, 5, C.woodDark);
  rect(ctx, 327, 104, 15, 3, themePalette.hex77776a);
  rect(ctx, 332, 114, 7, 4, C.amber);
  kettle(ctx, 333, 78);
  teaGlass(ctx, 379, 119);
  rect(ctx, 283, 62, 111, 5, C.woodDark);
  rect(ctx, 282, 67, 114, 3, C.woodLight);
  for (let x = 297; x < 391; x += 18) teaGlass(ctx, x, 52);
  // Newspaper shelf and a framed, text-free noticeboard.
  rect(ctx, 902, 87, 80, 44, C.woodDark);
  rect(ctx, 907, 92, 70, 33, themePalette.hex55534a);
  rect(ctx, 916, 98, 21, 18, C.ivory);
  rect(ctx, 943, 99, 23, 22, themePalette.hex868472);
  for (let y = 103; y < 115; y += 4) rect(ctx, 919, y, 13, 1, themePalette.hex777566);
  rect(ctx, 889, 156, 102, 5, C.woodLight);
  for (let x = 898; x < 982; x += 18) {
    rect(ctx, x, 138, 14, 18, themePalette.hexa29d86);
    rect(ctx, x + 3, 141, 8, 2, themePalette.hex65675d);
    rect(ctx, x + 3, 147, 8, 1, themePalette.hex787969);
  }
  lamp(ctx, 239, 42);
  lamp(ctx, 640, 35);
  lamp(ctx, 921, 39);
  // Grape vines follow the upper wall, spilling beside the window and doorway.
  rect(ctx, 585, 27, 434, 3, C.stem);
  foliage(ctx, 588, 25, 24);
  foliage(ctx, 16, 52, 4);
  rect(ctx, 14, 156, 28, 40, C.wood);
  rect(ctx, 10, 152, 36, 7, C.woodLight);
  rect(ctx, 18, 188, 20, 8, C.woodDark);
  // Perspective floor: horizontal seams become wider towards the viewer.
  rect(ctx, 0, 215, 1040, 125, C.floor);
  rect(ctx, 0, 216, 1040, 3, C.woodDark);
  for (let row = 0; row < 7; row++) {
    const y = 221 + row * 17;
    for (let col = 0; col < 14; col++) {
      const x = col * 80 - (row % 2) * 35;
      rect(ctx, x, y, 77, 14, (row + col) % 3 === 0 ? C.floorLight : C.floorDark);
      rect(ctx, x + 9, y + 10, 47, 1, C.floor);
    }
  }
  // A patterned woven kilim grounds the central tea conversation.
  rect(ctx, 315, 278, 347, 44, C.rug);
  rect(ctx, 318, 281, 341, 2, C.rugEdge);
  rect(ctx, 318, 316, 341, 2, C.rugEdge);
  for (let x = 330; x < 649; x += 31) {
    rect(ctx, x, 293, 15, 13, C.red);
    rect(ctx, x + 3, 289, 9, 4, C.rugEdge);
    rect(ctx, x + 3, 306, 9, 4, C.rugEdge);
    rect(ctx, x + 6, 295, 3, 8, C.ivory);
  }
  for (let x = 319; x < 659; x += 7) rect(ctx, x, 321, 2, 3, C.woodLight);
  for (const [x, ground] of [
    [125, 300],
    [255, 280],
    [410, 254],
    [540, 250],
    [690, 270],
    [820, 292],
    [945, 309],
  ]) {
    chair(ctx, x, ground);
  }
  table(ctx, 190, 232, 92, 291);
  table(ctx, 475, 231, 90, 282);
  table(ctx, 755, 239, 94, 306);
  table(ctx, 930, 263, 54, 321);
}

function checker(ctx: CanvasRenderingContext2D, x: number, y: number, cream: boolean) {
  rect(ctx, x + 1, y, 4, 1, cream ? C.cream : themePalette.hex11181b);
  rect(ctx, x, y + 1, 6, 3, cream ? C.ivory : themePalette.hex1c2427);
  rect(ctx, x + 1, y + 4, 4, 1, C.woodDark);
  rect(ctx, x + 2, y + 1, 2, 1, cream ? themePalette.hexe0d2ad : themePalette.hex444b4a);
}

function tavla(ctx: CanvasRenderingContext2D, x: number, y: number, phase: number) {
  // Open wooden box, two leaves, twelve alternating points on EACH side.
  rect(ctx, x - 41, y - 23, 82, 30, C.woodDark);
  rect(ctx, x - 39, y - 22, 78, 27, C.woodEdge);
  rect(ctx, x - 37, y - 20, 74, 22, themePalette.hex988365);
  rect(ctx, x - 2, y - 21, 4, 25, C.woodDark);
  for (let side = 0; side < 2; side++) {
    for (let point = 0; point < 12; point++) {
      const px = x - 36 + point * 6;
      const color = point % 2 === side ? C.woodDark : C.ivory;
      for (let row = 0; row < 9; row++) {
        const width = row < 3 ? 5 : row < 6 ? 3 : 1;
        const py = side === 0 ? y - 19 + row : y + 1 - row;
        rect(ctx, px + Math.floor((5 - width) / 2), py, width, 1, color);
      }
    }
  }
  for (let k = 0; k < 3; k++) checker(ctx, x - 35, y - 19 + k * 5, true);
  for (let k = 0; k < 2; k++) checker(ctx, x + 29, y - 8 + k * 5, false);
  checker(ctx, x - 17, y - 18, false);
  checker(ctx, x + 11, y - 3, true);
  // One quiet positional variation is enough to show a living table.
  checker(ctx, x + (Math.floor(phase / 6) % 2 ? 5 : -8), y - 15, false);
  rect(ctx, x - 8, y - 7, 4, 4, C.cream);
  rect(ctx, x - 7, y - 6, 1, 1, C.woodDark);
  rect(ctx, x - 6, y - 5, 1, 1, C.woodDark);
  rect(ctx, x + 4, y - 11, 4, 4, C.cream);
  rect(ctx, x + 5, y - 10, 1, 1, C.woodDark);
  rect(ctx, x + 6, y - 9, 1, 1, C.woodDark);
  rect(ctx, x - 41, y + 5, 82, 3, C.wood);
}

/** Table objects are painted before sitters, allowing their hands to reach onto the boards. */
export function drawCrewForeground(ctx: CanvasRenderingContext2D, phase: number): void {
  tavla(ctx, 190, 232, phase);
  tavla(ctx, 755, 239, phase + 3);
  teaGlass(ctx, 456, 224);
  teaGlass(ctx, 493, 223);
  rect(ctx, 469, 227, 14, 5, C.woodDark);
  rect(ctx, 472, 225, 8, 3, C.ivory);
  rect(ctx, 475, 226, 2, 2, C.cream);
  teaGlass(ctx, 937, 257);
  // The folded paper is an object, never readable canvas text.
  rect(ctx, 909, 249, 17, 15, themePalette.hexaaa48d);
  rect(ctx, 910, 250, 14, 2, C.woodDark);
  for (let y = 255; y < 263; y += 3) {
    rect(ctx, 911, y, 5, 1, themePalette.hex696a60);
    rect(ctx, 919, y, 5, 1, themePalette.hex696a60);
  }
}
