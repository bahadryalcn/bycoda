import { spline, cue, pulse, turn180, type LotrPerformer, type Track } from "./lotrMotionKit";

const PERIOD = 11000;

// Staff slam ("You shall not pass"): crouch, haul the staff overhead, hold, hammer it down, recoil, settle.
const shoulderKeys: Track = [
  [0, 0],
  [1, 0],
  [1.5, 14],
  [2, -85],
  [2.5, -104],
  [2.75, -102],
  [2.95, -92],
  [3.1, -74],
  [3.4, -70],
  [3.9, -35],
  [4.9, 0],
];
const elbowKeys: Track = [
  [0, 0],
  [1, 0],
  [1.5, 10],
  [2, -20],
  [2.5, -30],
  [2.75, -30],
  [2.95, -26],
  [3.1, -22],
  [3.4, -24],
  [3.9, -8],
  [4.9, 0],
];
// Absolute staff direction (0 = upright, clockwise): swung back, then down onto the ground.
const staffKeys: Track = [
  [0, 0],
  [1, 0],
  [1.5, 6],
  [2, 60],
  [2.5, 92],
  [2.75, 94],
  [2.95, 118],
  [3.1, 160],
  [3.2, 168],
  [3.5, 158],
  [3.9, 60],
  [4.4, 10],
  [4.9, 0],
];
const leanKeys: Track = [
  [0, 0],
  [1, 0],
  [1.55, 3],
  [2.7, -6],
  [3.12, 7],
  [3.5, 5],
  [4.2, 1],
  [4.9, 0],
];
const shiftKeys: Track = [
  [0, 0],
  [1.55, -1.5],
  [2.7, -3],
  [3.12, 3],
  [3.6, 2],
  [4.9, 0],
];
const offArmKeys: Track = [
  [0, 0],
  [1.55, 8],
  [2.7, 62],
  [3.12, 30],
  [4, 8],
  [4.9, 0],
];
const offForearmKeys: Track = [
  [0, 0],
  [1.55, 6],
  [2.7, -40],
  [3.12, -18],
  [4, -4],
  [4.9, 0],
];
const squashKeys: Track = [
  [0, 0],
  [1.4, 0],
  [1.7, 0.1],
  [2.2, -0.08],
  [2.7, -0.12],
  [3.05, -0.06],
  [3.14, 0.28],
  [3.3, 0.1],
  [3.6, 0],
  [4.9, 0],
];
const headKeys: Track = [
  [0, 0],
  [1.55, 3],
  [2.7, -7],
  [3.12, 6],
  [3.6, 5],
  [4.2, -2],
  [4.6, 2],
  [4.9, 0],
];

export const perform: LotrPerformer = (motion, context) => {
  const phase = context.time % PERIOD;
  const s = phase / 1000;
  const energy = 0.88 + context.strength * 0.12;
  const shoulder = spline(s, shoulderKeys) * energy;
  const elbow = spline(s, elbowKeys) * energy;
  const lean = spline(s, leanKeys);
  const shift = spline(s, shiftKeys);
  motion.action = cue(phase, 900, 4000);
  motion.armAngle = shoulder - context.gesture * 3;
  motion.forearmAngle = elbow;
  motion.weaponAngle = turn180(spline(s, staffKeys) - shoulder - elbow);
  motion.offArmAngle = spline(s, offArmKeys);
  motion.offForearmAngle = spline(s, offForearmKeys);
  motion.bodyAngle += lean;
  motion.bodyX = shift;
  motion.squash = spline(s, squashKeys);
  motion.headAngle += spline(s, headKeys) + context.thought * 2;
  motion.headX += shift * 0.3;
  motion.capeAngle = -lean * 1.6 + (s > 3 ? pulse(phase, 3140, 900) * 7 : 0);
  motion.glow = Math.max(pulse(phase, 3100, 700), cue(phase, 2300, 600) * 0.12);
};
