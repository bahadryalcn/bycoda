import { themePalette } from "../../../shared/theme/palette";
/** Transparent monochrome binary art. Shapes are sampled into actual text glyphs. */
// Public canvas dimensions are layout units. Sampling resolution stays private.
export const CODE_WIDTH = 760;
/** The crew's floor frame is 320 units tall; the bycoda sign hangs in the CREW_TOP units above it. */
export const CREW_TOP = 70;
export const CODE_HEIGHT = 320 + CREW_TOP;
const SAMPLE_SCALE = 3;
export type TeaPose = "idle" | "sip-low" | "sip-lift" | "sip-high" | "sip";
/** Standing lifts the figure this many units; a stomp adds at most STAND_JUMP. Seats 2 and 3 (y=275) keep a few units spare. */
export const STAND_RISE = 48,
  STAND_JUMP = 7;
export const CODE_SEATS = [
  [65, 312],
  [185, 292],
  [305, 275],
  [455, 275],
  [575, 292],
  [695, 312],
] as const;
import type { CrewActivity } from "./crewMotion";
import { crewLayout } from "./crewLayout";
import { drawYoung, growthSparkle, type CrewAge } from "./crewYoung";
export type { CrewActivity } from "./crewMotion";

const mix0 = (t: number, a: number, b: number) => a + (b - a) * t;
function sitter(
  c: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  pose: TeaPose,
  activity?: CrewActivity,
  time = 0,
) {
  const guest = Math.floor(id / 6);
  id %= 6;
  c.save();
  c.translate(x, y);
  // Standing is a big, unmistakable change: the whole figure rises by STAND_RISE with straight legs.
  const progress = Math.max(0, Math.min(1, activity?.stand ?? 0));
  const standing = progress * progress * (3 - 2 * progress);
  const role =
    activity?.role ?? (guest ? "subagent" : id === 2 ? "lead" : id === 3 ? "advisor" : "subagent");
  // Seated men slouch toward their neighbours; standing ones straighten up.
  const lean =
    ([0, -8, 0, 3, 8, -6][id] + (guest ? ((guest % 3) - 1) * 3 : 0)) * (1 - 0.65 * standing);
  const wide = [31, 23, 21, 30, 25, 22][id];
  const fill = (v: number) => {
    c.fillStyle = `rgb(${v},${v},${v})`;
  };
  const ellipse = (px: number, py: number, rx: number, ry: number, v: number) => {
    fill(v);
    c.beginPath();
    c.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
  };
  const line = (points: number[][], v: number, width: number) => {
    c.strokeStyle = `rgb(${v},${v},${v})`;
    c.lineWidth = width;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    points.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
    c.stroke();
  };
  const shape = (points: number[][], v: number) => {
    fill(v);
    c.beginPath();
    points.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
    c.closePath();
    c.fill();
  };
  const shoe = (sx: number, sy: number, direction: number) => {
    c.save();
    c.translate(sx, sy);
    c.scale(direction, 1);
    // Heel, raised instep and a toe box rather than a flat oval.
    shape(
      [
        [-11, -7],
        [-9, -11],
        [1, -12],
        [7, -7],
        [16, -5],
        [19, -1],
        [17, 2],
        [-12, 2],
      ],
      70,
    );
    shape(
      [
        [-9, -7],
        [-7, -10],
        [1, -10],
        [6, -5],
        [14, -3],
        [16, -1],
        [-10, -1],
      ],
      150,
    );
    line(
      [
        [-10, 1],
        [16, 1],
      ],
      215,
      1.5,
    );
    line(
      [
        [8, -4],
        [14, -3],
      ],
      220,
      1.5,
    );
    line(
      [
        [-7, -9],
        [-7, -2],
      ],
      105,
      1,
    );
    if (id === 2 || id === 3) {
      for (let lace = 0; lace < 3; lace++)
        line(
          [
            [-2 + lace * 2, -8 + lace],
            [3 + lace * 2, -7 + lace],
          ],
          235,
          1,
        );
    } else
      line(
        [
          [-3, -7],
          [5, -5],
        ],
        230,
        1.5,
      );
    line(
      [
        [-5, -13],
        [3, -13],
      ],
      235,
      2,
    );
    line(
      [
        [-5, -11],
        [3, -11],
      ],
      85,
      2,
    );
    c.restore();
  };
  // Chair, relaxed legs and shoes. Two sitters have crossed legs.
  if (!guest) {
    line(
      [
        [-34, -131],
        [-36, -7],
      ],
      105,
      4,
    );
    line(
      [
        [34, -131],
        [36, -7],
      ],
      105,
      4,
    );
    line(
      [
        [-34, -130],
        [34, -130],
      ],
      120,
      4,
    );
    // Standing: only the seat edges beside the hips remain, so nothing crosses his legs and the chair reads as empty.
    if (standing > 0.02) {
      line(
        [
          [-36, -65],
          [-25, -65],
        ],
        120,
        4,
      );
      line(
        [
          [25, -65],
          [36, -65],
        ],
        120,
        4,
      );
    } else
      line(
        [
          [-34, -65],
          [34, -65],
        ],
        120,
        4,
      );
  }
  const rise = standing * STAND_RISE - Math.sin(progress * Math.PI) * 4;
  const talking = standing > 0.65 ? (activity?.talk ?? 0) : 0;
  const gesture = activity?.gesture ?? 0;
  const laugh = activity?.laugh ?? 0;
  const thought = activity?.thought ?? 0,
    emphasis = activity?.emphasis ?? 0;
  const kick = activity?.kick ?? 0;
  const jump = (activity?.jump ?? 0) * STAND_JUMP;
  const mix = (a: number, b: number) => a + (b - a) * standing;
  const walking =
    (activity?.arrival ?? 1) < 1
      ? Math.abs(Math.sin((activity?.arrival ?? 1) * Math.PI * 8)) * 3
      : 0;
  c.translate(0, -rise - jump - walking + standing * 6); // steps a little forward of the chair
  // Cane (advisor): leans on the chair while seated, planted in the hand while standing.
  const caneX = lean + (1 - standing) * -(wide + 14) + standing * (wide + 3);
  if (role === "advisor") {
    line(
      [
        [caneX, mix0(standing, -102, -90)],
        [caneX, rise - 2],
      ],
      228,
      3.6,
    );
    line(
      [
        [caneX, mix0(standing, -102, -90)],
        [caneX + 7, mix0(standing, -108, -96)],
        [caneX + 12, mix0(standing, -102, -90)],
      ],
      228,
      3.6,
    );
  }
  if (progress > 0) {
    const seatedLeft =
      id === 1
        ? [23, -46, -5, -10]
        : id === 4
          ? [-12, -40, 8, -12]
          : id === 5
            ? [-24, -37, -11, -14]
            : [-21, -39, -25, -10];
    const seatedRight =
      id === 1
        ? [-23, -49, 19, -42]
        : id === 4
          ? [20, -42, -3, -11]
          : id === 5
            ? [18, -36, 26, -9]
            : [23, -38, 29, -9];
    // Standing knees sit midway between hip and ankle: dead-straight thigh and shin.
    const kneeY = (-79 + STAND_RISE) / 2;
    const kneeLeft = [mix(seatedLeft[0], -19.5), mix(seatedLeft[1], kneeY)];
    const ankleLeft = [mix(seatedLeft[2], -22), mix(seatedLeft[3], -10) + rise];
    const kneeRight = [mix(seatedRight[0], 21) + kick * 17, mix(seatedRight[1], kneeY) - kick * 39];
    const ankleRight = [
      mix(seatedRight[2], 25) + kick * 21,
      mix(seatedRight[3], -9) + rise - kick * 51,
    ];
    const arrival = activity?.arrival ?? 1;
    if (guest && arrival > 0 && arrival < 1) {
      const stride = Math.sin(arrival * Math.PI * 8);
      ankleLeft[0] += stride * 10;
      ankleRight[0] -= stride * 10;
      ankleLeft[1] -= Math.max(0, stride) * 8;
      ankleRight[1] -= Math.max(0, -stride) * 8;
      kneeLeft[0] += stride * 5;
      kneeRight[0] -= stride * 5;
    }
    line([[-17, -69], kneeLeft, ankleLeft], 150, 15);
    line([[17, -69], kneeRight, ankleRight], 180, 15);
    line([[-18, -56], kneeLeft, [ankleLeft[0], ankleLeft[1] - 3]], 210, 1.4);
    line([[19, -53], kneeRight, [ankleRight[0], ankleRight[1] - 3]], 105, 1.4);
    shoe(ankleLeft[0] - 2, ankleLeft[1] + 8, -1);
    shoe(ankleRight[0] + 3, ankleRight[1] + 7, 1);
  } else if (id === 1) {
    line(
      [
        [-17, -69],
        [23, -46],
        [-5, -10],
      ],
      150,
      15,
    );
    line(
      [
        [19, -70],
        [-23, -49],
        [19, -42],
      ],
      185,
      15,
    );
    shoe(-7, -2, -1);
    shoe(25, -40, 1);
  } else if (id === 4) {
    // Ankles crossed, leaning back: distinct from the flat-cap man's raised knee.
    line(
      [
        [-17, -69],
        [-12, -40],
        [8, -12],
      ],
      155,
      15,
    );
    line(
      [
        [17, -69],
        [20, -42],
        [-3, -11],
      ],
      185,
      15,
    );
    shoe(9, -2, 1);
    shoe(-5, -6, -1);
  } else if (id === 5) {
    // One foot tucked below the chair, the other resting farther forward.
    line(
      [
        [-17, -69],
        [-24, -37],
        [-11, -14],
      ],
      140,
      14,
    );
    line(
      [
        [17, -69],
        [18, -36],
        [26, -9],
      ],
      180,
      15,
    );
    shoe(-9, -7, -1);
    shoe(28, -2, 1);
  } else {
    line(
      [
        [-17, -70],
        [-21, -39],
        [-25, -10],
      ],
      150,
      16,
    );
    line(
      [
        [17, -70],
        [23, -38],
        [29, -9],
      ],
      180,
      16,
    );
    shoe(-28, -2, -1);
    shoe(32, -2, 1);
  }
  // Sloping shoulders, cloth hanging from the ribcage and a seated waist.
  const turn = activity?.turn ?? 0;
  const cupless = standing > 0.02 || activity?.working === true;
  // Any seated, idle uncle may smoke; working or standing ones never hold a cigarette or glass.
  const smoker = !cupless && activity?.smoking === true;
  const smokeLift = activity?.smokeLift ?? 0;
  const exhale = activity?.exhale ?? 0;
  const cigaretteX = lean - 34 + 29 * smokeLift;
  const cigaretteY = -109 - 43 * smokeLift;
  const breath = activity?.breath ?? 0,
    sway = activity?.sway ?? 0;
  c.save();
  c.translate(turn * 2 + sway, (activity?.chuckle ?? 0) - breath * 0.9 + (1 - standing) * 4);
  shape(
    [
      [lean - 10, -150],
      [lean - 24, -144],
      [lean - 33, -136],
      [lean - 30, -115],
      [lean - 25, -87],
      [-28, -73],
      [-17, -65],
      [18, -65],
      [30, -74],
      [lean + 26, -94],
      [lean + 30, -120],
      [lean + 32, -136],
      [lean + 23, -145],
      [lean + 10, -150],
    ],
    155,
  );
  shape(
    [
      [lean - 24, -140],
      [lean - 30, -133],
      [lean - 24, -89],
      [-22, -73],
      [-8, -71],
      [lean - 9, -118],
      [lean - 12, -141],
    ],
    110,
  );
  shape(
    [
      [lean + 14, -143],
      [lean + 25, -137],
      [lean + 25, -101],
      [20, -76],
      [8, -73],
      [lean + 7, -122],
    ],
    185,
  );
  ellipse(lean, -73, wide, 10, 145);
  line(
    [
      [lean - 21, -108],
      [lean - 15, -101],
      [lean - 22, -96],
    ],
    90,
    2,
  );
  line(
    [
      [lean + 11, -90],
      [lean + 24, -86],
    ],
    105,
    2,
  );
  line(
    [
      [-19, -72],
      [-6, -77],
      [12, -74],
      [23, -70],
    ],
    220,
    2,
  );
  if (id !== 3 && id !== 5) {
    line(
      [
        [lean, -145],
        [lean, -78],
      ],
      230,
      3,
    );
    line(
      [
        [lean - 14, -143],
        [lean - 5, -125],
        [lean, -139],
        [lean + 7, -125],
        [lean + 15, -143],
      ],
      215,
      3,
    );
  } else {
    // Round-neck pullovers have no shirt placket or repeated V collar.
    line(
      [
        [lean - 11, -145],
        [lean - 7, -138],
        [lean, -136],
        [lean + 7, -138],
        [lean + 11, -145],
      ],
      95,
      4,
    );
    line(
      [
        [lean - 9, -144],
        [lean - 6, -140],
        [lean, -139],
        [lean + 6, -140],
        [lean + 9, -144],
      ],
      230,
      1.5,
    );
  }
  // Vests, cardigan seams and individual shirt details.
  if (id === 0 || id === 2) {
    line(
      [
        [lean - 14, -134],
        [lean - 18, -86],
        [lean - 4, -83],
      ],
      220,
      3,
    );
    line(
      [
        [lean + 14, -134],
        [lean + 18, -86],
        [lean + 4, -83],
      ],
      220,
      3,
    );
  }
  if (id === 3) {
    // Broad cable-knit channels survive the binary sampling at normal viewport sizes.
    for (const rib of [-13, 0, 13]) {
      line(
        [
          [lean + rib, -129],
          [lean + rib, -85],
        ],
        115,
        4,
      );
      for (let row = 0; row < 4; row++) {
        const ry = -126 + row * 10;
        line(
          [
            [lean + rib - 2, ry],
            [lean + rib + 2, ry + 4],
            [lean + rib - 2, ry + 8],
          ],
          195,
          1.5,
        );
      }
    }
  }
  if (id === 1) {
    shape(
      [
        [lean - 12, -141],
        [lean - 4, -124],
        [lean - 13, -119],
        [lean - 6, -108],
        [lean - 20, -90],
      ],
      220,
    );
    line(
      [
        [lean + 10, -105],
        [lean + 22, -105],
        [lean + 20, -98],
        [lean + 11, -98],
      ],
      230,
      1.5,
    );
  } else if (id === 2) {
    line(
      [
        [lean - 16, -137],
        [lean - 12, -118],
        [lean - 7, -84],
      ],
      245,
      2,
    );
    line(
      [
        [lean + 13, -135],
        [lean + 10, -117],
        [lean + 6, -85],
      ],
      240,
      2,
    );
    line(
      [
        [lean - 19, -94],
        [lean - 11, -94],
        [lean - 11, -86],
        [lean - 20, -86],
      ],
      200,
      1,
    );
  } else if (id === 4) {
    // Rolled-sleeve checked shirt: one clearly different clothing silhouette.
    for (let row = 0; row < 5; row++)
      line(
        [
          [lean - 17, -124 + row * 8],
          [lean + 18, -124 + row * 8],
        ],
        100,
        1.4,
      );
    for (let col = 0; col < 5; col++)
      line(
        [
          [lean - 16 + col * 8, -127],
          [lean - 16 + col * 8, -89],
        ],
        210,
        1.2,
      );
    line(
      [
        [lean - 26, -114],
        [lean - 32, -111],
      ],
      245,
      4,
    );
    line(
      [
        [lean + 28, -115],
        [lean + 32, -112],
      ],
      245,
      4,
    );
  } else if (id === 5) {
    // A wool scarf hangs down one side of the pullover.
    shape(
      [
        [lean - 13, -146],
        [lean - 7, -138],
        [lean + 9, -144],
        [lean + 12, -138],
        [lean - 6, -131],
        [lean - 8, -103],
        [lean - 17, -104],
        [lean - 14, -132],
      ],
      220,
    );
    for (let fringe = 0; fringe < 4; fringe++)
      line(
        [
          [lean - 16 + fringe * 2, -104],
          [lean - 16 + fringe * 2, -99],
        ],
        180,
        1,
      );
  } else if (id === 0) {
    line(
      [
        [lean + 10, -119],
        [lean + 22, -119],
      ],
      240,
      2,
    );
  }
  // Each garment has large readable construction details instead of fine noise.
  if (id === 0) {
    for (const side of [-1, 1])
      for (let row = 0; row < 3; row++) {
        const cx = lean + side * 12,
          cy = -116 + row * 13;
        shape(
          [
            [cx, cy - 5],
            [cx + 5, cy],
            [cx, cy + 5],
            [cx - 5, cy],
          ],
          110,
        );
        line(
          [
            [cx - 4, cy],
            [cx, cy - 4],
            [cx + 4, cy],
          ],
          190,
          1.2,
        );
      }
  } else if (id === 1) {
    line(
      [
        [lean - 12, -139],
        [lean - 4, -124],
        [lean - 13, -119],
        [lean - 6, -108],
      ],
      115,
      1.6,
    );
    line(
      [
        [lean + 12, -139],
        [lean + 5, -122],
        [lean + 12, -116],
      ],
      235,
      3,
    );
    shape(
      [
        [lean + 10, -107],
        [lean + 23, -107],
        [lean + 22, -96],
        [lean + 11, -96],
      ],
      80,
    );
    line(
      [
        [lean + 10, -107],
        [lean + 23, -107],
      ],
      245,
      2.5,
    );
  } else if (id === 2) {
    for (const side of [-1, 1])
      for (let rib = 0; rib < 3; rib++) {
        const rx = lean + side * (10 + rib * 4);
        line(
          [
            [rx, -120],
            [rx, -101],
          ],
          85,
          1.8,
        );
      }
    for (const side of [-1, 1]) {
      const px = lean + side * 15;
      shape(
        [
          [px - 5, -99],
          [px + 5, -99],
          [px + 5, -87],
          [px - 5, -87],
        ],
        110,
      );
      line(
        [
          [px - 5, -99],
          [px + 5, -99],
        ],
        240,
        2.5,
      );
    }
  } else if (id === 4) {
    for (let row = 0; row < 4; row++)
      line(
        [
          [lean - 19, -124 + row * 11],
          [lean + 20, -124 + row * 11],
        ],
        120,
        1.5,
      );
    for (const col of [-12, 0, 12])
      line(
        [
          [lean + col, -129],
          [lean + col, -86],
        ],
        195,
        1.5,
      );
  } else if (id === 5) {
    for (let row = 0; row < 3; row++) {
      const sy = -124 + row * 14;
      line(
        [
          [lean - 3, sy],
          [lean + 3, sy + 4],
          [lean + 9, sy],
          [lean + 15, sy + 4],
          [lean + 21, sy],
        ],
        115,
        2,
      );
      line(
        [
          [lean - 3, sy - 3],
          [lean + 3, sy + 1],
          [lean + 9, sy - 3],
          [lean + 15, sy + 1],
          [lean + 21, sy - 3],
        ],
        195,
        1.3,
      );
    }
    line(
      [
        [lean - 12, -136],
        [lean - 14, -108],
      ],
      65,
      2.5,
    );
  }
  if (id === 0 || id === 2 || id === 3 || id === 5) {
    line(
      [
        [lean - 20, -79],
        [lean + 20, -79],
      ],
      60,
      3,
    );
    for (let rib = 0; rib < 11; rib++)
      line(
        [
          [lean - 20 + rib * 4, -77],
          [lean - 20 + rib * 4, -70],
        ],
        230,
        1.5,
      );
  }
  if (id !== 3 && id !== 5)
    for (let b = 0; b < 4; b++) ellipse(lean + 4, -119 + b * 10, 1.5, 1.5, 245);
  if (guest) {
    // Guests mix a different shirt pattern and pocket with their face and hair.
    for (let stripe = 0; stripe < 3 + (guest % 3); stripe++) {
      const sy = -124 + stripe * 8;
      if ((guest + id) % 2)
        line(
          [
            [lean - 18, sy],
            [lean + 18, sy],
          ],
          210,
          1.5,
        );
      else
        line(
          [
            [lean - 14 + stripe * 7, -127],
            [lean - 14 + stripe * 7, -92],
          ],
          90,
          2,
        );
    }
    line(
      [
        [lean + 9, -120],
        [lean + 20, -120],
        [lean + 19, -109],
        [lean + 10, -109],
        [lean + 9, -120],
      ],
      245,
      1.5,
    );
  }
  if (role === "subagent") {
    // Work apron: a bright bib with neck strap and waist ties marks a delegated helper.
    shape(
      [
        [lean - 13, -116],
        [lean + 13, -116],
        [lean + 17, -72],
        [lean - 17, -72],
      ],
      198,
    );
    line(
      [
        [lean - 13, -116],
        [lean - 10, -142],
      ],
      225,
      3,
    );
    line(
      [
        [lean + 13, -116],
        [lean + 10, -142],
      ],
      225,
      3,
    );
    line(
      [
        [lean - 5, -100],
        [lean + 5, -100],
        [lean + 5, -90],
        [lean - 5, -90],
        [lean - 5, -100],
      ],
      110,
      1.5,
    );
  } else if (role === "lead") {
    // A bold sash across the chest, edged dark so the diagonal survives glyph sampling.
    line(
      [
        [lean - 24, -142],
        [lean + 22, -80],
      ],
      70,
      11,
    );
    line(
      [
        [lean - 24, -142],
        [lean + 22, -80],
      ],
      240,
      7,
    );
    ellipse(lean + 3, -111, 5, 5, 255);
  }
  if (smoker) {
    // A relaxed outside elbow; only the forearm approaches the lips.
    line(
      [
        [lean - 26, -136],
        [lean - 39, -116],
        [cigaretteX - 5, cigaretteY + 6],
      ],
      65,
      14,
    );
    line(
      [
        [lean - 26, -136],
        [lean - 39, -116],
        [cigaretteX - 5, cigaretteY + 6],
      ],
      180,
      10,
    );
  } else if (progress > 0) {
    // The free hand argues beside the face, with a fixed elbow outside the torso.
    const handTargets = [
      [-40 - gesture * 5, -139 - gesture * 19],
      [-39, -140 - gesture * 23],
      [-44 - gesture * 8, -130 - gesture * 9],
      [-46 - gesture * 5, -139 - gesture * 9],
      [-24 - gesture * 6, -149 - gesture * 7],
      [-34 - gesture * 7, -138 - gesture * 8],
    ];
    const [normalX, normalY] = handTargets[id];
    const handX = normalX * (1 - thought) - 8 * thought;
    const handY = normalY * (1 - thought) - 137 * thought;
    const armRest = (activity?.armRest ?? 0.65) * (1 - thought);
    const wristX = mix(lean - 11, lean + handX * (1 - armRest) - 34 * armRest + turn * 2);
    const wristY = mix(-88, handY * (1 - armRest) - 110 * armRest - kick * 7);
    const elbow = [mix(lean - wide - 7, lean - 41), mix(-105, -116)];
    line([[lean - 26, -136], elbow, [wristX, wristY]], 65, 14);
    line([[lean - 26, -136], elbow, [wristX, wristY]], 180, 10);
    line(
      [
        [elbow[0] - 2, elbow[1] - 3],
        [elbow[0] + 3, elbow[1]],
      ],
      240,
      2,
    );
    shape(
      [
        [wristX - 4, wristY + 3],
        [wristX - 7, wristY - 5],
        [wristX - 5, wristY - 12],
        [wristX + 2, wristY - 13],
        [wristX + 6, wristY - 6],
        [wristX + 4, wristY + 3],
      ],
      230,
    );
    if (armRest > 0.5 || thought > 0.3) {
      for (let finger = 0; finger < 4; finger++)
        line(
          [
            [wristX - 5 + finger * 2.6, wristY - 9],
            [wristX - 4 + finger * 2.6, wristY - 4],
          ],
          120,
          1,
        );
    } else if (id === 0 || id === 2 || id === 3) {
      // Open, spread palm: five separate fingertips, away from the body.
      for (let finger = 0; finger < 4; finger++)
        line(
          [
            [wristX - 5 + finger * 3, wristY - 8],
            [wristX - 8 + finger * 4, wristY - 17 - Math.sin(finger) * 3],
          ],
          235,
          2.6,
        );
      line(
        [
          [wristX + 4, wristY - 5],
          [wristX + 10, wristY - 10],
        ],
        235,
        3,
      );
    } else if (id === 1) {
      // Raised index finger, with the remaining fingers curled into the palm.
      line(
        [
          [wristX - 2, wristY - 9],
          [wristX - 3, wristY - 25],
        ],
        245,
        3.5,
      );
      for (let finger = 0; finger < 3; finger++)
        line(
          [
            [wristX + finger * 2, wristY - 8],
            [wristX + finger * 2 + 1, wristY - 3],
          ],
          110,
          1,
        );
    } else {
      // Thoughtful chin gesture or a small, relaxed fist instead of another pointed finger.
      for (let finger = 0; finger < 4; finger++)
        line(
          [
            [wristX - 5 + finger * 2.6, wristY - 9],
            [wristX - 4 + finger * 2.6, wristY - 4],
          ],
          120,
          1,
        );
    }
    line(
      [
        [wristX - 3, wristY - 3],
        [wristX + 2, wristY - 6],
      ],
      130,
      1,
    );
  } else {
    c.save();
    line(
      [
        [lean - wide + 1, -133],
        [lean - wide - 7, -105],
        [lean - 13, -90],
      ],
      170,
      11,
    );
    shape(
      [
        [lean - 16, -93],
        [lean - 10, -94],
        [lean - 5, -91],
        [lean - 3, -87],
        [lean - 8, -85],
        [lean - 15, -87],
      ],
      220,
    );
    line(
      [
        [lean - 13, -92],
        [lean - 8, -89],
      ],
      245,
      1.5,
    );
    line(
      [
        [lean - 17, -96],
        [lean - 12, -95],
      ],
      80,
      2,
    );
    if (id === 0) {
      for (let bead = 0; bead < 10; bead++)
        ellipse(lean - 15 + Math.sin(bead * 0.35) * 5, -86 + bead * 2.5, 1.1, 1.2, 230);
    }
    ellipse(lean - 11, -88, 12, 3, 235);
    line(
      [
        [lean - 21, -89],
        [lean - 1, -89],
      ],
      255,
      1,
    );
    for (let finger = 0; finger < 3; finger++)
      line(
        [
          [lean - 12 + finger * 2.5, -88],
          [lean - 11 + finger * 2.5, -85],
        ],
        110,
        1,
      );
    c.restore();
  }
  const lift =
    pose === "sip"
      ? 1
      : pose === "sip-high"
        ? 0.8
        : pose === "sip-lift"
          ? 0.5
          : pose === "sip-low"
            ? 0.2
            : 0;
  // Low saucer, close-to-chest pinch, rim grip, extended palm, loose side grip,
  // and a glass tucked near the waist. Every lift still meets the same lips.
  const restingCups = [
    [35, -91],
    [24, -120],
    [34, -111],
    [46, -101],
    [39, -86],
    [23, -100],
  ];
  const [restX, restY] = restingCups[id];
  const cupY = restY + (-139 - restY) * lift - standing * 8 * (1 - lift);
  const cupX = lean + restX + (8 - restX) * lift;
  const elbowX = lean + [33, 30, 34, 39, 36, 29][id] + 4 * lift;
  const elbowY = [-91, -108, -99, -90, -82, -95][id] - 17 * lift - standing * 8 * (1 - lift);
  if (cupless) {
    // No glass while working: the lead rests a fist on the hip, the others let the arm hang.
    const hip = role === "lead";
    const el = hip ? [lean + wide + 16, -108] : [lean + wide + 8, -106],
      wr = hip ? [lean + 17, -84] : [lean + wide + 4, -80];
    line([[lean + 26, -136], el, wr], 65, 14);
    line([[lean + 26, -136], el, wr], 180, 10);
    line(
      [
        [el[0] - 2, el[1] - 5],
        [el[0] + 3, el[1]],
      ],
      240,
      2,
    );
    ellipse(wr[0], wr[1] + 1, 6, 6, 225);
    for (let finger = 0; finger < 3; finger++)
      line(
        [
          [wr[0] - 3 + finger * 3, wr[1] - 1],
          [wr[0] - 3 + finger * 3, wr[1] + 4],
        ],
        110,
        1,
      );
  } else {
    // A outlined sleeve, wrist and fingers. The cup rests outside the torso.
    line(
      [
        [lean + 26, -136],
        [elbowX, elbowY],
        [cupX + 6, cupY + 5],
      ],
      65,
      14,
    );
    line(
      [
        [lean + 26, -136],
        [elbowX, elbowY],
        [cupX + 6, cupY + 5],
      ],
      185,
      10,
    );
    line(
      [
        [elbowX - 2, elbowY - 5],
        [elbowX + 3, elbowY],
      ],
      235,
      2,
    );
    // A small ribbed cuff separates the sleeve from the hand.
    const cuffX = cupX + 6,
      cuffY = cupY + 5;
    const armLength = Math.hypot(cuffX - elbowX, cuffY - elbowY) || 1;
    const cuffDX = (cuffX - elbowX) / armLength,
      cuffDY = (cuffY - elbowY) / armLength;
    for (let rib = 0; rib < 3; rib++) {
      const cx = cuffX - cuffDX * (4 + rib * 2),
        cy = cuffY - cuffDY * (4 + rib * 2);
      line(
        [
          [cx - cuffDY * 4, cy + cuffDX * 4],
          [cx + cuffDY * 4, cy - cuffDX * 4],
        ],
        rib === 2 ? 55 : 240,
        1.5,
      );
    }
  }
  // Keep faces readable from the front while glancing toward the neighbour.
  c.save();
  c.translate(turn * 4, activity?.nod ?? 0);
  c.rotate(turn * 0.045);
  c.scale(1 - Math.abs(turn) * 0.07, 1);
  c.translate(lean, -150);
  c.rotate(thought * 0.065);
  c.translate(-lean, 150 + thought * 2);
  // Heads are drawn ~12% larger: at glyph resolution every extra row goes to the face.
  c.translate(lean, -151);
  c.scale(1.12, 1.12);
  c.rotate(laugh * (-0.05 + (activity?.chuckle ?? 0) * 0.012));
  c.translate(-lean, 151 - laugh * 1.5);
  c.translate(lean, -165);
  c.rotate(-exhale * 0.1);
  c.scale(1, 1 - exhale * 0.09);
  c.translate(-lean, 165 - exhale * 4);
  const faceWidth = [18, 14, 16, 20, 17, 15][id] + (guest ? ((guest + id) % 3) - 1 : 0);
  const faceHeight = [22, 24, 22, 20, 21, 24][id];
  const blink = activity?.blink ?? 0;
  const look = turn * 1.8 - thought * 1.2;
  // Value-sculpted head: lit cheek, soft shade side and a pale forehead. Features are
  // broad value breaks (brow bands, eye slits, moustache) so they survive glyph sampling.
  shape(
    [
      [lean - 7.5, -153],
      [lean + 7.5, -153],
      [lean + 8.5, -142],
      [lean - 8.5, -142],
    ],
    150,
  );
  line(
    [
      [lean - 6, -146],
      [lean + 1, -144.5],
      [lean + 7, -146],
    ],
    110,
    2,
  );
  ellipse(lean, -169, faceWidth, faceHeight, 165);
  ellipse(lean - 3, -171, faceWidth * 0.74, faceHeight * 0.8, 200);
  ellipse(lean - 4, -179, faceWidth * 0.5, faceHeight * 0.22, 222);
  shape(
    [
      [lean + faceWidth * 0.55, -186],
      [lean + faceWidth, -172],
      [lean + faceWidth * 0.8, -155],
      [lean + faceWidth * 0.35, -149],
      [lean + faceWidth * 0.6, -160],
      [lean + faceWidth * 0.72, -174],
    ],
    128,
  );
  ellipse(lean - faceWidth - 1, -169, 2.6, 5, 195);
  ellipse(lean + faceWidth + 1, -169, 2.6, 5, 130);
  ellipse(lean - faceWidth - 1, -169, 1, 2.6, 140);
  if (role === "advisor") {
    // Long white beard flowing past the chin onto the chest.
    shape(
      [
        [lean - faceWidth - 1, -166],
        [lean - faceWidth * 0.8, -146],
        [lean - 11, -126],
        [lean, -117],
        [lean + 11, -126],
        [lean + faceWidth * 0.8, -146],
        [lean + faceWidth + 1, -166],
        [lean + 9, -151],
        [lean, -148],
        [lean - 9, -151],
      ],
      246,
    );
    line(
      [
        [lean - 7, -140],
        [lean - 4, -124],
      ],
      175,
      1.6,
    );
    line(
      [
        [lean + 7, -140],
        [lean + 4, -124],
      ],
      175,
      1.6,
    );
    line(
      [
        [lean, -143],
        [lean, -122],
      ],
      175,
      1.6,
    );
  }
  if (role === "lead") {
    // Tall bright fez with a dark band and a swinging tassel: the lead's signature silhouette.
    shape(
      [
        [lean - 15, -183],
        [lean - 12, -207],
        [lean + 12, -207],
        [lean + 15, -183],
      ],
      238,
    );
    line(
      [
        [lean - 15, -186],
        [lean + 15, -186],
      ],
      100,
      5,
    );
    line(
      [
        [lean - 10, -203],
        [lean + 10, -203],
      ],
      150,
      2,
    );
    line(
      [
        [lean + 9, -207],
        [lean + 17, -197],
        [lean + 16, -186],
      ],
      255,
      2.4,
    );
    ellipse(lean + 16, -185, 2.6, 3.2, 255);
  } else if (role === "advisor") {
    // Bare crown with white side tufts and bushy brows.
    // Rounded bald crown with a soft white fringe at ear level only; nothing pointed above the temples.
    ellipse(lean - 1, -189, 14, 6, 198);
    line(
      [
        [lean - faceWidth, -176],
        [lean - faceWidth - 1, -168],
      ],
      250,
      4.5,
    );
    line(
      [
        [lean + faceWidth, -176],
        [lean + faceWidth + 1, -168],
      ],
      250,
      4.5,
    );
  } else if (id === 1) {
    ellipse(lean, -189, 21, 5, 135);
    fill(160);
    c.fillRect(lean - 16, -198, 31, 9);
  } else if (id === 5) {
    // A low, brimless takke hugs the head; no peaked crown or projecting rim.
    shape(
      [
        [lean - 15, -184],
        [lean - 15, -190],
        [lean - 11, -195],
        [lean - 5, -197],
        [lean + 6, -197],
        [lean + 12, -194],
        [lean + 15, -190],
        [lean + 15, -184],
      ],
      165,
    );
    line(
      [
        [lean - 14, -185],
        [lean - 7, -184],
        [lean + 7, -184],
        [lean + 14, -185],
      ],
      210,
      1,
    );
    for (let stitch = 0; stitch < 6; stitch++) {
      const sx = lean - 12 + stitch * 4;
      line(
        [
          [sx, -190],
          [sx + 1, -192],
          [sx + 2, -190],
        ],
        215,
        0.8,
      );
    }
  } else if (id === 4) {
    shape(
      [
        [lean - 16, -179],
        [lean - 18, -190],
        [lean - 10, -197],
        [lean + 5, -196],
        [lean + 16, -187],
        [lean + 15, -180],
        [lean + 7, -188],
        [lean - 6, -188],
      ],
      85,
    );
    line(
      [
        [lean - 11, -191],
        [lean - 3, -193],
        [lean + 10, -186],
      ],
      225,
      2,
    );
    line(
      [
        [lean - 16, -179],
        [lean - 15, -170],
      ],
      100,
      4,
    );
  } else if (id === 2) {
    line(
      [
        [lean - 15, -183],
        [lean - 9, -191],
        [lean + 8, -191],
        [lean + 15, -181],
      ],
      245,
      5,
    );
  } else if (id === 3) {
    shape(
      [
        [lean - 18, -182],
        [lean - 17, -191],
        [lean - 9, -196],
        [lean + 10, -195],
        [lean + 18, -186],
        [lean + 17, -178],
        [lean + 10, -186],
        [lean - 3, -188],
      ],
      110,
    );
    line(
      [
        [lean - 13, -190],
        [lean - 1, -191],
        [lean + 12, -187],
      ],
      230,
      2,
    );
  } else {
    line(
      [
        [lean - 15, -183],
        [lean - 16, -174],
      ],
      240,
      4,
    );
    line(
      [
        [lean + 15, -183],
        [lean + 16, -173],
      ],
      240,
      4,
    );
  }
  // Brows carry most of the expression: anger pulls the inner ends down, laughter lifts them.
  const browTone = guest ? [200, 80, 110][(guest + id) % 3] : [215, 95, 80, 70, 90, 228][id];
  const browLift = laugh * 1.5 - emphasis * 0 + thought * 0.8;
  for (const side of [-1, 1]) {
    const inner = -178.6 + emphasis * 2.6 - browLift + (thought && side > 0 ? -thought * 1.4 : 0);
    const outer = -178.4 - emphasis * 1.2 - browLift * 0.6;
    line(
      [
        [lean + side * 3, inner],
        [lean + side * 7, -180 - browLift],
        [lean + side * 11.5, outer],
      ],
      browTone,
      2.6,
    );
  }
  for (const side of [-1, 1]) {
    const ex = lean + side * 7;
    // A mid-value socket (never black) makes the slit read without a drawn ring.
    ellipse(ex, -173.6, 5, 2.9, side < 0 ? 150 : 132);
    if (laugh > 0.1) {
      // Smiling, squeezed eyes: an upturned crease with a lifted cheek below.
      line(
        [
          [ex - 3.6, -172.6],
          [ex, -175.2],
          [ex + 3.6, -172.6],
        ],
        48,
        1.9,
      );
    } else if (blink > 0.5) {
      line(
        [
          [ex - 3.4, -173.2],
          [ex, -172.4],
          [ex + 3.4, -173.2],
        ],
        60,
        1.5,
      );
    } else {
      ellipse(ex + look, -173.7, 3.1, 1.55 + emphasis * 0.5, 38);
      ellipse(ex + look - 0.9, -174.1, 0.75, 0.55, 235);
      // Heavy upper lid softens the stare into the patient look of an older man.
      line(
        [
          [ex - 3.6, -174.6 - emphasis * 0.6],
          [ex, -175.6],
          [ex + 3.6, -174.6],
        ],
        side < 0 ? 120 : 100,
        1.2,
      );
    }
    ellipse(lean + side * 9.3, -166.6 - laugh * 1.4, 4.2, 2.4, side < 0 ? 236 : 188);
  }
  // Nose by light, not outline: ridge highlight, bright tip, one soft nostril shade.
  line(
    [
      [lean - 0.4, -176],
      [lean + 0.2, -170],
      [lean + 0.8, -165.5],
    ],
    222,
    2.3,
  );
  ellipse(lean + 0.8, -163.6, 3.1, 2.5, 234);
  ellipse(lean + 3.6, -162.2, 2.1, 1.5, 128);
  ellipse(lean - 1.8, -161.6, 1.1, 0.8, 140);
  // Moustache masses are the strongest facial landmark at small sizes.
  if (id === 5) {
    shape(
      [
        [lean - 13, -158],
        [lean - 11, -146],
        [lean - 5, -136],
        [lean + 2, -133],
        [lean + 10, -143],
        [lean + 13, -158],
        [lean + 7, -153],
        [lean, -151],
        [lean - 7, -153],
      ],
      245,
    );
    line(
      [
        [lean - 4, -151],
        [lean, -150.2],
        [lean + 4, -151],
      ],
      70,
      1.4,
    );
  } else if (id !== 2) {
    const tone = role === "advisor" ? 250 : id === 0 ? 242 : id === 1 ? 120 : id === 3 ? 72 : 84;
    const droop = id === 0 ? 2.2 : id === 4 ? -1.6 : 0.6;
    shape(
      [
        [lean - 11, -155.5 + droop],
        [lean - 6, -160],
        [lean, -158.4],
        [lean + 6, -160],
        [lean + 11, -155.5 + droop],
        [lean + 9, -154.4 + droop * 0.5],
        [lean + 3, -156],
        [lean, -155.2],
        [lean - 3, -156],
        [lean - 9, -154.4 + droop * 0.5],
      ],
      tone,
    );
    if (id === 4) {
      line(
        [
          [lean - 10, -156],
          [lean - 13, -158.5],
        ],
        tone,
        2.2,
      );
      line(
        [
          [lean + 10, -156],
          [lean + 13, -158.5],
        ],
        tone,
        2.2,
      );
    }
    if (id === 0) {
      line(
        [
          [lean - 10, -155],
          [lean - 12, -150.5],
        ],
        240,
        2.6,
      );
      line(
        [
          [lean + 10, -155],
          [lean + 12, -150.5],
        ],
        236,
        2.6,
      );
    }
  }
  if (id !== 5) {
    // Closed mouth is a soft dark seam with a lit lower lip and chin.
    line(
      [
        [lean - 4.2, -151.6],
        [lean, -151],
        [lean + 4.2, -151.6],
      ],
      64,
      1.5,
    );
    line(
      [
        [lean - 3.5, -149.6],
        [lean + 3.5, -149.6],
      ],
      218,
      1.4,
    );
    ellipse(lean - 0.5, -146.6, 5.5, 2, 206);
  }
  if (role === "advisor") {
    // Bold round spectacles, thick enough to read at background scale.
    for (const side of [-7.5, 7.5]) {
      c.strokeStyle = themePalette.rgb_250_250_250;
      c.lineWidth = 2.4;
      c.beginPath();
      c.ellipse(lean + side, -173.6, 6.2, 5.6, 0, 0, Math.PI * 2);
      c.stroke();
    }
    line(
      [
        [lean - 1.5, -174],
        [lean + 1.5, -174],
      ],
      250,
      2.2,
    );
    line(
      [
        [lean - 13.6, -175],
        [lean - faceWidth, -173.5],
      ],
      230,
      2,
    );
    line(
      [
        [lean + 13.6, -175],
        [lean + faceWidth, -173.5],
      ],
      230,
      2,
    );
  }
  if (standing > 0.65) {
    // Small articulation is the default; laughter has smiling eyes and lifted corners.
    if (laugh > 0.1) {
      const opening = (2.5 + Math.abs(activity?.chuckle ?? 0) * 1.4) * laugh;
      ellipse(lean, -150, 5.5 + 2 * laugh, opening, 45);
      line(
        [
          [lean - 6, -151],
          [lean, -149],
          [lean + 6, -151],
        ],
        225,
        1.4,
      );
      line(
        [
          [lean - 5, -153],
          [lean + 5, -153],
        ],
        245,
        1.6 * laugh,
      );
      // Buoyant laughter marks, distinct from the straight shouting rays.
      // Letter strokes are sampled into the same binary glyphs as the characters.
      const beat = (activity?.chuckle ?? 0) / 1.7;
      for (const side of [-1, 1]) {
        const pulse = Math.max(0, side * beat);
        c.save();
        c.globalAlpha = laugh * (0.35 + 0.65 * pulse);
        const hx = lean + (side < 0 ? -44 : 25),
          hy = -187 - pulse * 5;
        line(
          [
            [hx, hy + 8],
            [hx, hy],
            [hx, hy + 4],
            [hx + 5, hy + 4],
            [hx + 5, hy],
            [hx + 5, hy + 8],
          ],
          235,
          1.6,
        );
        line(
          [
            [hx + 8, hy + 8],
            [hx + 11, hy],
            [hx + 14, hy + 8],
          ],
          235,
          1.6,
        );
        line(
          [
            [hx + 9, hy + 5],
            [hx + 13, hy + 5],
          ],
          235,
          1.4,
        );
        line(
          [
            [lean + side * 23, -169],
            [lean + side * 27, -166],
            [lean + side * 29, -161],
          ],
          220,
          1.5,
        );
        line(
          [
            [lean + side * 27, -172],
            [lean + side * 31, -168],
            [lean + side * 33, -163],
          ],
          210,
          1.2,
        );
        c.restore();
      }
    } else if (talking > 0.1 && emphasis > 0.15) {
      // Anime shout: a readable lip rim, upper teeth and tongue rather than a black hole.
      const opening = (2 + talking * 4) * emphasis;
      const mouthWidth = 5 + talking * 3;
      ellipse(lean, -154, mouthWidth + 1, opening + 1, 225);
      ellipse(lean, -154, mouthWidth, opening, 30);
      line(
        [
          [lean - mouthWidth * 0.65, -154 - opening + 2],
          [lean + mouthWidth * 0.65, -154 - opening + 2],
        ],
        255,
        2.5,
      );
      if (opening > 3.5) ellipse(lean + 1, -154 + opening - 1.8, mouthWidth * 0.48, 1.8, 210);
      // Short bursts follow loud syllables, on both sides of the face.
      if (talking * emphasis > 0.58) {
        for (const side of [-1, 1]) {
          line(
            [
              [lean + side * 22, -165],
              [lean + side * 29, -169],
            ],
            235,
            1.4,
          );
          line(
            [
              [lean + side * 24, -157],
              [lean + side * 33, -157],
            ],
            245,
            1.6,
          );
          line(
            [
              [lean + side * 22, -150],
              [lean + side * 28, -146],
            ],
            210,
            1.3,
          );
        }
      }
    } else if (talking > 0.1) {
      ellipse(lean, -151, 3 + talking * 2, 1 + talking * 1.6, 65);
      line(
        [
          [lean - 3, -149],
          [lean + 3, -149],
        ],
        210,
        1,
      );
    }
  }
  if (thought > 0.35) {
    // Thinking: three dots rise in turn above the tilted head, like a cursor waiting.
    const beat = Math.floor(time / 420) % 4;
    for (let dot = 0; dot < 3; dot++) {
      c.save();
      c.globalAlpha = ((thought - 0.35) / 0.65) * (dot < beat ? 1 : 0.25);
      ellipse(lean + 16 + dot * 7, -198 - dot * 5, 1.9 + dot * 0.5, 1.6 + dot * 0.4, 235);
      c.restore();
    }
  }
  if (emphasis > 0.45) {
    // Anime anger mark at the temple: four short bowed strokes around a gap.
    const vx = lean + faceWidth + 4,
      vy = -192,
      pop = 1.25 + Math.sin(time / 90) * 0.15;
    c.save();
    c.globalAlpha = Math.min(1, (emphasis - 0.45) / 0.4);
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      line(
        [
          [vx + dx * 1.2 * pop, vy + dy * 4 * pop],
          [vx + dx * 3.4 * pop, vy + dy * 1.8 * pop],
          [vx + dx * 4.2 * pop, vy + dy * 0.8 * pop],
        ],
        245,
        2,
      );
    }
    c.restore();
  }
  if (exhale > 0.05) {
    ellipse(lean + 2, -151, 3.7, 3, 225);
    ellipse(lean + 3, -152, 2, 1.8, 45);
  }
  // Trouser folds and substantial shoe tips keep the seated anatomy readable.
  c.restore();
  if (progress > 0) {
    // Standing folds follow the articulated legs drawn above.
  } else if (id !== 1 && id !== 4 && id !== 5) {
    line(
      [
        [-18, -58],
        [-23, -48],
        [-19, -41],
      ],
      210,
      2,
    );
    line(
      [
        [19, -55],
        [24, -43],
        [20, -30],
      ],
      105,
      2,
    );
    line(
      [
        [-26, -27],
        [-24, -13],
      ],
      225,
      2,
    );
    line(
      [
        [27, -23],
        [30, -12],
      ],
      220,
      2,
    );
    line(
      [
        [-38, -4],
        [-22, -2],
      ],
      110,
      2,
    );
    line(
      [
        [21, -3],
        [42, -3],
      ],
      110,
      2,
    );
  } else if (id === 1) {
    line(
      [
        [-17, -65],
        [3, -53],
        [19, -48],
      ],
      225,
      2,
    );
    line(
      [
        [21, -39],
        [11, -25],
      ],
      225,
      2,
    );
  } else {
    line(
      [
        [-18, -56],
        [-15, -41],
        [-8, -30],
      ],
      215,
      2,
    );
    line(
      [
        [18, -53],
        [16, -36],
        [8, -23],
      ],
      105,
      2,
    );
  }
  // A tulip-shaped tea glass and saucer, visible for every seated man (never for a working, standing one).
  if (!cupless) {
    fill(255);
    c.beginPath();
    c.moveTo(cupX - 6, cupY - 12);
    c.lineTo(cupX + 6, cupY - 12);
    c.lineTo(cupX + 3, cupY - 4);
    c.lineTo(cupX + 5, cupY + 4);
    c.lineTo(cupX - 5, cupY + 4);
    c.lineTo(cupX - 3, cupY - 4);
    c.closePath();
    c.fill();
    shape(
      [
        [cupX - 4, cupY - 8],
        [cupX + 4, cupY - 8],
        [cupX + 1, cupY - 4],
        [cupX + 3, cupY + 2],
        [cupX - 3, cupY + 2],
        [cupX - 1, cupY - 4],
      ],
      65,
    );
    line(
      [
        [cupX - 4, cupY - 11],
        [cupX + 4, cupY - 11],
      ],
      155,
      1,
    );
    line(
      [
        [cupX - 4, cupY - 9],
        [cupX - 3, cupY - 6],
      ],
      255,
      1,
    );
    line(
      [
        [cupX - 3, cupY + 4],
        [cupX + 3, cupY + 4],
      ],
      255,
      1,
    );
    if (lift === 0 && !smoker) {
      // Fresh tea: two faint threads curl up from the glass and thin out.
      for (let wisp = 0; wisp < 2; wisp++) {
        const age = (time / 2600 + id * 0.37 + wisp * 0.5) % 1;
        if (time <= 0) break;
        c.save();
        c.globalAlpha = Math.sin(Math.PI * age) * 0.55;
        const points = Array.from({ length: 6 }, (_, n) => {
          const t = age + n * 0.05;
          return [
            cupX - 2 + wisp * 3 + Math.sin(t * 11 + wisp * 2 + id) * 2.2 * (1 + t),
            cupY - 14 - t * 20,
          ];
        });
        line(points, 215, 1.1);
        c.restore();
      }
    }
    // Grip is painted over the glass edge, after the face, in every sip pose.
    if (id === 0 || id === 3) {
      ellipse(cupX, cupY + 8, id === 3 ? 13 : 11, 2, 235);
      shape(
        [
          [cupX + 11, cupY + 10],
          [cupX + 5, cupY + 14],
          [cupX - 5, cupY + 12],
          [cupX - 8, cupY + 9],
          [cupX + 5, cupY + 10],
        ],
        215,
      );
      for (let f = 0; f < 3; f++)
        line(
          [
            [cupX - 5 + f * 3, cupY + 10],
            [cupX - 2 + f * 3, cupY + 12],
          ],
          100,
          1,
        );
    } else if (id === 1 || id === 2) {
      const gripY = cupY - (id === 2 ? 9 : 4);
      line(
        [
          [cupX + 10, cupY + 8],
          [cupX + 9, gripY],
          [cupX + 4, gripY - 1],
        ],
        225,
        4,
      );
      line(
        [
          [cupX + 5, gripY + 4],
          [cupX + 2, gripY + 1],
        ],
        235,
        3,
      );
      line(
        [
          [cupX + 9, gripY + 1],
          [cupX + 5, gripY + 2],
        ],
        95,
        1,
      );
    } else {
      shape(
        [
          [cupX + 11, cupY + 8],
          [cupX + 11, cupY + 2],
          [cupX + 7, cupY - 2],
          [cupX + 3, cupY],
          [cupX + 4, cupY + 3],
          [cupX + 7, cupY + 4],
          [cupX + 4, cupY + 6],
          [cupX + 6, cupY + 9],
        ],
        225,
      );
      for (let f = 0; f < 3; f++)
        line(
          [
            [cupX + 4, cupY + f * 2],
            [cupX + 8, cupY + 1 + f * 2],
          ],
          110,
          1,
        );
    }
  }
  if (smoker) {
    // Two fingers hold the cigarette, painted over the face during the inhale.
    ellipse(cigaretteX - 4, cigaretteY + 5, 5, 5, 215);
    line(
      [
        [cigaretteX - 7, cigaretteY + 3],
        [cigaretteX + 1, cigaretteY],
      ],
      235,
      2.7,
    );
    line(
      [
        [cigaretteX - 6, cigaretteY + 6],
        [cigaretteX + 2, cigaretteY + 3],
      ],
      230,
      2.7,
    );
    line(
      [
        [cigaretteX + 1, cigaretteY + 1],
        [cigaretteX + 13, cigaretteY - 4],
      ],
      245,
      2.2,
    );
    line(
      [
        [cigaretteX + 11, cigaretteY - 3],
        [cigaretteX + 13, cigaretteY - 4],
      ],
      smokeLift > 0.8 ? 255 : 140,
      2.5,
    );
    // A thin thread leaves the ember while the hand rests; the exhale is a sinuous
    // ribbon that widens, curls and breaks into sparse glyphs as it rises.
    const smokeTime = activity?.smokeTime ?? 0;
    if (smokeLift < 0.6) {
      c.save();
      c.globalAlpha = 0.5 * (1 - smokeLift);
      line(
        Array.from({ length: 7 }, (_, n) => [
          cigaretteX + 13 + (Math.sin(time / 300 + n * 0.9) * 1.6 * n) / 3,
          cigaretteY - 5 - n * 3.4,
        ]),
        225,
        1,
      );
      c.restore();
    }
    for (let puff = 0; puff < 10; puff++) {
      const age = (smokeTime - puff * 170) / 3000;
      if (smokeTime <= 0 || age <= 0 || age >= 1) continue;
      c.save();
      c.globalAlpha = Math.sin(Math.PI * Math.sqrt(age)) * 0.8 * (1 - age * 0.35);
      const px = lean + 6 + age * 38 + Math.sin(age * 7 + puff * 1.3) * (3 + age * 6);
      const py = -160 - age * 96;
      const radius = 1.5 + age * 9;
      const sweep = 2.4 + age * 1.8;
      const points = Array.from({ length: 10 }, (_, n) => {
        const angle = puff * 0.9 + (n / 9) * sweep + age * 2;
        const r = radius * (0.55 + (0.45 * n) / 9);
        return [px + Math.cos(angle) * r, py + Math.sin(angle) * r * 0.6];
      });
      line(points, 238, 1.8 - age * 0.6);
      c.restore();
    }
  }
  const impact = activity?.impact ?? 0;
  if (impact > 0.05) {
    // Stomp: a flattened shock ring, radial dust ticks and two bouncing grit specks.
    const footY = rise - 1,
      spread = 1 - impact,
      footX = 28;
    c.save();
    c.globalAlpha = Math.min(1, impact * 1.6);
    c.strokeStyle = themePalette.rgb_235_235_235;
    c.lineWidth = 2.2;
    c.beginPath();
    c.ellipse(footX, footY, 10 + spread * 22, 2 + spread * 4, 0, Math.PI * 1.05, Math.PI * 1.95);
    c.stroke();
    for (const angle of [-2.7, -2.2, -1.57, -0.95, -0.45]) {
      const r0 = 8 + spread * 12,
        r1 = r0 + 5;
      line(
        [
          [footX + Math.cos(angle) * r0 * 1.4, footY + Math.sin(angle) * r0 * 0.7],
          [footX + Math.cos(angle) * r1 * 1.4, footY + Math.sin(angle) * r1 * 0.7],
        ],
        240,
        1.9,
      );
    }
    for (const side of [-1, 1])
      ellipse(
        footX + side * (12 + spread * 16),
        footY - Math.sin(spread * Math.PI) * 9,
        1.3,
        1.2,
        230,
      );
    c.restore();
  }
  c.restore();
  c.restore();
}

/** Ages in drawing order; the last one is the uncle drawn by `sitter`. */
export const CREW_STAGES = ["baby", "child", "adult", "uncle"] as const;
const UNCLE_STAGE = CREW_STAGES.length - 1;

/** One crew member of any age at the current origin. Young ones grow a little inside their stage. */
function member(
  c: CanvasRenderingContext2D,
  id: number,
  stage: number,
  growth: number,
  pose: TeaPose,
  activity: CrewActivity | undefined,
  time: number,
) {
  if (stage >= UNCLE_STAGE) {
    sitter(c, id, 0, 0, pose, activity, time);
    return;
  }
  const grow = stage === 2 ? 0.97 + 0.04 * growth : 0.9 + 0.14 * growth;
  c.save();
  c.scale(grow, grow);
  drawYoung(c, {
    age: CREW_STAGES[stage] as CrewAge,
    id,
    pose,
    a: activity ?? { stand: 0, talk: 0 },
    time,
  });
  c.restore();
}

const SIGN_LOGO_SRC = "/brand/bycoda/logo-horizontal-white.svg";
let signLogo: HTMLImageElement | null = null;
let signLogoLoad: Promise<void> | null = null;
/** Loads the sign's logo once; resolves (never rejects) when it can be painted or has failed. */
export function loadCrewSignLogo(): Promise<void> {
  if (signLogoLoad) return signLogoLoad;
  if (typeof Image === "undefined") return (signLogoLoad = Promise.resolve());
  const image = new Image();
  signLogoLoad = new Promise<void>((resolve) => {
    image.onload = () => {
      signLogo = image;
      resolve();
    };
    image.onerror = () => resolve();
  });
  image.src = SIGN_LOGO_SRC;
  return signLogoLoad;
}

/** The sign ("tabela") hanging over the crew on two chains, carrying the bycoda logo. */
function drawSign(c: CanvasRenderingContext2D, time: number) {
  const cx = CODE_WIDTH / 2,
    w = 236,
    h = 58,
    top = 14,
    x0 = cx - w / 2;
  c.save();
  c.translate(cx, 0);
  c.rotate(Math.sin(time / 2400) * 0.012);
  c.translate(-cx, 0);
  c.strokeStyle = themePalette.hexa8a8a8;
  c.lineWidth = 1.6;
  c.fillStyle = themePalette.hexd0d0d0;
  for (const x of [x0 + 34, x0 + w - 34]) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, top + 2);
    c.stroke();
    for (let link = 0; link < 3; link++) {
      c.beginPath();
      c.ellipse(x, 3 + link * 4.5, 1.6, 2.2, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.fillStyle = themePalette.hex7a7a7a;
  c.fillRect(x0, top, w, h);
  c.fillStyle = themePalette.hex565656;
  c.fillRect(x0 + 5, top + 5, w - 10, h - 10);
  c.strokeStyle = themePalette.hexcfcfcf;
  c.lineWidth = 1.2;
  c.strokeRect(x0 + 8, top + 8, w - 16, h - 16);
  c.strokeStyle = themePalette.hex9a9a9a;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x0 + 6, top + h - 3);
  c.lineTo(x0 + w - 6, top + h - 3);
  c.stroke();
  c.fillStyle = themePalette.hexeeeeee;
  for (const [x, y] of [
    [x0 + 4, top + 4],
    [x0 + w - 4, top + 4],
    [x0 + 4, top + h - 4],
    [x0 + w - 4, top + h - 4],
  ]) {
    c.beginPath();
    c.arc(x, y, 1.5, 0, Math.PI * 2);
    c.fill();
  }
  if (signLogo?.naturalWidth) {
    const lw = 184,
      lh = (lw * signLogo.naturalHeight) / signLogo.naturalWidth;
    c.drawImage(signLogo, cx - lw / 2, top + (h - lh) / 2, lw, lh);
  }
  c.restore();
}

// Value becomes ink: shadows use thin "1"s, mid tones the mixed code texture and
// highlights a bold "0". Darkest paint stays empty, so eyes and mouths read as gaps.
const GLYPH_BANDS = [
  {
    from: 0,
    chars: (column: number, row: number) => ((column + row) % 5 === 2 ? "0" : "1"),
    font: '5px "Consolas", "Courier New", monospace',
  },
  {
    from: 150,
    chars: (column: number, row: number) => ((column + row) % 3 === 0 ? "1" : "0"),
    font: '5px "Consolas", "Courier New", monospace',
  },
  {
    from: 205,
    chars: (column: number, row: number) => ((column + row) % 4 === 1 ? "1" : "0"),
    font: 'bold 5.4px "Consolas", "Courier New", monospace',
  },
] as const;
/** A glyph tile repeats every 4x4 cells; a cell is 3x5 output pixels. */
const TILE_WIDTH = 12,
  TILE_HEIGHT = 20;

function glyphTile(band: (typeof GLYPH_BANDS)[number]): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  tile.width = TILE_WIDTH;
  tile.height = TILE_HEIGHT;
  const glyphs = tile.getContext("2d");
  if (glyphs) {
    glyphs.font = band.font;
    glyphs.textBaseline = "top";
    glyphs.fillStyle = themePalette.hexfff;
    for (let row = 0; row < 4; row++)
      for (let column = 0; column < 4; column++)
        glyphs.fillText(band.chars(column, row), column * 3, row * 5);
  }
  return tile;
}

type Compositor = ((cells: Uint8ClampedArray) => void | false) & { dispose?: () => void };
export type CodeArtPainter = ((
  poses: TeaPose[],
  activity?: CrewActivity[],
  viewportWidth?: number,
  time?: number,
) => void) & { dispose?: () => void };

const VERTEX_SHADER = `attribute vec2 p; varying vec2 uv;
void main(){ uv=vec2(p.x*.5+.5,.5-p.y*.5); gl_Position=vec4(p,0.,1.); }`;
// Sample the 2x2 mask directly in the fragment shader. No GPU-to-CPU readback.
const FRAGMENT_SHADER = `precision highp float;
uniform sampler2D tone; uniform sampler2D atlas; uniform vec2 cells; varying vec2 uv;
vec2 sampleCell(vec2 cell){
 if(cell.x<0. || cell.y<0. || cell.x>=cells.x || cell.y>=cells.y)return vec2(0.);
 vec2 base=cell*2.; vec2 size=cells*2.;
 vec4 a=texture2D(tone,(base+vec2(.5,.5))/size);
 vec4 b=texture2D(tone,(base+vec2(1.5,.5))/size);
 vec4 c=texture2D(tone,(base+vec2(.5,1.5))/size);
 vec4 d=texture2D(tone,(base+vec2(1.5,1.5))/size);
 float sum=a.a+b.a+c.a+d.a;
 if(sum==0.)return vec2(0.);
 float v=(a.r*a.a+b.r*b.a+c.r*c.a+d.r*d.a)/sum;
 return vec2(floor(v*255.+.5)/255.,v<78./255.?0.:sum/4.);
}
void main(){
 vec2 cell=uv*cells; vec2 at=floor(cell); vec2 toneCell=sampleCell(at);
 if(toneCell.y<.1){gl_FragColor=vec4(0.);return;}
 bool rim=sampleCell(at+vec2(-1.,0.)).y<.1 || sampleCell(at+vec2(1.,0.)).y<.1 || sampleCell(at+vec2(0.,-1.)).y<.1 || sampleCell(at+vec2(0.,1.)).y<.1;
 float v=min(1.,toneCell.x+(rim?38./255.:0.));
 float alpha=floor(smoothstep(.1,.6,toneCell.y)*255.+.5)/255.;
 float band=v>=${GLYPH_BANDS[2].from.toFixed(1)}/255.?2.:v>=${GLYPH_BANDS[1].from.toFixed(1)}/255.?1.:0.;
 float light=floor(70.+185.*pow(v,1.35)+.5)/255.;
 vec2 inTile=mod(cell,4.)/4.;
 float ink=texture2D(atlas,vec2((band+inTile.x)/3.,inTile.y)).a*alpha;
 gl_FragColor=vec4(vec3(light*ink),ink);
}`;

/** One draw call: each output pixel looks up its cell's tone and its band's glyph tile. */
function webglCompositor(
  surface: HTMLCanvasElement,
  columns: number,
  rows: number,
  tiles: HTMLCanvasElement[],
): (((mask: HTMLCanvasElement) => void | false) & { dispose?: () => void }) | null {
  // A canvas cannot become a 2D canvas after acquiring a WebGL context. Keep GPU
  // resources private so failed shaders/context loss never disable the visible fallback.
  const gpu = document.createElement("canvas");
  gpu.width = surface.width;
  gpu.height = surface.height;
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = gpu.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
    });
  } catch {
    return null;
  }
  if (!gl || typeof gl.createShader !== "function") return null;
  const context = gl;
  const setup = () => {
    const compile = (type: number, source: string) => {
      const shader = context.createShader(type)!;
      context.shaderSource(shader, source);
      context.compileShader(shader);
      return shader;
    };
    const program = context.createProgram()!;
    context.attachShader(program, compile(context.VERTEX_SHADER, VERTEX_SHADER));
    context.attachShader(program, compile(context.FRAGMENT_SHADER, FRAGMENT_SHADER));
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) return false;
    context.useProgram(program);
    context.bindBuffer(context.ARRAY_BUFFER, context.createBuffer());
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      context.STATIC_DRAW,
    );
    const position = context.getAttribLocation(program, "p");
    context.enableVertexAttribArray(position);
    context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
    const texture = (unit: number) => {
      context.activeTexture(context.TEXTURE0 + unit);
      context.bindTexture(context.TEXTURE_2D, context.createTexture());
      for (const [key, value] of [
        [context.TEXTURE_MIN_FILTER, context.NEAREST],
        [context.TEXTURE_MAG_FILTER, context.NEAREST],
        [context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE],
        [context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE],
      ])
        context.texParameteri(context.TEXTURE_2D, key, value);
    };
    // The three band tiles sit side by side in one small atlas, uploaded once.
    const atlas = document.createElement("canvas");
    atlas.width = TILE_WIDTH * tiles.length;
    atlas.height = TILE_HEIGHT;
    tiles.forEach((tile, index) => atlas.getContext("2d")?.drawImage(tile, index * TILE_WIDTH, 0));
    texture(1);
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA,
      context.RGBA,
      context.UNSIGNED_BYTE,
      atlas,
    );
    texture(0);
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA,
      columns * 2,
      rows * 2,
      0,
      context.RGBA,
      context.UNSIGNED_BYTE,
      null,
    );
    context.uniform1i(context.getUniformLocation(program, "tone"), 0);
    context.uniform1i(context.getUniformLocation(program, "atlas"), 1);
    context.uniform2f(context.getUniformLocation(program, "cells"), columns, rows);
    context.viewport(0, 0, surface.width, surface.height);
    context.clearColor(0, 0, 0, 0);
    return true;
  };
  const release = () => context.getExtension?.("WEBGL_lose_context")?.loseContext?.();
  try {
    if (!setup()) {
      release();
      return null;
    }
  } catch {
    release();
    return null;
  }
  const destination = surface.getContext("2d");
  if (!destination) {
    release();
    return null;
  }
  // Context loss switches the painter to its visible 2D fallback.
  const lost = (event: Event) => event.preventDefault();
  gpu.addEventListener("webglcontextlost", lost);
  const composite = (mask: HTMLCanvasElement): void | false => {
    if (context.isContextLost()) return false;
    context.texSubImage2D(context.TEXTURE_2D, 0, 0, 0, context.RGBA, context.UNSIGNED_BYTE, mask);
    context.clear(context.COLOR_BUFFER_BIT);
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
    destination.clearRect(0, 0, surface.width, surface.height);
    destination.drawImage(gpu, 0, 0);
  };
  composite.dispose = () => {
    gpu.removeEventListener("webglcontextlost", lost);
    release();
  };
  return composite;
}

/** Canvas 2D fallback: one tone layer per band, masked by that band's glyph pattern. */
function canvasCompositor(
  surface: HTMLCanvasElement,
  columns: number,
  rows: number,
  tiles: HTMLCanvasElement[],
  debug?: "tones" | "mask",
  mask?: HTMLCanvasElement,
): Compositor | null {
  const context = surface.getContext("2d");
  const scratch = document.createElement("canvas");
  scratch.width = surface.width;
  scratch.height = surface.height;
  const layer = scratch.getContext("2d");
  if (!context || !layer) return null;
  const bands = tiles.map((tile) => {
    const tone = document.createElement("canvas");
    tone.width = columns;
    tone.height = rows;
    const toneContext = tone.getContext("2d");
    return {
      tone,
      toneContext,
      pattern: layer.createPattern(tile, "repeat"),
      data: toneContext?.createImageData(columns, rows),
    };
  });
  return (cells) => {
    for (const band of bands) band.data?.data.fill(0);
    const used = [false, false, false];
    for (let o = 0; o < cells.length; o += 4) {
      if (!cells[o + 3]) continue;
      const index = Math.round(cells[o + 1] / 100);
      const data = bands[index].data?.data;
      if (!data) continue;
      used[index] = true;
      // Neutral grey only: no tint in any channel.
      data[o] = data[o + 1] = data[o + 2] = cells[o];
      data[o + 3] = cells[o + 3];
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, surface.width, surface.height);
    context.imageSmoothingEnabled = false;
    if (debug === "mask" && mask) {
      context.drawImage(mask, 0, 0, surface.width, surface.height);
      return;
    }
    bands.forEach((band, index) => {
      if (!band.data || !band.toneContext) return;
      band.toneContext.putImageData(band.data, 0, 0);
      if (debug === "tones") {
        context.drawImage(band.tone, 0, 0, surface.width, surface.height);
        return;
      }
      if (!used[index] || !band.pattern) return;
      layer.globalCompositeOperation = "copy";
      layer.imageSmoothingEnabled = false;
      layer.drawImage(band.tone, 0, 0, surface.width, surface.height);
      layer.globalCompositeOperation = "destination-in";
      layer.fillStyle = band.pattern;
      layer.fillRect(0, 0, surface.width, surface.height);
      context.drawImage(scratch, 0, 0);
    });
  };
}

export function createCodeArtPainter(
  surface: HTMLCanvasElement,
  options: { debug?: "tones" | "mask"; renderer?: "auto" | "canvas" } = {},
): CodeArtPainter {
  surface.width = CODE_WIDTH * SAMPLE_SCALE;
  surface.height = CODE_HEIGHT * SAMPLE_SCALE;
  // One glyph cell is 3x5 output pixels. The scene is rasterized with 2x2 samples per
  // cell on a small canvas; the GPU area-averages directly, so thin strokes become dimmer
  // glyphs instead of random hits, without reading back a full-resolution surface.
  const columns = surface.width / 3,
    rows = surface.height / 5;
  const mask = document.createElement("canvas");
  mask.width = columns * 2;
  mask.height = rows * 2;
  const tiles = GLYPH_BANDS.map(glyphTile);
  // GPU path first; the 2D path keeps WebGL-less WebViews, tests and debugging working.
  let gpu =
    !options.debug && options.renderer !== "canvas"
      ? webglCompositor(surface, columns, rows, tiles)
      : null;
  const c = mask.getContext("2d", { willReadFrequently: !gpu });
  if (!c) {
    gpu?.dispose?.();
    return () => {};
  }
  let fallback: Compositor | null = null;
  const composite = (cells: Uint8ClampedArray) => {
    fallback ??= canvasCompositor(surface, columns, rows, tiles, options.debug, mask);
    fallback?.(cells);
  };
  const coverage = new Float32Array(columns * rows);
  const shade = new Uint8ClampedArray(columns * rows);
  const cells = new Uint8ClampedArray(columns * rows * 4);
  const ramp = Uint8ClampedArray.from(
    { length: 256 },
    (_, v) => 70 + 185 * Math.pow(v / 255, 1.35),
  );
  const paint: CodeArtPainter = (
    poses: TeaPose[],
    activity?: CrewActivity[],
    viewportWidth = 1280,
    time = 0,
  ) => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, mask.width, mask.height);
    c.scale(mask.width / CODE_WIDTH, mask.height / CODE_HEIGHT);
    drawSign(c, time);
    c.translate(0, CREW_TOP);
    const places = crewLayout(poses.length, viewportWidth).sort((a, b) => a.y - b.y);
    // Soft floor shadows ground the chairs without introducing a room.
    for (const place of places) {
      const arrival = activity?.[place.id]?.arrival ?? 1;
      const eased = arrival * arrival * (3 - 2 * arrival);
      const entryX = place.id % 2 === 0 ? -70 : CODE_WIDTH + 70;
      const x = place.id < 6 ? place.x : entryX + (place.x - entryX) * eased;
      c.save();
      c.translate(x, place.y);
      c.scale(place.scale, place.scale);
      const floor = c.createRadialGradient(0, 0, 4, 0, 0, 52);
      floor.addColorStop(0, themePalette.rgba_92_92_92_85);
      floor.addColorStop(1, themePalette.rgba_92_92_92_0);
      c.fillStyle = floor;
      c.save();
      c.scale(1, 0.12);
      c.beginPath();
      c.arc(0, 0, 52, 0, Math.PI * 2);
      c.fill();
      c.restore();
      c.restore();
    }
    for (const place of places) {
      const arrival = activity?.[place.id]?.arrival ?? 1;
      const eased = arrival * arrival * (3 - 2 * arrival);
      const entryX = place.id % 2 === 0 ? -70 : CODE_WIDTH + 70;
      const x = place.id < 6 ? place.x : entryX + (place.x - entryX) * eased;
      c.save();
      c.translate(x, place.y);
      c.scale(place.scale, place.scale);
      const state = activity?.[place.id],
        age = state?.age;
      if (age && age.from !== undefined && age.change !== undefined && age.change < 1) {
        // A stage change cross-fades the two ages under a ring of sparkles.
        c.save();
        c.globalAlpha = 1 - age.change;
        member(c, place.id, age.from, age.from < age.stage ? 1 : 0, poses[place.id], state, time);
        c.restore();
        c.save();
        c.globalAlpha = age.change;
        member(c, place.id, age.stage, age.growth, poses[place.id], state, time);
        c.restore();
        growthSparkle(c, age.change, age.stage >= 2 ? 190 : 80 + age.stage * 50);
      } else
        member(
          c,
          place.id,
          age?.stage ?? UNCLE_STAGE,
          age?.growth ?? 1,
          poses[place.id],
          state,
          time,
        );
      c.restore();
    }
    if (gpu) {
      try {
        if (gpu(mask) !== false) return;
      } catch {
        /* Preserve the software glyph fallback. */
      }
      gpu.dispose?.();
      gpu = null;
    }
    const pixels = c.getImageData(0, 0, mask.width, mask.height).data;
    const stride = mask.width * 4;
    for (let y = 0, cell = 0; y < rows; y++)
      for (let x = 0; x < columns; x++, cell++) {
        const o = y * 2 * stride + x * 8;
        const a0 = pixels[o + 3],
          a1 = pixels[o + 7],
          a2 = pixels[o + stride + 3],
          a3 = pixels[o + stride + 7];
        const sum = a0 + a1 + a2 + a3;
        if (sum === 0) {
          coverage[cell] = 0;
          continue;
        }
        const v =
          (pixels[o] * a0 +
            pixels[o + 4] * a1 +
            pixels[o + stride] * a2 +
            pixels[o + stride + 4] * a3) /
          sum;
        // Very dark paint is negative space: pupils, mouths and folds read as gaps.
        coverage[cell] = v < 78 ? 0 : sum / 1020;
        shade[cell] = v;
      }
    for (let y = 0, cell = 0; y < rows; y++)
      for (let x = 0; x < columns; x++, cell++) {
        const a = coverage[cell],
          o = cell * 4;
        if (a < 0.1) {
          cells[o + 3] = 0;
          continue;
        }
        // Silhouette rim is lifted one band so heads, hands and glasses separate from the dark.
        const rim =
          !x ||
          !y ||
          x === columns - 1 ||
          y === rows - 1 ||
          coverage[cell - 1] < 0.1 ||
          coverage[cell + 1] < 0.1 ||
          coverage[cell - columns] < 0.1 ||
          coverage[cell + columns] < 0.1;
        const v = Math.min(255, shade[cell] + (rim ? 38 : 0));
        const alpha = Math.min(1, (a - 0.1) / 0.5);
        cells[o] = ramp[v];
        cells[o + 1] = v >= GLYPH_BANDS[2].from ? 200 : v >= GLYPH_BANDS[1].from ? 100 : 0;
        cells[o + 3] = 255 * alpha * alpha * (3 - 2 * alpha);
      }
    composite(cells);
  };
  paint.dispose = () => {
    gpu?.dispose?.();
    gpu = null;
    fallback = null;
  };
  return paint;
}
