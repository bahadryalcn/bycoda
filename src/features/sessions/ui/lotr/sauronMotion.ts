import { spline, cue, pulse, turn180, unit, type LotrPerformer, type Track } from "./lotrMotionKit";

const PERIOD = 11000;

// Seconds -> degrees. Slow, heavy wind-up; fast smash at ~2.75 s; weighty, slow recovery.
const SHOULDER: Track = [
  [0, 0],
  [1, 0],
  [2.1, -128],
  [2.65, -142],
  [2.82, -40],
  [2.98, -30],
  [3.25, -24],
  [3.9, -24],
  [4.8, -10],
  [5.6, 0],
];
const ELBOW: Track = [
  [0, 0],
  [1, 0],
  [2.1, -52],
  [2.65, -64],
  [2.82, -20],
  [2.98, -30],
  [3.25, -26],
  [3.9, -26],
  [4.8, -8],
  [5.6, 0],
];
// Absolute stage direction of the mace (0 = upright, 180 = head on the ground).
const MACE: Track = [
  [0, 0],
  [1, 0],
  [2.1, 96],
  [2.65, 118],
  [2.82, 150],
  [2.98, 165],
  [3.25, 160],
  [3.9, 158],
  [4.8, 90],
  [5.6, 0],
];
const LEAN: Track = [
  [0, 0],
  [1, 0],
  [2.1, -4],
  [2.65, -6],
  [2.9, 6],
  [3.4, 5],
  [4.8, 1],
  [5.6, 0],
];
const SHIFT: Track = [
  [0, 0],
  [1, 0],
  [2.65, -3],
  [2.95, 3],
  [3.6, 2],
  [5.6, 0],
];
const CROUCH: Track = [
  [0, 0],
  [2.4, 0],
  [2.65, -1],
  [2.95, 3.5],
  [3.5, 3],
  [4.8, 1],
  [5.6, 0],
];

export const perform: LotrPerformer = (motion, context) => {
  const phase = context.time % PERIOD;
  const s = phase / 1000;
  const energy = 0.85 + context.strength * 0.15;
  motion.blink = motion.mouth = 0;
  motion.action = cue(phase, 800, 4900);

  const shoulder = spline(s, SHOULDER) * energy;
  const elbow = spline(s, ELBOW) * energy;
  motion.armAngle = shoulder - context.gesture * 3;
  motion.forearmAngle = elbow;
  motion.weaponAngle = turn180(spline(s, MACE) - shoulder - elbow);

  const lean = spline(s, LEAN);
  motion.bodyAngle += lean;
  motion.bodyX = spline(s, SHIFT);
  motion.bodyY += spline(s, CROUCH);
  motion.headAngle += lean * 0.5 + context.thought * 2;
  motion.headX += motion.bodyX * 0.3;
  // The off hand clenches and drifts back for balance.
  motion.offArmAngle = -motion.action * 6 + lean * 1.5;
  motion.offForearmAngle = motion.action * 8;
  motion.capeAngle = -lean * 1.2 + pulse(phase, 2850, 900) * -6;

  // Impact: ground shaking squash, then a heavy settle.
  const hit = pulse(phase, 2900, 700);
  motion.squash = Math.min(0.3, hit * 0.2 + (s > 2.6 && s < 2.9 ? 0.03 : 0));

  // Eye slits smoulder, brighten while the mace rises, and flare on the strike.
  const smoulder = 0.18 + 0.1 * Math.sin(phase / 420);
  const rise = cue(phase, 1000, 2600) * 0.5;
  motion.glow = unit(smoulder + rise * (0.4 + 0.6 * context.strength) + pulse(phase, 2850, 1100));
};
