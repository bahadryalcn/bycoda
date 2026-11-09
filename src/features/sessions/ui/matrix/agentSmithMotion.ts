import { cue, spline, type LotrPerformer, type Track } from "../lotr/lotrMotionKit";

/** One loop of an Agent Smith routine; every Smith offsets into it so none move in unison. */
export const SMITH_PERIOD = 11_000;

/** Punch flurry: guard arm up, straight punches driven by the whole body, afterimages trail. */
const punchBody: Track = [
  [1.2, 0],
  [1.6, 3],
  [2, -7],
  [3.8, -7],
  [4.2, 0],
  [5, 0],
  [5.08, -10],
  [5.35, -10],
  [5.45, 9],
  [5.75, 9],
  [6.1, 0],
];
const head: Track = [
  [1.2, 0],
  [2, -4],
  [3.8, -4],
  [4.2, 0],
  [5, 0],
  [5.08, -26],
  [5.35, -26],
  [5.45, 22],
  [5.75, 22],
  [5.85, -12],
  [6.1, 0],
  [7.8, 0],
  [8.4, -3],
  [8.9, 4],
  [9.8, 4],
  [10.2, 0],
];
const guardArm: Track = [
  [1.2, 0],
  [1.5, -8],
  [1.9, 78],
  [3.8, 78],
  [4.2, 0],
];
const guardForearm: Track = [
  [1.2, 0],
  [1.9, -20],
  [3.8, -20],
  [4.2, 0],
];
const strikeArm: Track = [
  [1.2, 0],
  [1.8, -60],
  [3.8, -60],
  [4.2, 0],
  [7, 0],
  [7.2, 6],
  [7.8, -140],
  [8.4, -140],
  [8.8, -104],
  [9.8, -104],
  [10.2, -140],
  [10.4, -140],
  [10.9, 0],
];
const strikeForearm: Track = [
  [1.2, 0],
  [1.8, -105],
  [3.8, -105],
  [4.2, 0],
  [7, 0],
  [7.8, -101],
  [8.4, -101],
  [8.8, -80],
  [9.8, -80],
  [10.2, -101],
  [10.4, -101],
  [10.9, 0],
];
/** Head-jerk bullet dodge: the body slides aside and the head snaps against the shot. */
const dodgeX: Track = [
  [5, 0],
  [5.08, -3],
  [5.35, -3],
  [5.45, 3],
  [5.75, 3],
  [6.1, 0],
];

export const perform: LotrPerformer = (motion, context) => {
  const phase = context.time % SMITH_PERIOD;
  const s = phase / 1000;
  // The flurry jitters the limbs with short fast cycles while the punches land.
  const flurry = s > 1.9 && s < 3.8;
  const jitter = (factor: number) => (flurry ? Math.sin(s * 44) * factor : 0);
  motion.action = Math.max(cue(phase, 1200, 3000), cue(phase, 4900, 1500));
  motion.bodyY = Math.sin(s * 1.3) * 0.35;
  motion.bodyX = spline(s, dodgeX);
  motion.propAngle = spline(s, punchBody) + jitter(1.5);
  motion.headAngle = spline(s, head);
  motion.offArmAngle = spline(s, guardArm) + jitter(16);
  motion.offForearmAngle = spline(s, guardForearm) + (flurry ? Math.cos(s * 44) * 24 : 0);
  motion.armAngle = spline(s, strikeArm);
  motion.forearmAngle = spline(s, strikeForearm);
  // Glasses come off with the bare eyes showing, then go back on; the hand holds them meanwhile.
  const bare = s > 8.3 && s < 10.25;
  motion.blink = bare ? 1 : 0;
  motion.glow = bare ? 1 : 0;
  motion.capeAngle = -(motion.propAngle * 0.45 + motion.bodyX * 0.6);
};
