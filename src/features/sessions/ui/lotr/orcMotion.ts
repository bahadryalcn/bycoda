import { cue, spline, turn180, unit, type LotrPerformer, type Track } from "./lotrMotionKit";

const PERIOD = 9800;

/** Crouch, hop, two fast cleaver hacks, a lean into the thrust, then a cocky shoulder roll. */
const shoulder: Track = [
  [0, 0],
  [1, 0],
  [1.45, -30],
  [1.75, -80],
  [2, -115],
  [2.2, 35],
  [2.32, 30],
  [2.55, -75],
  [2.65, -70],
  [3, -50],
  [3.8, -30],
  [4.3, 10],
  [4.8, 5],
  [5.3, 0],
];
const elbow: Track = [
  [0, 0],
  [1, 0],
  [1.45, -40],
  [2, -55],
  [2.2, -10],
  [2.32, -5],
  [2.55, -50],
  [3, -20],
  [4.3, -10],
  [5.3, 0],
];
/** Blade direction on the stage (0 = up, clockwise): back, over the top, down-left, then up-right. */
const blade: Track = [
  [0, 0],
  [1, 0],
  [1.45, -10],
  [1.75, 85],
  [2, 105],
  [2.1, 150],
  [2.2, 200],
  [2.32, 195],
  [2.4, 150],
  [2.55, 80],
  [2.65, 75],
  [3, 100],
  [3.8, 80],
  [4.3, 25],
  [4.8, 5],
  [5.3, 0],
];
const lean: Track = [
  [0, 0],
  [1, 0],
  [1.45, -5],
  [2, -4],
  [2.2, 6],
  [2.55, -5],
  [3, 7],
  [3.8, 4],
  [4.3, -5],
  [4.8, -1],
  [5.3, 0],
];
const shift: Track = [
  [0, 0],
  [1, 0],
  [1.45, -3],
  [2, 2],
  [2.2, 5],
  [2.55, -3],
  [3, 4],
  [3.9, 2],
  [4.3, -3],
  [5.3, 0],
];
const hop: Track = [
  [0, 0],
  [1.5, 0],
  [1.78, -6],
  [2.05, 0],
  [3.9, 0],
  [4.1, -4],
  [4.3, 0],
  [5.3, 0],
];
const squash: Track = [
  [0, 0],
  [1, 0],
  [1.4, 0.24],
  [1.5, 0.24],
  [1.7, -0.06],
  [1.95, -0.05],
  [2.05, 0.25],
  [2.2, 0.12],
  [2.3, 0.05],
  [2.55, 0.1],
  [2.7, 0],
  [3, 0.12],
  [3.5, 0.1],
  [4.1, 0],
  [4.3, 0.06],
  [5.3, 0],
];
const snarl: Track = [
  [0, 0],
  [1, 0],
  [1.5, 0.9],
  [2.9, 0.9],
  [3.4, 1],
  [4, 0.2],
  [4.4, 0],
];

export const perform: LotrPerformer = (motion, context) => {
  const phase = context.time % PERIOD;
  const s = phase / 1000;
  const energy = 0.6 + context.strength * 0.4;
  const sh = spline(s, shoulder) * energy;
  const el = spline(s, elbow) * energy;
  const lns = spline(s, lean) * energy;
  motion.action = cue(phase, 1000, 4200);
  motion.armAngle = sh - context.gesture * 3;
  motion.forearmAngle = el;
  motion.weaponAngle = turn180(spline(s, blade) * energy - sh - el);
  motion.bodyAngle += lns - context.emphasis;
  motion.bodyX = spline(s, shift) * energy;
  motion.bodyY += spline(s, hop) * energy;
  motion.squash = Math.max(-0.3, Math.min(0.3, spline(s, squash) * energy));
  motion.armY = -motion.action * context.strength - context.emphasis;
  const twitch = Math.sin(context.time / 70) * motion.action * 0.9;
  motion.headAngle += context.thought * 3 + lns * 0.5 + twitch;
  motion.headX += spline(s, shift) * 0.3;
  if (context.working && !context.listening) {
    const open = spline(s, snarl) * (0.7 + context.strength * 0.3);
    motion.mouth = unit(Math.max(motion.mouth, open));
    if (open > 0.3) motion.blink = 0;
  } else {
    motion.mouth = 0;
  }
};
