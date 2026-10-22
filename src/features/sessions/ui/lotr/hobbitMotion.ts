import { cue, spline, turn180, unit, type LotrPerformer, type Track } from "./lotrMotionKit";

const PERIOD = 10500;

/**
 * Nervous glance left and right, a quick draw of Sting (it glows blue), a brave little thrust,
 * then a relieved hop. Keys are absolute rotations from the drawn pose; `blade` is the sword's
 * stage direction, so the weapon joint is blade - shoulder - elbow.
 */
const shoulder: Track = [
  [0, 0],
  [1, 0],
  [1.35, 6],
  [1.9, 6],
  [2.35, 4],
  [2.6, -16],
  [3.0, -50],
  [3.3, -48],
  [3.45, -10],
  [3.58, -64],
  [3.75, -69],
  [4.15, -40],
  [4.5, -8],
  [4.85, 6],
  [5.1, 0],
  [5.5, 0],
];

const elbow: Track = [
  [0, 0],
  [1, 0],
  [1.35, -16],
  [1.9, -16],
  [2.35, -30],
  [2.6, -46],
  [3.0, -70],
  [3.3, -72],
  [3.45, -104],
  [3.58, -8],
  [3.75, -4],
  [4.15, -40],
  [4.5, -22],
  [4.85, 0],
  [5.1, 8],
  [5.5, 0],
];

const blade: Track = [
  [0, 0],
  [1, 0],
  [1.35, -8],
  [1.9, -8],
  [2.35, -12],
  [2.6, -4],
  [3.0, -4],
  [3.3, -2],
  [3.45, -19],
  [3.58, 74],
  [3.75, 80],
  [4.15, 30],
  [4.5, 0],
  [4.85, -6],
  [5.1, 4],
  [5.5, 0],
];

const lean: Track = [
  [0, 0],
  [1, 0],
  [1.35, -1.5],
  [1.9, 1.5],
  [2.35, -3],
  [3.0, -2],
  [3.45, -5],
  [3.58, 6],
  [3.75, 7],
  [4.15, 2],
  [4.5, -2],
  [4.85, 0],
  [5.1, 1],
  [5.5, 0],
];

const shift: Track = [
  [0, 0],
  [1, 0],
  [3.0, -1],
  [3.45, -2],
  [3.58, 5],
  [3.75, 5],
  [4.15, 2],
  [4.85, 0],
  [5.5, 0],
];

/** Head turns: negative looks to the viewer's left. */
const look: Track = [
  [0, 0],
  [1, 0],
  [1.35, -1],
  [1.9, 1],
  [2.35, 0],
  [3.0, 0.2],
  [3.58, 0.6],
  [4.15, 0.3],
  [4.6, 0],
  [5.5, 0],
];

const squash: Track = [
  [0, 0],
  [2.35, 0.04],
  [3.45, 0.03],
  [3.58, 0.08],
  [4.15, 0.02],
  [4.45, 0.15],
  [4.7, -0.1],
  [4.9, -0.05],
  [5.06, 0.25],
  [5.3, 0.06],
  [5.7, 0],
];

const hop: Track = [
  [0, 0],
  [4.6, 0],
  [4.72, 0],
  [4.9, -14],
  [5.06, 0],
  [5.5, 0],
];

const cloak: Track = [
  [0, 0],
  [1.35, 2],
  [1.9, -2],
  [2.6, 3],
  [3.45, -6],
  [3.58, 14],
  [3.9, 6],
  [4.3, -3],
  [4.7, 6],
  [4.95, 9],
  [5.12, -10],
  [5.4, 4],
  [5.8, 0],
];

const glow: Track = [
  [0, 0],
  [2.5, 0],
  [2.95, 1],
  [4.3, 1],
  [5.0, 0],
];

/** Worried hand at the chest, then flung wide in relief. */
const offArm: Track = [
  [0, 0],
  [1, 0],
  [1.35, 10],
  [2.35, 10],
  [3.0, 0],
  [3.58, -8],
  [4.15, 0],
  [4.7, 6],
  [4.95, 58],
  [5.12, 30],
  [5.5, 0],
];

const offForearm: Track = [
  [0, 0],
  [1, 0],
  [1.35, -70],
  [2.35, -66],
  [3.0, -20],
  [3.58, -8],
  [4.15, 0],
  [4.95, 14],
  [5.12, 10],
  [5.5, 0],
];

export const perform: LotrPerformer = (motion, context) => {
  const phase = context.time % PERIOD;
  const s = phase / 1000;
  const { strength, gesture, emphasis, thought } = context;
  const energy = 0.88 + strength * 0.12;
  const voice = context.working && !context.listening;
  const shoulderAngle = spline(s, shoulder) * energy;
  const elbowAngle = spline(s, elbow) * energy;
  const tilt = spline(s, lean);
  const gaze = spline(s, look);
  const hopHeight = spline(s, hop);
  const sweep = spline(s, blade);

  motion.action = cue(phase, 900, 4700);
  motion.armAngle = shoulderAngle - gesture * 3;
  motion.forearmAngle = elbowAngle;
  motion.weaponAngle = turn180(sweep - shoulderAngle - elbowAngle);
  motion.offArmAngle = spline(s, offArm);
  motion.offForearmAngle = spline(s, offForearm);
  motion.armY = -emphasis;

  motion.bodyAngle += tilt * energy - emphasis;
  motion.bodyX = spline(s, shift) * energy;
  motion.bodyY += hopHeight;
  motion.squash = spline(s, squash);
  motion.headAngle += gaze * 8 + tilt * 0.5 + thought * 3;
  motion.headX += gaze * 4;
  motion.headScaleX = Math.min(motion.headScaleX, 1 - Math.abs(gaze) * 0.07);
  motion.capeAngle = spline(s, cloak) * energy;

  // Sting flickers a little while it is bright.
  const flicker = 1 + Math.sin(phase / 90) * 0.06;
  motion.glow = unit(spline(s, glow) * (0.8 + strength * 0.2) * flicker);

  // Happy shut eyes on the hop; a small shout on the thrust, only while speaking is allowed.
  if (s > 4.75 && s < 5.25) motion.blink = 1;
  if (voice) {
    const shout = s > 3.5 && s < 3.95 ? 0.9 : 0;
    const grin = s > 4.8 && s < 5.4 ? 0.7 : 0;
    motion.mouth = Math.max(motion.mouth, shout, grin);
  }
};
