import { cue, spline, unit, type LotrPerformer, type Track } from "../lotr/lotrMotionKit";

/** One loop of the Morpheus offer on the scene clock. */
export const MORPHEUS_PERIOD = 11_000;

/** He offers both pills, then beckons; the red pill hand rises first, the blue one is held out. */
const body: Track = [
  [1.4, 0],
  [2, 1.6],
  [5, 1.6],
  [5.6, 0],
];
const torso: Track = [
  [1.4, 0],
  [2, -3],
  [5, -3],
  [5.6, 0],
  [6.4, 0],
  [6.8, 4],
  [9, 4],
  [9.4, 0],
];
const head: Track = [
  [1.4, 0],
  [1.8, -3],
  [2.3, 6],
  [5, 5],
  [5.6, 0],
  [6.4, 0],
  [6.8, -6],
  [9, -6],
  [9.4, 0],
];
const arm: Track = [
  [1.4, 0],
  [1.7, 6],
  [2.3, -44],
  [5, -40],
  [5.6, 0],
  [6.4, 0],
  [6.8, -56],
  [9, -54],
  [9.4, 0],
];
const forearm: Track = [
  [1.4, 0],
  [2.3, -50],
  [5, -46],
  [5.6, 0],
  [6.4, 0],
  [6.8, -74],
  [9, -74],
  [9.4, 0],
];
const offArm: Track = [
  [1.4, 0],
  [1.7, -6],
  [2.3, 44],
  [5, 40],
  [5.6, 0],
];
const offForearm: Track = [
  [1.4, 0],
  [2.3, 50],
  [5, 46],
  [5.6, 0],
];
const glow: Track = [
  [2.3, 0],
  [2.7, 1],
  [4.9, 1],
  [5.4, 0],
];

export const perform: LotrPerformer = (motion, context) => {
  const phase = context.time % MORPHEUS_PERIOD;
  const s = phase / 1000;
  motion.action = cue(phase, 1400, 4200);
  motion.bodyY = Math.sin(s * 1.7) * 0.6;
  motion.bodyX = spline(s, body);
  motion.propAngle = spline(s, torso);
  motion.headAngle = spline(s, head);
  motion.armAngle = spline(s, arm);
  motion.forearmAngle =
    spline(s, forearm) + (s > 6.9 && s < 8.9 ? Math.sin((s - 6.9) * 8) * 20 : 0);
  motion.offArmAngle = spline(s, offArm);
  motion.offForearmAngle = spline(s, offForearm);
  // He speaks only while working and not listening to someone else.
  const speaking = (s > 2.6 && s < 4.6) || (s > 7.2 && s < 8.2);
  motion.mouth =
    speaking && context.working && !context.listening ? Math.max(0, Math.sin(s * 13)) : 0;
  motion.glow = unit(spline(s, glow) * (0.8 + 0.2 * Math.sin(s * 5)));
  motion.capeAngle = -motion.bodyX * 0.8;
};
