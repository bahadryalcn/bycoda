import { cue, pulse, spline, turn180, type LotrPerformer, type Track } from "./lotrMotionKit";

const PERIOD = 10_400;

/**
 * Light-footed twin knives: cross them in a guard, extend and twirl the right blade, rise on
 * the toes, cut down across the body with the free arm out for balance, then settle calmly.
 * The knives are drawn pointing down from the fists; `blade` and `offBlade` are their turns
 * relative to the forearm, so a full twirl ends where it started.
 */
const shoulder: Track = [
  [0, 0],
  [1, 0],
  [1.4, 8],
  [1.9, -10],
  [2.15, -12],
  [2.55, -95],
  [2.9, -100],
  [3.2, -150],
  [3.45, -24],
  [3.7, -20],
  [4.4, -12],
  [5, 0],
];
const elbow: Track = [
  [0, 0],
  [1, 0],
  [1.4, 10],
  [1.9, 115],
  [2.15, 118],
  [2.55, -10],
  [2.9, -8],
  [3.2, -20],
  [3.45, 80],
  [3.7, 74],
  [4.4, 30],
  [5, 0],
];
const blade: Track = [
  [0, 0],
  [1, 0],
  [1.4, 4],
  [1.9, -20],
  [2.15, -22],
  [2.5, 0],
  [2.9, 360],
  [3.2, 390],
  [3.45, 380],
  [3.7, 378],
  [4.4, 362],
  [5, 360],
];
const offArm: Track = [
  [0, 0],
  [1, 0],
  [1.4, -8],
  [1.9, 10],
  [2.15, 12],
  [2.55, 30],
  [2.9, 32],
  [3.2, 24],
  [3.45, 70],
  [3.7, 72],
  [4.4, 20],
  [5, 0],
];
const offForearm: Track = [
  [0, 0],
  [1, 0],
  [1.4, -10],
  [1.9, -115],
  [2.15, -118],
  [2.55, -60],
  [2.9, -56],
  [3.2, -44],
  [3.45, -12],
  [3.7, -10],
  [4.4, -4],
  [5, 0],
];
const offBlade: Track = [
  [0, 0],
  [1, 0],
  [1.4, -4],
  [1.9, 20],
  [2.15, 22],
  [2.55, 10],
  [3.45, -30],
  [3.7, -28],
  [4.4, -6],
  [5, 0],
];
const lean: Track = [
  [0, 0],
  [1, 0],
  [1.4, 2],
  [1.9, -2],
  [2.55, -4],
  [2.9, -5],
  [3.2, -3],
  [3.45, 6],
  [3.7, 5],
  [4.4, 1],
  [5, 0],
];
const shift: Track = [
  [0, 0],
  [1, 0],
  [1.4, -1],
  [2.55, 2],
  [3.2, 1],
  [3.45, -3],
  [3.8, -2],
  [5, 0],
];
const rise: Track = [
  [0, 0],
  [2.9, 0],
  [3.15, -5],
  [3.45, 0],
  [5, 0],
];
const squash: Track = [
  [0, 0],
  [1.2, 0],
  [1.4, 0.12],
  [1.6, 0],
  [1.9, 0.05],
  [2.4, -0.05],
  [3.15, -0.08],
  [3.45, 0.16],
  [3.7, 0.04],
  [4.4, 0],
  [5, 0],
];
const head: Track = [
  [0, 0],
  [1, 0],
  [1.4, -2],
  [1.9, 3],
  [2.6, -5],
  [3.2, -3],
  [3.45, 4],
  [4.2, 1],
  [5, 0],
];

export const perform: LotrPerformer = (motion, context) => {
  const phase = context.time % PERIOD;
  const s = phase / 1000;
  const energy = 0.88 + context.strength * 0.12;
  const tilt = spline(s, lean) * energy;
  motion.action = cue(phase, 900, 4300);
  motion.armAngle = spline(s, shoulder) * energy - context.gesture * 3;
  motion.forearmAngle = spline(s, elbow) * energy;
  motion.weaponAngle = turn180(spline(s, blade));
  motion.offArmAngle = spline(s, offArm) * energy;
  motion.offForearmAngle = spline(s, offForearm) * energy;
  motion.propAngle = turn180(spline(s, offBlade));
  motion.armY = -context.emphasis;
  motion.bodyAngle += tilt - context.emphasis;
  motion.bodyX = spline(s, shift) * energy;
  motion.bodyY += spline(s, rise);
  motion.squash = spline(s, squash);
  motion.headAngle += spline(s, head) + tilt * 0.4 + context.thought * 2;
  motion.headX += spline(s, shift) * 0.3;
  // The cloak trails the lean and flares once with the cut.
  motion.capeAngle = -tilt * 1.4 + pulse(phase, 3450, 900) * 6;
};
