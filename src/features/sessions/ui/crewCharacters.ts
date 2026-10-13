/** Miniature hand-authored sprites. Every painted edge lands on an integer pixel. */
export type CrewAction = "idle" | "blink" | "talk" | "sip-lift" | "sip" | "play-reach" | "play";

type Point = readonly [number, number];
type Outfit = {
  shirt: string;
  shirtLight: string;
  coat: string;
  coatLight: string;
  pants: string;
  pantsLight: string;
};
const OUTFITS: readonly Outfit[] = [
  {
    shirt: "#928675",
    shirtLight: "#b1a18a",
    coat: "#554b3d",
    coatLight: "#70624b",
    pants: "#47473f",
    pantsLight: "#606052",
  },
  {
    shirt: "#8a8a79",
    shirtLight: "#a7a38b",
    coat: "#4a5051",
    coatLight: "#656d6a",
    pants: "#42474b",
    pantsLight: "#5b6162",
  },
  {
    shirt: "#8c877c",
    shirtLight: "#aaa293",
    coat: "#596055",
    coatLight: "#75806b",
    pants: "#48494b",
    pantsLight: "#626366",
  },
  {
    shirt: "#655658",
    shirtLight: "#85716d",
    coat: "#655658",
    coatLight: "#85716d",
    pants: "#424449",
    pantsLight: "#5a5d61",
  },
  {
    shirt: "#81796a",
    shirtLight: "#a1967e",
    coat: "#444b4d",
    coatLight: "#626b6b",
    pants: "#514b43",
    pantsLight: "#6c6153",
  },
  {
    shirt: "#929084",
    shirtLight: "#ada797",
    coat: "#514449",
    coatLight: "#716069",
    pants: "#414349",
    pantsLight: "#5b5d65",
  },
  {
    shirt: "#868178",
    shirtLight: "#a09c8d",
    coat: "#4e514a",
    coatLight: "#6e7163",
    pants: "#4a4c43",
    pantsLight: "#646654",
  },
];
const INK = "#28282a";
const SKIN = "#a18d78";
const SKIN_LIGHT = "#c0aa8e";
const SKIN_SHADE = "#786958";
const SILVER = "#b0afa0";

/** Filled polygon rasterizer. Integer scanlines replace antialiased canvas paths. */
function polygon(ctx: CanvasRenderingContext2D, color: string, points: readonly Point[]) {
  ctx.fillStyle = color;
  const low = Math.min(...points.map((point) => point[1]));
  const high = Math.max(...points.map((point) => point[1]));
  for (let y = low; y < high; y++) {
    const crossings: number[] = [];
    const row = y + 0.5;
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if ((ay <= row && by > row) || (by <= row && ay > row)) {
        crossings.push(ax + ((row - ay) * (bx - ax)) / (by - ay));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = Math.ceil(crossings[i] - 0.5);
      const right = Math.ceil(crossings[i + 1] - 0.5);
      if (right > left) ctx.fillRect(left, y, right - left, 1);
    }
  }
}

function rectangle(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w = 1,
  h = 1,
) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function glass(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Saucer, tiny narrow-waisted glass, deep unsweetened tea and reflected rim.
  rectangle(ctx, "#a3987f", x - 4, y + 8, 9, 1);
  rectangle(ctx, "#726a59", x - 3, y + 9, 7, 1);
  polygon(ctx, "#a69c88", [
    [x - 3, y],
    [x + 3, y],
    [x + 2, y + 4],
    [x + 3, y + 7],
    [x - 3, y + 7],
    [x - 2, y + 4],
  ]);
  polygon(ctx, "#6c3033", [
    [x - 2, y + 2],
    [x + 2, y + 2],
    [x + 1, y + 4],
    [x + 2, y + 6],
    [x - 2, y + 6],
    [x - 1, y + 4],
  ]);
  rectangle(ctx, "#c0b29a", x - 2, y, 4, 1);
  rectangle(ctx, "#bab09c", x - 2, y + 2, 1, 2);
}

function chair(ctx: CanvasRenderingContext2D, wide: boolean, slouch: boolean) {
  const width = wide ? 25 : 21;
  const back = slouch ? -77 : -82;
  polygon(ctx, "#3e3730", [
    [-width, back],
    [width, back - 2],
    [width + 1, -34],
    [width + 5, -2],
    [width + 1, -2],
    [width - 4, -34],
    [-width + 4, -34],
    [-width - 1, -2],
    [-width - 5, -2],
    [-width, -34],
  ]);
  rectangle(ctx, "#817055", -width + 1, back + 1, width * 2 - 2, 2);
  rectangle(ctx, "#665841", -width + 2, back + 7, width * 2 - 4, 3);
  rectangle(ctx, "#77664d", -width + 2, back + 16, width * 2 - 4, 2);
  rectangle(ctx, "#5b4d39", -width + 2, -40, width * 2 - 4, 5);
  rectangle(ctx, "#938061", -width + 2, -40, width * 2 - 4, 1);
  rectangle(ctx, "#726149", -width, -30, 2, 20);
  rectangle(ctx, "#726149", width - 1, -31, 1, 21);
}

function legs(ctx: CanvasRenderingContext2D, id: number, cloth: Outfit) {
  const poses: readonly (readonly Point[])[] = [
    [
      [-19, -48],
      [17, -47],
      [26, -31],
      [21, -5],
      [9, -5],
      [9, -28],
      [-3, -34],
      [-14, -27],
      [-12, -5],
      [-25, -5],
      [-28, -32],
    ],
    [
      [-13, -46],
      [13, -47],
      [21, -35],
      [18, -8],
      [7, -7],
      [10, -31],
      [-12, -34],
      [-20, -28],
      [-26, -31],
      [-19, -42],
    ],
    [
      [-16, -46],
      [15, -45],
      [22, -33],
      [18, -7],
      [7, -7],
      [11, -29],
      [-9, -31],
      [-19, -17],
      [-27, -18],
      [-19, -36],
    ],
    [
      [-19, -47],
      [20, -46],
      [28, -32],
      [29, -5],
      [17, -5],
      [11, -29],
      [-10, -29],
      [-19, -5],
      [-32, -7],
      [-29, -32],
    ],
    [
      [-16, -45],
      [15, -46],
      [24, -31],
      [18, -7],
      [7, -7],
      [10, -29],
      [-8, -29],
      [-15, -7],
      [-27, -7],
      [-26, -30],
    ],
    [
      [-16, -46],
      [17, -45],
      [24, -31],
      [29, -6],
      [17, -5],
      [8, -30],
      [-10, -29],
      [-13, -7],
      [-26, -8],
      [-25, -33],
    ],
    [
      [-19, -44],
      [13, -44],
      [20, -31],
      [8, -5],
      [-4, -5],
      [6, -29],
      [-7, -29],
      [-20, -5],
      [-32, -7],
      [-26, -29],
    ],
  ];
  polygon(ctx, INK, poses[id]);
  polygon(
    ctx,
    cloth.pants,
    poses[id].map(([x, y]) => [x, y - 1] as Point),
  );
  // Folded knees, creases, worn cuffs. Each pose has its own lighting planes.
  if (id === 1 || id === 2) {
    polygon(ctx, cloth.pantsLight, [
      [-14, -42],
      [0, -38],
      [12, -35],
      [10, -32],
      [-5, -35],
      [-18, -34],
    ]);
    rectangle(ctx, cloth.pantsLight, 14, -25, 2, 11);
    polygon(ctx, "#333638", [
      [-27, -22],
      [-18, -21],
      [-14, -16],
      [-16, -13],
      [-29, -16],
    ]);
    rectangle(ctx, "#777165", -28, -18, 10, 1);
  } else {
    polygon(ctx, cloth.pantsLight, [
      [-19, -35],
      [-15, -37],
      [-11, -28],
      [-16, -12],
      [-18, -12],
      [-16, -27],
    ]);
    polygon(ctx, cloth.pantsLight, [
      [11, -36],
      [16, -35],
      [21, -28],
      [21, -13],
      [18, -12],
      [17, -28],
    ]);
    rectangle(ctx, "#333638", -26, -5, 17, 4);
    rectangle(ctx, "#363436", 14, -5, 17, 4);
    rectangle(ctx, "#827968", -24, -5, 8, 1);
    rectangle(ctx, "#817666", 18, -5, 6, 1);
  }
  rectangle(ctx, "#1e2022", id === 1 || id === 2 ? 7 : 14, -2, 19, 2);
  if (id === 1 || id === 2) rectangle(ctx, "#343234", 8, -6, 15, 5);
}

function body(ctx: CanvasRenderingContext2D, id: number, cloth: Outfit) {
  const wide = id === 0 || id === 3;
  const left = wide ? -19 : id === 1 ? -12 : -16;
  const right = wide ? 20 : id === 6 ? 13 : 17;
  const top = id === 1 || id === 6 ? -81 : -86;
  polygon(ctx, INK, [
    [-7, top],
    [7, top],
    [right, top + 7],
    [right + 3, -57],
    [right, -42],
    [0, -38],
    [left, -42],
    [left - 3, -62],
    [left, top + 6],
  ]);
  polygon(ctx, cloth.shirt, [
    [-7, top + 1],
    [7, top + 1],
    [right - 1, top + 7],
    [right + 1, -57],
    [right - 1, -43],
    [0, -40],
    [left + 1, -43],
    [left - 1, -61],
    [left + 1, top + 7],
  ]);
  rectangle(ctx, cloth.shirtLight, -2, top + 7, 3, 32);
  if (id === 0 || id === 4) {
    if (id === 4) {
      for (let y = top + 10; y < -43; y += 5)
        rectangle(ctx, "#4d514c", left + 3, y, right - left - 6, 1);
      for (let x = left + 4; x < right - 2; x += 5)
        rectangle(ctx, cloth.shirtLight, x, top + 10, 1, 31);
    } else {
      for (let y = top + 10; y < -43; y += 6) rectangle(ctx, "#b1a18a", -6, y, 11, 1);
    }
    polygon(ctx, cloth.coat, [
      [left + 2, top + 6],
      [-7, top + 2],
      [-2, top + 17],
      [-4, -42],
      [left + 1, -43],
    ]);
    polygon(ctx, cloth.coat, [
      [7, top + 2],
      [right - 2, top + 6],
      [right, -43],
      [4, -42],
      [2, top + 17],
    ]);
    rectangle(ctx, cloth.coatLight, left + 3, top + 13, 2, 24);
    rectangle(ctx, cloth.coatLight, right - 4, top + 12, 1, 23);
  } else if (id === 3) {
    polygon(ctx, cloth.coat, [
      [left + 1, top + 6],
      [right - 1, top + 6],
      [right + 1, -54],
      [right, -43],
      [left + 1, -43],
      [left - 1, -60],
    ]);
    rectangle(ctx, cloth.coatLight, -7, top + 6, 14, 2);
    rectangle(ctx, "#413c40", -5, top + 3, 10, 3);
    rectangle(ctx, cloth.coatLight, left + 3, -46, right - left - 5, 1);
    for (let x = left + 4; x < right - 2; x += 3) rectangle(ctx, "#4c454a", x, -61, 1, 14);
  } else {
    polygon(ctx, cloth.coat, [
      [left + 1, top + 7],
      [-7, top + 2],
      [-3, -45],
      [-7, -40],
      [left + 1, -44],
      [left - 1, -60],
    ]);
    polygon(ctx, cloth.coat, [
      [7, top + 2],
      [right - 1, top + 7],
      [right + 1, -57],
      [right - 1, -44],
      [5, -41],
      [2, -45],
    ]);
    if (id === 5) {
      polygon(ctx, cloth.coatLight, [
        [-7, top + 2],
        [-10, top + 12],
        [-6, top + 16],
        [-3, top + 27],
      ]);
      polygon(ctx, cloth.coatLight, [
        [7, top + 2],
        [10, top + 12],
        [6, top + 16],
        [3, top + 27],
      ]);
      rectangle(ctx, "#918179", right - 8, -67, 6, 1);
    } else {
      rectangle(ctx, cloth.coatLight, -5, top + 9, 1, 27);
      rectangle(ctx, cloth.coatLight, 4, top + 9, 1, 27);
      for (let y = top + 14; y < -45; y += 4) rectangle(ctx, cloth.coatLight, left + 4, y, 3, 1);
    }
  }
  if (id !== 3) {
    for (let y = top + 13; y < -44; y += 6) rectangle(ctx, "#beb09a", 0, y);
    polygon(ctx, cloth.shirtLight, [
      [-6, top],
      [-1, top + 5],
      [-5, top + 8],
      [-8, top + 3],
    ]);
    polygon(ctx, cloth.shirtLight, [
      [5, top],
      [1, top + 5],
      [5, top + 8],
      [8, top + 3],
    ]);
  }
  rectangle(ctx, "#3e4140", left + 3, -54, 7, 1);
  rectangle(ctx, cloth.coatLight, left + 4, -53, 6, 1);
  rectangle(ctx, cloth.coatLight, right - 7, -57, 4, 1);
  rectangle(ctx, "#303334", right - 3, -60, 2, 13);
}

function portrait(ctx: CanvasRenderingContext2D, id: number, action: CrewAction) {
  const facing = id === 0 || id === 4 ? 1 : id === 1 || id === 5 || id === 6 ? -1 : 0;
  const hx = facing * 3 + (id === 6 ? -2 : 0);
  const hy = id === 1 || id === 6 ? -111 : -116;
  const width = id === 0 || id === 3 ? 10 : 8;
  // Neck casts a small shadow into collar; jaw width/height varies with sitter.
  rectangle(ctx, SKIN_SHADE, hx - 3, hy + 25, 7, 8);
  rectangle(ctx, SKIN, hx - 2, hy + 25, 4, 5);
  polygon(ctx, INK, [
    [hx - width + 1, hy + 6],
    [hx - width + 4, hy + 1],
    [hx + 4, hy],
    [hx + width, hy + 5],
    [hx + width + 1, hy + 18],
    [hx + width - 2, hy + 25],
    [hx + 1, hy + 29],
    [hx - width + 2, hy + 24],
    [hx - width - 1, hy + 15],
  ]);
  polygon(ctx, SKIN, [
    [hx - width + 2, hy + 6],
    [hx - width + 4, hy + 2],
    [hx + 3, hy + 1],
    [hx + width - 1, hy + 5],
    [hx + width, hy + 18],
    [hx + width - 3, hy + 24],
    [hx + 1, hy + 27],
    [hx - width + 3, hy + 23],
    [hx - width, hy + 14],
  ]);
  polygon(ctx, SKIN_LIGHT, [
    [hx - width + 4, hy + 4],
    [hx + 1, hy + 3],
    [hx + 3, hy + 10],
    [hx + 1, hy + 15],
    [hx - width + 2, hy + 15],
    [hx - width + 2, hy + 8],
  ]);
  rectangle(ctx, SKIN_SHADE, hx - width, hy + 13, 2, 6);
  rectangle(ctx, SKIN, hx - width - 1, hy + 13, 2, 4);
  if (id === 0) {
    rectangle(ctx, SILVER, hx - 10, hy + 8, 2, 9);
    rectangle(ctx, "#73796d", hx - 9, hy + 17, 2, 3);
    rectangle(ctx, SILVER, hx + 8, hy + 7, 1, 9);
    rectangle(ctx, "#d0c4aa", hx - 4, hy + 3, 7, 1);
  } else if (id === 1 || id === 4) {
    const cap = id === 1 ? "#636953" : "#5d5d54";
    polygon(ctx, cap, [
      [hx - 10, hy + 8],
      [hx - 10, hy + 3],
      [hx - 5, hy - 1],
      [hx + 3, hy - 2],
      [hx + 10, hy + 2],
      [hx + 10, hy + 6],
    ]);
    rectangle(ctx, "#888b6c", hx - 7, hy + 1, 9, 1);
    rectangle(ctx, "#383e36", facing < 0 ? hx - 13 : hx - 9, hy + 7, 23, 2);
    rectangle(ctx, "#787969", hx - 8, hy + 6, 15, 1);
    if (id === 4) {
      rectangle(ctx, "#3e4841", hx - 1, hy - 1, 1, 5);
      rectangle(ctx, "#929580", hx + 5, hy + 2, 1, 2);
    }
  } else if (id === 2 || id === 6) {
    polygon(ctx, "#979c8f", [
      [hx - 9, hy + 10],
      [hx - 9, hy + 4],
      [hx - 5, hy + 1],
      [hx + 4, hy],
      [hx + 8, hy + 5],
      [hx + 7, hy + 7],
      [hx + 2, hy + 3],
      [hx - 4, hy + 4],
      [hx - 6, hy + 11],
    ]);
    rectangle(ctx, SILVER, hx - 9, hy + 5, 2, 8);
    rectangle(ctx, "#c0beaa", hx - 6, hy + 2, 6, 1);
  } else if (id === 5) {
    polygon(ctx, "#484842", [
      [hx - 9, hy + 10],
      [hx - 8, hy + 2],
      [hx - 3, hy],
      [hx + 6, hy + 1],
      [hx + 9, hy + 6],
      [hx + 7, hy + 9],
      [hx + 2, hy + 5],
      [hx - 4, hy + 6],
      [hx - 6, hy + 12],
    ]);
    rectangle(ctx, "#77776a", hx - 6, hy + 2, 4, 1);
  } else {
    rectangle(ctx, "#a4a597", hx - 10, hy + 8, 2, 7);
    rectangle(ctx, "#b0ab91", hx - 3, hy + 2, 5, 1);
  }
  // Eyebrows, lids and pupils: side faces remain three-quarter, not mirrored masks.
  const eye = hy + 13;
  rectangle(ctx, "#514d45", hx - 5, eye - 2, 4, 1);
  rectangle(ctx, "#595349", hx + 2, eye - 2, facing ? 2 : 3, 1);
  if (action === "blink") {
    rectangle(ctx, "#4e4b44", hx - 4, eye, 3, 1);
    rectangle(ctx, "#4e4b44", hx + 2, eye, 2, 1);
  } else {
    rectangle(ctx, "#b4a891", hx - 5, eye, 4, 1);
    rectangle(ctx, INK, hx - 3 + facing, eye, 1, 2);
    rectangle(ctx, "#b7a994", hx + 2, eye, 3, 1);
    rectangle(ctx, INK, hx + 3 + facing, eye, 1, 2);
  }
  if (id === 2) {
    rectangle(ctx, "#aaa795", hx - 7, eye - 1, 6, 1);
    rectangle(ctx, "#aaa795", hx - 7, eye, 1, 3);
    rectangle(ctx, "#aaa795", hx - 7, eye + 3, 6, 1);
    rectangle(ctx, "#aaa795", hx - 2, eye, 1, 3);
    rectangle(ctx, "#aaa795", hx + 1, eye - 1, 6, 1);
    rectangle(ctx, "#aaa795", hx + 1, eye, 1, 3);
    rectangle(ctx, "#aaa795", hx + 1, eye + 3, 6, 1);
    rectangle(ctx, "#aaa795", hx + 6, eye, 1, 3);
    rectangle(ctx, "#aaa795", hx - 1, eye, 2, 1);
  }
  const nose = hx + facing * (id === 1 ? 8 : 5);
  polygon(ctx, SKIN_LIGHT, [
    [nose - 1, hy + 14],
    [nose + 1, hy + 13],
    [nose + 2, hy + 19],
    [nose, hy + 20],
    [nose - 2, hy + 18],
  ]);
  rectangle(ctx, SKIN_SHADE, nose - 1, hy + 20, 3, 1);
  rectangle(ctx, SKIN_SHADE, hx - 6, hy + 8, 5, 1);
  rectangle(ctx, "#8d7c65", hx - 4, hy + 6, 5, 1);
  rectangle(ctx, SKIN_SHADE, hx - 6, hy + 17, 2, 1);
  rectangle(ctx, "#8c7965", hx + 4, hy + 18, 2, 1);
  // Walrus, close-cropped beard, bushy dark moustache and white newspaper beard.
  if (id === 0) {
    polygon(ctx, "#b7b7a7", [
      [hx - 7, hy + 21],
      [hx - 2, hy + 19],
      [hx + 2, hy + 20],
      [hx + 6, hy + 20],
      [hx + 8, hy + 24],
      [hx + 4, hy + 25],
      [hx + 1, hy + 23],
      [hx - 2, hy + 25],
      [hx - 7, hy + 25],
    ]);
    rectangle(ctx, "#d0cbb4", hx - 4, hy + 21, 3, 1);
    rectangle(ctx, "#d0cbb4", hx + 3, hy + 22, 2, 1);
  } else if (id === 3 || id === 6) {
    const beard = id === 6 ? "#aeb0a2" : "#6a6961";
    polygon(ctx, beard, [
      [hx - 8, hy + 18],
      [hx - 6, hy + 22],
      [hx - 2, hy + 20],
      [hx + 3, hy + 21],
      [hx + 7, hy + 19],
      [hx + 6, hy + 26],
      [hx + 2, hy + 30],
      [hx - 4, hy + 28],
      [hx - 8, hy + 23],
    ]);
    rectangle(ctx, "#bebbaa", hx - 5, hy + 24, 1, 3);
    rectangle(ctx, "#92948b", hx + 2, hy + 25, 2, 2);
  } else {
    const moustache = id === 5 ? "#3b3d37" : id === 2 ? "#a7a999" : "#707168";
    polygon(ctx, moustache, [
      [hx - 5, hy + 21],
      [hx - 1, hy + 20],
      [hx + 2, hy + 21],
      [hx + 6, hy + 20],
      [hx + 7, hy + 23],
      [hx + 2, hy + 24],
      [hx, hy + 22],
      [hx - 5, hy + 23],
    ]);
    rectangle(ctx, "#b1ac97", hx - 5, hy + 23, 1, 1);
  }
  rectangle(ctx, "#5b5147", hx - 1, hy + 25, 3, action === "talk" ? 2 : 1);
  rectangle(ctx, SKIN_LIGHT, hx - 4, hy + 26, 2, 1);
}

function arms(ctx: CanvasRenderingContext2D, id: number, action: CrewAction, cloth: Outfit) {
  const coatSleeve = id === 0 || id === 4 ? cloth.shirt : cloth.coat;
  const side = id === 0 || id === 4 ? 1 : -1;
  // Far arm hangs naturally to the knee; cuff and fingers remain independently readable.
  polygon(ctx, INK, [
    [-15, -78],
    [-21, -73],
    [-24, -56],
    [-19, -48],
    [-8, -47],
    [-7, -53],
    [-16, -58],
    [-13, -72],
  ]);
  polygon(ctx, coatSleeve, [
    [-15, -77],
    [-20, -72],
    [-22, -56],
    [-18, -50],
    [-8, -49],
    [-8, -52],
    [-17, -58],
    [-14, -71],
  ]);
  rectangle(ctx, cloth.coatLight, -20, -65, 1, 8);
  polygon(ctx, SKIN, [
    [-10, -52],
    [-4, -52],
    [-1, -48],
    [-3, -46],
    [-9, -48],
  ]);
  rectangle(ctx, SKIN_LIGHT, -8, -51, 4, 1);
  rectangle(ctx, SKIN_SHADE, -6, -48, 3, 1);
  if (id === 2 || id === 3) {
    const sipping = action === "sip";
    const lifting = action === "sip-lift";
    const hx = sipping ? 9 : lifting ? 19 : 11;
    // Hand grips the lower glass; the rim lands at the mouth (~y=-92).
    const hy = sipping ? -85 : lifting ? -75 : -54;
    const elbow: Point = sipping ? [22, -76] : lifting ? [24, -61] : [22, -55];
    polygon(ctx, INK, [
      [13, -79],
      [19, -77],
      [elbow[0] + 3, elbow[1]],
      [elbow[0], elbow[1] + 4],
      [hx - 2, hy + 4],
      [hx - 3, hy - 1],
      [elbow[0] - 4, elbow[1] - 3],
      [12, -71],
    ]);
    polygon(ctx, coatSleeve, [
      [14, -78],
      [18, -77],
      [elbow[0] + 1, elbow[1]],
      [elbow[0] - 1, elbow[1] + 2],
      [hx - 1, hy + 2],
      [hx - 1, hy],
      [elbow[0] - 3, elbow[1] - 3],
      [13, -71],
    ]);
    rectangle(ctx, cloth.coatLight, 17, -76, 1, 5);
    rectangle(ctx, cloth.shirtLight, hx - 2, hy, 3, 3);
    polygon(ctx, SKIN, [
      [hx - 1, hy],
      [hx + 4, hy],
      [hx + 5, hy + 4],
      [hx + 2, hy + 6],
      [hx - 1, hy + 4],
    ]);
    glass(ctx, hx - 3, hy - 7);
    rectangle(ctx, SKIN_LIGHT, hx + 1, hy + 1, 3, 1);
  } else if (id === 0 || id === 1 || id === 4 || id === 5) {
    const reaching = action === "play-reach" || action === "play";
    const hx = reaching ? side * (action === "play" ? 39 : 32) : side * 12;
    // Board height follows each seat's perspective baseline in the shared scene.
    const boardHandY = id === 0 ? -68 : id === 1 ? -48 : id === 4 ? -31 : -53;
    const hy = reaching ? boardHandY : -51;
    const mirror = (points: readonly Point[]) => points.map(([x, y]) => [x * side, y] as Point);
    polygon(
      ctx,
      INK,
      mirror([
        [14, -78],
        [21, -73],
        [24, -60],
        [Math.abs(hx), hy - 3],
        [Math.abs(hx) + 2, hy + 3],
        [21, -52],
        [16, -56],
        [12, -71],
      ]),
    );
    polygon(
      ctx,
      coatSleeve,
      mirror([
        [15, -77],
        [20, -72],
        [22, -59],
        [Math.abs(hx), hy - 2],
        [Math.abs(hx) + 1, hy + 1],
        [21, -54],
        [17, -57],
        [13, -71],
      ]),
    );
    rectangle(ctx, cloth.coatLight, side > 0 ? 18 : -20, -68, 2, 7);
    polygon(ctx, SKIN, [
      [hx - 3, hy - 2],
      [hx + 3, hy - 2],
      [hx + 5, hy + 1],
      [hx + 2, hy + 3],
      [hx - 3, hy + 1],
    ]);
    rectangle(ctx, SKIN_LIGHT, hx - 1, hy - 2, 3, 1);
    if (action === "play")
      rectangle(ctx, id === 0 || id === 4 ? "#c6bba2" : "#4b4237", hx + side * 4, hy + 2, 3, 2);
  } else {
    // Newspaper is supported by two hands and softened at its folded crease.
    polygon(ctx, coatSleeve, [
      [13, -77],
      [20, -72],
      [24, -57],
      [16, -50],
      [8, -52],
      [8, -58],
      [17, -61],
      [12, -70],
    ]);
    polygon(ctx, "#9b9a85", [
      [-21, -62],
      [0, -60],
      [20, -64],
      [20, -45],
      [0, -41],
      [-20, -45],
    ]);
    rectangle(ctx, "#c2bca4", -18, -60, 14, 1);
    rectangle(ctx, "#4d5148", -17, -57, 12, 2);
    rectangle(ctx, "#6c7062", -17, -53, 5, 5);
    for (let yy = -56; yy < -46; yy += 3) {
      rectangle(ctx, "#696e60", 4, yy, 12, 1);
      rectangle(ctx, "#696e60", -10, yy + 1, 6, 1);
    }
    rectangle(ctx, "#676b5e", 0, -59, 1, 16);
    rectangle(ctx, SKIN, -23, -53, 5, 4);
    rectangle(ctx, SKIN_LIGHT, -23, -53, 4, 1);
    rectangle(ctx, SKIN, 17, -54, 5, 4);
    rectangle(ctx, SKIN_LIGHT, 18, -54, 3, 1);
  }
}

export function drawCrewCharacter(
  ctx: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  action: CrewAction,
): void {
  const person = ((Math.trunc(id) % 7) + 7) % 7;
  const cloth = OUTFITS[person];
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  rectangle(ctx, "#171a1a", -28, -1, 57, 3);
  rectangle(ctx, "#1b1e1d", -23, 2, 47, 1);
  chair(ctx, person === 0 || person === 3, person === 1 || person === 6);
  legs(ctx, person, cloth);
  body(ctx, person, cloth);
  portrait(ctx, person, action);
  arms(ctx, person, action, cloth);
  // A discreet string of prayer beads in the cardigan wearer's resting hand.
  if (person === 2) {
    rectangle(ctx, "#454b3e", -3, -46, 1, 12);
    for (let yy = -43; yy < -33; yy += 3) rectangle(ctx, "#93977d", -4, yy, 2, 2);
    rectangle(ctx, "#77765b", -4, -32, 3, 2);
  }
  ctx.restore();
}
