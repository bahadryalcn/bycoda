import {
  cue,
  spline,
  unit,
  type LotrContext,
  type LotrPerformer,
  type Track,
} from "../lotr/lotrMotionKit";

/** One loop of the Neo routine on the scene clock; every seat offsets into it separately. */
export const NEO_PERIOD = 11_000;

/** Bullet time: the dodge slows the code rain while he leans back with both arms out. */
const bulletTime: Track = [
  [1.9, 0],
  [2.3, 1],
  [4.4, 1],
  [5, 0],
];
/** Deep backward bend for the dodge, then a snap upright. */
const body: Track = [
  [1.7, 0],
  [2.1, 2],
  [2.5, -6],
  [4.4, -6],
  [5, 1],
  [5.4, 0],
];
const squash: Track = [
  [1.7, 0],
  [2, 0.05],
  [2.3, -0.02],
  [2.6, 0.03],
  [4.4, 0.03],
  [4.9, -0.02],
  [5.3, 0],
];
const torso: Track = [
  [1.7, 0],
  [2, 6],
  [2.6, -40],
  [4.3, -44],
  [4.9, 4],
  [5.3, 0],
  [6.4, 0],
  [6.8, -3],
  [9.4, -3],
  [9.8, 0],
];
const head: Track = [
  [1.7, 0],
  [2, -4],
  [2.6, -14],
  [4.3, -16],
  [4.9, 3],
  [5.4, 0],
  [6.6, 0],
  [7, 6],
  [9.2, 6],
  [9.8, 0],
];
const arm: Track = [
  [1.7, 0],
  [2, 12],
  [2.6, -100],
  [3.4, -116],
  [4.3, -108],
  [4.9, 8],
  [5.4, 0],
  [6.4, 0],
  [6.7, 8],
  [7.1, -58],
  [9.2, -58],
  [9.6, -4],
  [9.9, 0],
];
const forearm: Track = [
  [1.7, 0],
  [2.6, -40],
  [4.3, -46],
  [4.9, 0],
  [6.4, 0],
  [6.8, 10],
  [7.1, -62],
  [9.2, -62],
  [9.6, 0],
];
const offArm: Track = [
  [1.7, 0],
  [2, -10],
  [2.6, 80],
  [3.4, 94],
  [4.3, 88],
  [4.9, -6],
  [5.4, 0],
];
const offForearm: Track = [
  [1.7, 0],
  [2.6, 36],
  [4.3, 42],
  [4.9, 0],
];
/** The bullets sweep across from one side to the other, visible only during the dodge. */
const weapon: Track = [
  [2.2, -15],
  [4.2, 15],
];
/** The code glow rises around the raised palm. */
const glow: Track = [
  [7, 0],
  [7.2, 1],
  [9, 1],
  [9.5, 0],
];

const seconds = (context: LotrContext) => (context.time % NEO_PERIOD) / 1000;

/** Scene effects Neo drives: bullet time slows the rain, ripple is 0-1 progress of the stop rings or -1. */
export function neoScene(context: LotrContext): {
  bulletTime: number;
  ripple: number;
} {
  const s = seconds(context);
  const ripple = s > 7.1 && s < 9.2 ? ((s - 7.1) % 0.9) / 0.9 : -1;
  return { bulletTime: spline(s, bulletTime), ripple };
}

export const perform: LotrPerformer = (motion, context) => {
  const s = seconds(context);
  motion.action = cue(context.time % NEO_PERIOD, 1000, 4800);
  motion.bodyY = Math.sin(s * 1.9) * 0.7;
  motion.bodyAngle = spline(s, body);
  motion.squash = spline(s, squash);
  motion.propAngle = spline(s, torso);
  motion.headAngle = spline(s, head);
  motion.armAngle = spline(s, arm);
  motion.forearmAngle = spline(s, forearm);
  motion.offArmAngle = spline(s, offArm);
  motion.offForearmAngle = spline(s, offForearm);
  motion.weaponAngle = spline(s, weapon);
  motion.weaponAlpha = s > 2.2 && s < 4.2 ? 1 : 0;
  motion.glow = unit(spline(s, glow));
  motion.capeAngle = -(motion.propAngle * 0.45 + motion.bodyAngle * 0.6);
};
