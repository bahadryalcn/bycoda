import type { CrewActivity } from "./crewMotion";
import type { STAR_WARS_ARTWORK } from "./starWarsCrew";

export type StarWarsIdentity = (typeof STAR_WARS_ARTWORK)[number]["id"];
export type StarWarsMotion = {
  bodyAngle: number;
  bodyX: number;
  bodyY: number;
  headAngle: number;
  headX: number;
  headScaleX: number;
  armAngle: number;
  armY: number;
  weaponAngle: number;
  forceAngle: number;
  jedi: number;
  recoil: number;
  action: number;
  blink: number;
  mouth: number;
  panel: number;
};

const rest = (): StarWarsMotion => ({
  bodyAngle: 0,
  bodyX: 0,
  bodyY: 0,
  headAngle: 0,
  headX: 0,
  headScaleX: 1,
  armAngle: 0,
  armY: 0,
  weaponAngle: 0,
  forceAngle: 0,
  jedi: 0,
  recoil: 0,
  action: 0,
  blink: 0,
  mouth: 0,
  panel: 0,
});

const finite = (n = 0) => (Number.isFinite(n) ? n : 0);
const unit = (n = 0) => Math.max(0, Math.min(1, finite(n)));
const smooth = (n: number) => n * n * (3 - 2 * n);

/** Prepare, hold, then settle. Each short performance leaves a quiet interval. */
function cue(time: number, start: number, duration: number): number {
  const t = (time - start) / duration;
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.3) return smooth(t / 0.3);
  if (t > 0.65) return 1 - smooth((t - 0.65) / 0.35);
  return 1;
}

type Track = readonly (readonly [seconds: number, value: number])[];
/** Authored anticipation, strike and recovery poses, interpolated without a physics clock. */
function track(seconds: number, keys: Track): number {
  for (let i = 1; i < keys.length; i++) {
    const [end, value] = keys[i];
    if (seconds > end) continue;
    const [start, previous] = keys[i - 1];
    return previous + (value - previous) * smooth(Math.max(0, (seconds - start) / (end - start)));
  }
  return keys[keys.length - 1][1];
}

const saberPerformances = {
  "obi-wan": {
    period: 11200,
    // Defensive cross-body parry, then a deliberate counter-cut.
    weapon: [
      [0, 0],
      [1.1, 0],
      [1.9, -58],
      [2.5, -58],
      [3.1, 32],
      [3.48, -92],
      [4, -76],
      [5, 0],
    ],
    arm: [
      [0, 0],
      [1.1, 0],
      [1.9, 15],
      [2.5, 15],
      [3.1, -17],
      [3.48, 13],
      [4, 10],
      [5, 0],
    ],
    lean: [
      [0, 0],
      [1.1, 0],
      [1.9, 2],
      [3.1, -3],
      [3.48, 5],
      [4, 3],
      [5, 0],
    ],
  },
  luke: {
    period: 9200,
    // Fast diagonal cut and a second return sweep.
    weapon: [
      [0, 0],
      [1, 0],
      [1.65, 30],
      [1.96, -98],
      [2.25, -85],
      [2.65, 24],
      [3.02, -78],
      [3.5, -62],
      [4.35, 0],
    ],
    arm: [
      [0, 0],
      [1, 0],
      [1.65, -20],
      [1.96, 13],
      [2.25, 10],
      [2.65, -16],
      [3.02, 14],
      [3.5, 7],
      [4.35, 0],
    ],
    lean: [
      [0, 0],
      [1, 0],
      [1.65, -4],
      [1.96, 6],
      [2.65, -3],
      [3.02, 5],
      [4.35, 0],
    ],
  },
  "darth-vader": {
    period: 12800,
    // A slower, weightier wind-up, single slash and held guard.
    weapon: [
      [0, 0],
      [1.5, 0],
      [2.65, 28],
      [3.15, 28],
      [3.65, -86],
      [4.5, -86],
      [5.8, 0],
    ],
    arm: [
      [0, 0],
      [1.5, 0],
      [2.65, -16],
      [3.15, -16],
      [3.65, 14],
      [4.5, 14],
      [5.8, 0],
    ],
    lean: [
      [0, 0],
      [1.5, 0],
      [2.65, -2],
      [3.15, -2],
      [3.65, 4],
      [4.5, 4],
      [5.8, 0],
    ],
  },
} as const;

const yodaJedi: Track = [
  [0, 0],
  [0.9, 0],
  [1.1, 1],
  [4.7, 1],
  [5, 0],
];
const yodaForce: Track = [
  [0, 0],
  [1.1, 0],
  [1.6, 30],
  [2, 30],
  [2.4, 6],
  [3.6, 6],
  [4.1, 36],
  [4.5, 36],
  [4.85, 0],
];
const yodaSaber: Track = [
  [0, 0],
  [1.1, 0],
  [1.75, 25],
  [2.25, 35],
  [2.6, -100],
  [2.95, 22],
  [3.3, -88],
  [3.8, -55],
  [4.65, 0],
];
const yodaArm: Track = [
  [0, 0],
  [1.1, 0],
  [1.75, -20],
  [2.25, -22],
  [2.6, 13],
  [2.95, -18],
  [3.3, 16],
  [3.8, 8],
  [4.65, 0],
];
const yodaLeap: Track = [
  [0, 0],
  [1.95, 0],
  [2.2, 2],
  [2.48, -25],
  [2.8, -28],
  [3.2, -16],
  [3.5, 2.5],
  [3.85, 0],
];
const yodaLean: Track = [
  [0, 0],
  [1.95, 0],
  [2.25, -6],
  [2.6, 9],
  [2.95, -7],
  [3.3, 7],
  [3.85, 0],
];

function shot(time: number, start: number): number {
  const elapsed = time - start;
  return elapsed >= 0 && elapsed < 260 ? 1 - smooth(elapsed / 260) : 0;
}

/** Pure, seekable acting on the scene's clock; never adds timers or per-frame assets. */
export function starWarsMotionAt(
  character: StarWarsIdentity,
  seat: number,
  elapsed: number,
  state?: CrewActivity,
  animate = elapsed > 0,
): StarWarsMotion {
  const motion = rest();
  if (!animate || !Number.isFinite(elapsed) || elapsed <= 0) return motion;
  const time = elapsed + Math.max(0, finite(seat)) * 1733;
  const working = state?.working === true;
  const strength = working ? 0.4 + unit(state.stand) * 0.6 : 0;
  const listening = state?.listening === true;
  const turn = Math.max(-1, Math.min(1, finite(state?.turn)));
  const nod = Math.max(-2, Math.min(2, finite(state?.nod)));
  const emphasis = working ? unit(state?.emphasis) : 0;
  const gesture = listening ? 0 : unit(state?.gesture) * strength;
  const talk = working && !listening ? unit(state?.talk) : 0;
  const thought = unit(state?.thought);
  const laugh = working ? unit(state?.laugh) : 0;
  const breath = Math.sin(time / 1700);
  const phrase = time % 12400;
  const glance = cue(phrase, 2200, 2600) - cue(phrase, 7700, 2500);
  const blinkPhase = time % (4400 + (seat % 3) * 700);

  motion.bodyAngle = Math.sin(time / 3100) * 0.65;
  motion.bodyY = -breath * 0.45;
  motion.headAngle = turn * 3 + nod * 1.4 + glance * 3;
  motion.headX = turn * 1.8 + glance * 0.8;
  motion.headScaleX = 1 - Math.abs(turn + glance * 0.2) * 0.025;
  motion.blink = state?.blink === undefined ? (blinkPhase < 170 ? 1 : 0) : unit(state.blink);
  motion.mouth = talk * 0.85;

  switch (character) {
    case "obi-wan":
    case "luke":
    case "darth-vader": {
      const performance = saberPerformances[character];
      const phase = time % performance.period;
      const seconds = phase / 1000;
      const energy = 0.88 + strength * 0.12;
      motion.action = cue(phase, 800, 5500);
      motion.weaponAngle = track(seconds, performance.weapon) * energy;
      motion.armAngle = track(seconds, performance.arm) * energy - gesture * 3;
      motion.bodyAngle += track(seconds, performance.lean) * energy - emphasis;
      motion.bodyX = track(seconds, performance.lean) * 0.75;
      motion.armY = -motion.action * (1 + strength) - emphasis;
      motion.headAngle += thought * 3 - motion.action * 2;
      if (character === "darth-vader") {
        motion.headAngle = turn * 3 + glance * 5 - motion.action * 2;
        motion.headX = turn * 1.5 + glance * 1.6;
        motion.panel = 0.35 + (Math.sin(time / 750) + 1) * 0.3;
        motion.blink = motion.mouth = 0;
      }
      break;
    }
    case "yoda": {
      const phase = time % 11800;
      const seconds = phase / 1000;
      motion.jedi = track(seconds, yodaJedi);
      motion.action = motion.jedi;
      motion.forceAngle = track(seconds, yodaForce);
      motion.weaponAngle = track(seconds, yodaSaber);
      motion.armAngle = track(seconds, yodaArm) - gesture * 3;
      motion.armY = -motion.jedi * (1.5 + strength);
      motion.bodyY += track(seconds, yodaLeap);
      motion.bodyAngle += track(seconds, yodaLean);
      motion.bodyX = track(seconds, yodaLean) * 0.65;
      motion.headAngle += thought * 4 - motion.jedi * 3;
      motion.headX += glance;
      motion.mouth = talk * 0.65;
      break;
    }
    case "leia": {
      const phase = time % 10200;
      const aim = cue(phase, 900, 4500);
      motion.action = aim;
      motion.recoil = Math.max(shot(phase, 2550), shot(phase, 3200), shot(phase, 3950));
      // Raise the blaster, aim outward, fire a short burst, then lower the wrist.
      motion.armAngle = -aim * (32 + strength * 3) - gesture * 3 + motion.recoil * 4;
      motion.weaponAngle = aim * 116 - motion.recoil * 7;
      motion.bodyX = -motion.recoil * 2;
      motion.bodyAngle -= aim * 1.5 + motion.recoil;
      motion.headAngle += aim * 3 + thought * 3;
      motion.headX += aim * 2;
      break;
    }
    case "chewbacca": {
      const phase = time % 11700;
      const aim = cue(phase, 1200, 4500);
      motion.action = aim;
      motion.recoil = Math.max(shot(phase, 2900), shot(phase, 3850));
      const roar = Math.max(cue(time % 14800, 6500, 1700) * (working ? 0.65 : 0.35), emphasis);
      motion.armAngle = aim * (14 + strength * 3) - motion.recoil * 6 - gesture * 2;
      motion.weaponAngle = -aim * 17 + motion.recoil * 3;
      motion.armY = aim * 3;
      motion.bodyX = aim * -2 + motion.recoil * 3;
      motion.headAngle += -roar * 5 - aim * 3 + laugh * Math.sin(time / 180) * 2;
      motion.headX -= aim * 2;
      motion.bodyAngle += aim * -2 + motion.recoil * 2 + roar * Math.sin(time / 135) * 0.7;
      motion.mouth = Math.max(talk, roar);
      break;
    }
    case "r2-d2": {
      // Dome-only scan and a tiny chassis rock; no humanoid expressions.
      const scan = Math.sin(time / 1500) * (0.6 + strength * 0.4);
      motion.headX = scan * 4;
      motion.headScaleX = 1 - Math.abs(scan) * 0.07;
      motion.headAngle = scan * 1.2;
      motion.bodyAngle = Math.sin(time / 1200) * (working ? 1.1 : 0.45);
      motion.bodyY = 0;
      motion.bodyX = scan * 1.5;
      motion.panel = 0.25 + (Math.sin(time / 310) + 1) * 0.375;
      motion.blink = motion.mouth = 0;
      break;
    }
  }
  return motion;
}
