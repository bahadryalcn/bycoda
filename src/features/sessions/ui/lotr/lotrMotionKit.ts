import type { CrewActivity } from "../crewMotion";
import { restRigPose, type RigPose } from "../characterRig";

export type LotrMotion = RigPose & {
  /** 0-1 strength of the current performance; trails and gaze follow it. */
  action: number;
};

/** Normalized reading of the seat's activity, already offset by seat so neighbours never sync. */
export type LotrContext = {
  /** Milliseconds on the scene clock plus a per-seat offset. */
  time: number;
  working: boolean;
  /** 0 when idle, 0.4-1 while working and standing. */
  strength: number;
  listening: boolean;
  talk: number;
  gesture: number;
  emphasis: number;
  thought: number;
  laugh: number;
  turn: number;
  nod: number;
};

/** A character fills in its own performance on top of the shared breathing, blinking and glances. */
export type LotrPerformer = (motion: LotrMotion, context: LotrContext) => void;

export const restLotrMotion = (): LotrMotion => ({ ...restRigPose(), action: 0 });

const finite = (n = 0) => (Number.isFinite(n) ? n : 0);
export const unit = (n = 0) => Math.max(0, Math.min(1, finite(n)));
export const smooth = (n: number) => n * n * (3 - 2 * n);

/** Prepare, hold, then settle: 0 outside [start, start + duration]. */
export function cue(time: number, start: number, duration: number): number {
  const t = (time - start) / duration;
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.3) return smooth(t / 0.3);
  if (t > 0.65) return 1 - smooth((t - 0.65) / 0.35);
  return 1;
}

/** A short decaying pulse, 1 at `start` and 0 after `length` ms. */
export function pulse(time: number, start: number, length = 260): number {
  const elapsed = time - start;
  return elapsed >= 0 && elapsed < length ? 1 - smooth(elapsed / length) : 0;
}

export type Track = readonly (readonly [seconds: number, value: number])[];

/** Smooth through every key: velocity carries across a pose and only settles at its extremes. */
export function spline(seconds: number, keys: Track): number {
  const last = keys.length - 1;
  if (seconds <= keys[0][0]) return keys[0][1];
  if (seconds >= keys[last][0]) return keys[last][1];
  let i = 1;
  while (keys[i][0] < seconds) i++;
  const slope = (k: number) => {
    if (k <= 0 || k >= last) return 0;
    const [before, value, after] = [keys[k - 1][1], keys[k][1], keys[k + 1][1]];
    if ((value - before) * (after - value) <= 0) return 0;
    return (after - before) / (keys[k + 1][0] - keys[k - 1][0]);
  };
  const [start, from] = keys[i - 1];
  const [end, to] = keys[i];
  const span = end - start;
  const t = (seconds - start) / span;
  const t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * from +
    (t3 - 2 * t2 + t) * span * slope(i - 1) +
    (-2 * t3 + 3 * t2) * to +
    (t3 - t2) * span * slope(i)
  );
}

/** Wrap a joint rotation into one turn; a full revolution leaves the joint where it started. */
export const turn180 = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180 || 0;

export function lotrContext(seat: number, elapsed: number, state?: CrewActivity): LotrContext {
  const working = state?.working === true;
  const listening = state?.listening === true;
  const strength = working ? 0.4 + unit(state.stand) * 0.6 : 0;
  return {
    time: elapsed + Math.max(0, finite(seat)) * 1733,
    working,
    strength,
    listening,
    talk: working && !listening ? unit(state?.talk) : 0,
    gesture: listening ? 0 : unit(state?.gesture) * strength,
    emphasis: working ? unit(state?.emphasis) : 0,
    thought: unit(state?.thought),
    laugh: working ? unit(state?.laugh) : 0,
    turn: Math.max(-1, Math.min(1, finite(state?.turn))),
    nod: Math.max(-2, Math.min(2, finite(state?.nod))),
  };
}

/** Breathing, blinking, glances and speech shared by every character before its performance. */
export function applyLotrLife(
  motion: LotrMotion,
  context: LotrContext,
  seat: number,
  blink?: number,
) {
  const { time } = context;
  const breath = Math.sin(time / 1700);
  const glance = cue(time % 12400, 2200, 2600) - cue(time % 12400, 7700, 2500);
  const blinkPhase = time % (4400 + (Math.abs(finite(seat)) % 3) * 700);
  motion.bodyAngle = Math.sin(time / 3100) * 0.65;
  motion.bodyY = -breath * 0.45;
  motion.headAngle = context.turn * 3 + context.nod * 1.4 + glance * 3;
  motion.headX = context.turn * 1.8 + glance * 0.8;
  motion.headScaleX = 1 - Math.abs(context.turn + glance * 0.2) * 0.025;
  motion.blink = blink === undefined ? (blinkPhase < 170 ? 1 : 0) : unit(blink);
  motion.mouth = context.talk * 0.85;
}
