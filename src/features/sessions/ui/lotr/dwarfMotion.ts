import {
  spline,
  cue,
  turn180,
  unit,
  smooth,
  type LotrPerformer,
  type Track,
} from "./lotrMotionKit";

const PERIOD = 10_000;

// Dwarf signature: crouch, wind the axe behind the head, rise on tiptoe, then chop hard into the
// ground with a stomp. Beard and head lag the impact, then he settles chest-out.
// Absolute keys in seconds. `blade` is the axe haft's absolute angle (0 = straight up, clockwise).
const shoulder: Track = [
  [0, 0],
  [1, 0],
  [1.45, 10],
  [1.95, -150],
  [2.32, -168],
  [2.46, -85],
  [2.6, -22],
  [2.8, -12],
  [3.4, -10],
  [4.2, -6],
  [4.9, 0],
];
const elbow: Track = [
  [0, 0],
  [1, 0],
  [1.45, 12],
  [1.95, -55],
  [2.32, -24],
  [2.46, 40],
  [2.6, 84],
  [2.8, 72],
  [3.4, 58],
  [4.2, 22],
  [4.9, 0],
];
const blade: Track = [
  [0, 0],
  [1, 0],
  [1.45, 6],
  [1.95, -112],
  [2.32, -82],
  [2.46, 58],
  [2.6, 160],
  [2.8, 152],
  [3.4, 140],
  [4.2, 30],
  [4.9, 0],
];
const lean: Track = [
  [0, 0],
  [1, 0],
  [1.45, 3],
  [1.95, -4],
  [2.32, -5],
  [2.6, 7],
  [2.9, 4],
  [3.6, 2],
  [4.3, -1.5],
  [4.9, 0],
];
const shift: Track = [
  [0, 0],
  [1, 0],
  [1.95, -2],
  [2.32, -3],
  [2.62, 3.5],
  [3.2, 2],
  [4.3, 0],
];
// Positive crouches (squash), negative stretches on tiptoe; the landing at 2.6 s is the impact.
const squashTrack: Track = [
  [0, 0],
  [1, 0],
  [1.45, 0.13],
  [1.95, 0.02],
  [2.32, -0.1],
  [2.5, -0.06],
  [2.6, 0.3],
  [2.78, 0.04],
  [2.95, 0.12],
  [3.25, 0],
  [4.3, -0.03],
  [4.8, 0],
];
// Little stomp hop: up before the chop, back on the ground at impact.
const hop: Track = [
  [0, 0],
  [1.9, 0],
  [2.3, -6],
  [2.5, -4],
  [2.6, 0],
  [4.9, 0],
];
// Where the off hand sits on the haft: positive toward the axe head, negative toward the butt.
const along: Track = [
  [0, 20],
  [1.35, 20],
  [1.95, 40],
  [2.32, 42],
  [2.46, 8],
  [2.6, -18],
  [3.4, -18],
  [4.75, -16],
];
// How firmly the off hand holds the haft (0 = hanging at his side).
const grip: Track = [
  [0, 0],
  [1.35, 0],
  [1.85, 1],
  [4.1, 1],
  [4.75, 0],
];

type Point = readonly [number, number];
const R_SHOULDER: Point = [112, 134];
const R_ELBOW: Point = [124, 157];
const R_HAND: Point = [121, 178];
const L_SHOULDER: Point = [48, 134];
const L_ELBOW: Point = [36, 157];
const L_HAND: Point = [39, 178];

const rad = (degrees: number) => (degrees * Math.PI) / 180;
function rotate([x, y]: Point, degrees: number): Point {
  const [c, s] = [Math.cos(rad(degrees)), Math.sin(rad(degrees))];
  return [x * c - y * s, x * s + y * c];
}
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const angleOf = ([x, y]: Point) => (Math.atan2(y, x) * 180) / Math.PI;

/** Main hand position for the given arm and forearm angles. */
function mainHand(arm: number, forearm: number): Point {
  const elbow = add(R_SHOULDER, rotate(sub(R_ELBOW, R_SHOULDER), arm));
  return add(elbow, rotate(sub(R_HAND, R_ELBOW), arm + forearm));
}

/** Two-link solve of the off arm so its fist reaches `target`, elbow bending outward. */
function offArm(target: Point): readonly [number, number] {
  const upper = Math.hypot(...sub(L_ELBOW, L_SHOULDER));
  const lower = Math.hypot(...sub(L_HAND, L_ELBOW));
  const reach = sub(target, L_SHOULDER);
  const distance = Math.min(
    upper + lower - 0.5,
    Math.max(Math.abs(upper - lower) + 0.5, Math.hypot(...reach)),
  );
  const bend = Math.acos(
    (upper * upper + distance * distance - lower * lower) / (2 * upper * distance),
  );
  const toward = angleOf(reach);
  const candidates = [toward + (bend * 180) / Math.PI, toward - (bend * 180) / Math.PI];
  // The elbow points away from the body: the candidate with the smaller x.
  const direction = candidates.reduce((best, a) =>
    Math.cos(rad(a)) < Math.cos(rad(best)) ? a : best,
  );
  const elbow = add(L_SHOULDER, [
    upper * Math.cos(rad(direction)),
    upper * Math.sin(rad(direction)),
  ]);
  const upperAngle = direction - angleOf(sub(L_ELBOW, L_SHOULDER));
  const lowerAngle = angleOf(sub(target, elbow)) - angleOf(sub(L_HAND, L_ELBOW)) - upperAngle;
  const wrap = (a: number) => turn180(a);
  return [wrap(upperAngle), wrap(lowerAngle)];
}

export const perform: LotrPerformer = (motion, context) => {
  const phase = context.time % PERIOD;
  const s = phase / 1000;
  const { strength, gesture } = context;
  const energy = 0.9 + strength * 0.1;
  const action = cue(phase, 1000, 4000);
  motion.action = action;

  const arm = spline(s, shoulder) * energy;
  const forearm = spline(s, elbow) * energy;
  const haft = spline(s, blade) * energy;
  const body = spline(s, lean);
  const side = spline(s, shift);
  const armAngle = arm - gesture * 3;
  motion.armAngle = armAngle;
  motion.forearmAngle = forearm;
  motion.weaponAngle = turn180(haft - armAngle - forearm);
  motion.bodyAngle += body - context.emphasis;
  motion.bodyX = side;
  motion.bodyY += spline(s, hop) * energy;
  motion.squash = spline(s, squashTrack) * energy;

  // Second hand: slide it from his side onto the haft, wherever the axe happens to be.
  const held = unit(spline(s, grip));
  if (held > 0) {
    const hand = mainHand(armAngle, forearm);
    const up = rotate([0, -1], haft);
    const slide = spline(s, along);
    const onHaft = add(hand, [up[0] * slide, up[1] * slide]);
    const mix = smooth(held);
    const target: Point = [
      L_HAND[0] + (onHaft[0] - L_HAND[0]) * mix,
      L_HAND[1] + (onHaft[1] - L_HAND[1]) * mix,
    ];
    const [upper, lower] = offArm(target);
    motion.offArmAngle = upper;
    motion.offForearmAngle = lower;
  }

  // Head dips into the chop and rocks back on the recoil; the beard swings on a short pendulum.
  const sinceImpact = Math.max(0, s - 2.6);
  const ring = s > 2.6 ? Math.exp(-sinceImpact * 4.5) * Math.sin(sinceImpact * 17) : 0;
  const windUp = cue(phase, 1500, 700);
  motion.headAngle +=
    body * 0.7 - ring * 2 + (s > 2.4 && s < 3.2 ? 3 * Math.sin((Math.PI * (s - 2.4)) / 0.8) : 0);
  motion.headX += side * 0.4;
  motion.propAngle =
    ring * 13 * energy - body * 1.2 - windUp * 2 + Math.sin(context.time / 1900) * 0.8;
};
