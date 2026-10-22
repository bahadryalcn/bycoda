import { cue, spline, turn180, unit, type LotrPerformer, type Track } from "./lotrMotionKit";

const PERIOD = 11000;

/** Slow menacing raise, a held breath at the top, a fast overhead cut, then a drift back. */
const shoulder: Track = [
  [0, 0],
  [1, 0],
  [1.9, -96],
  [2.7, -148],
  [3.0, -142],
  [3.22, -60],
  [3.4, 8],
  [3.65, 14],
  [4.4, 8],
  [5.3, 0],
];
const elbow: Track = [
  [0, 0],
  [1, 0],
  [1.9, -58],
  [2.7, -44],
  [3.0, -48],
  [3.22, -14],
  [3.4, 34],
  [3.65, 40],
  [4.4, 22],
  [5.3, 0],
];
/** Blade direction in the stage; the recovery keeps turning counter-clockwise, outside the body. */
const blade: Track = [
  [0, 0],
  [1, 0],
  [1.3, -22],
  [1.9, -52],
  [2.7, -68],
  [3.0, -74],
  [3.22, -150],
  [3.4, -214],
  [3.65, -222],
  [4.4, -290],
  [5.3, -352],
  [5.6, -360],
];
const lean: Track = [
  [0, 0],
  [1, 0],
  [2.7, -4],
  [3.0, -5],
  [3.4, 6],
  [3.8, 5],
  [5.3, 0],
];
const drift: Track = [
  [0, 0],
  [1, 0],
  [2.9, -2],
  [3.5, 3.5],
  [4.4, 2],
  [5.4, 0],
];
const billow: Track = [
  [0, 0],
  [1, 0],
  [2.0, 9],
  [3.0, 12],
  [3.35, -16],
  [3.8, -20],
  [4.6, 6],
  [5.5, 0],
];
const stare: Track = [
  [0, 0],
  [1.2, 0.1],
  [2.7, 0.55],
  [3.0, 1],
  [3.5, 1],
  [4.3, 0.35],
  [5.2, 0],
];
const hood: Track = [
  [0, 0],
  [1, 0],
  [2.7, 5],
  [3.0, -4],
  [3.5, 11],
  [4.4, 7],
  [5.3, 0],
];

export const perform: LotrPerformer = (motion, context) => {
  const { time, strength, gesture, emphasis } = context;
  const phase = time % PERIOD;
  const s = phase / 1000;
  const energy = 0.9 + strength * 0.1;
  const action = cue(phase, 1000, 4500);
  const sh = spline(s, shoulder) * energy;
  const el = spline(s, elbow) * energy;
  motion.action = action;
  motion.armAngle = sh - gesture * 3;
  motion.forearmAngle = el;
  motion.weaponAngle = turn180(spline(s, blade) - sh - el);
  // Ghostly hover: a slow bob that deepens while performing, never touching the ground.
  const float = Math.sin(time / 820) * (1.2 + action * 1.8);
  motion.bodyY += -3 - action * 2 - float;
  motion.bodyAngle += spline(s, lean) - emphasis;
  motion.bodyX = spline(s, drift) + Math.sin(time / 2300) * 1.2;
  motion.capeAngle =
    Math.sin(time / 640) * (2.5 + action * 2) + spline(s, billow) * (0.6 + strength * 0.4);
  motion.headAngle += spline(s, hood) * 0.9;
  motion.headX += spline(s, drift) * 0.3;
  // Hooded void: no lids and no mouth; the eyes only brighten and flare.
  motion.blink = motion.mouth = 0;
  motion.glow = unit(0.22 + Math.sin(time / 1300) * 0.08 + spline(s, stare) * 0.78 * energy);
};
