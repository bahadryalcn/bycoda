import type { CrewActivity } from "../crewMotion";
import type { LotrIdentity } from "./lotrCrew";
import {
  applyLotrLife,
  lotrContext,
  restLotrMotion,
  turn180,
  unit,
  type LotrMotion,
  type LotrPerformer,
} from "./lotrMotionKit";
import { perform as dwarf } from "./dwarfMotion";
import { perform as elf } from "./elfMotion";
import { perform as gandalf } from "./gandalfMotion";
import { perform as hobbit } from "./hobbitMotion";
import { perform as nazgul } from "./nazgulMotion";
import { perform as orc } from "./orcMotion";
import { perform as sauron } from "./sauronMotion";

const PERFORMERS: Record<LotrIdentity, LotrPerformer> = {
  dwarf,
  elf,
  gandalf,
  hobbit,
  nazgul,
  orc,
  sauron,
};

/** Weapons may be mid-twirl; blend them along the short way round. */
const WRAPPED = new Set<keyof LotrMotion>(["weaponAngle", "propAngle"]);

/**
 * Pure, seekable acting on the scene's clock; never adds timers or per-frame assets.
 * Only working seats perform. Idle seats keep the shared breathing, blinking and glances,
 * and the scene's 0-1 `stand` ramp eases a seat into and out of its performance.
 */
export function lotrMotionAt(
  character: LotrIdentity,
  seat: number,
  elapsed: number,
  state?: CrewActivity,
  animate = elapsed > 0,
): LotrMotion {
  const motion = restLotrMotion();
  if (!animate || !Number.isFinite(elapsed) || elapsed <= 0) return motion;
  const context = lotrContext(seat, elapsed, state);
  applyLotrLife(motion, context, seat, state?.blink);
  const weight = unit(state?.stand);
  if (weight <= 0) return motion;
  const performed = { ...motion };
  PERFORMERS[character](performed, context);
  if (weight >= 1) return performed;
  for (const key of Object.keys(motion) as (keyof LotrMotion)[]) {
    if (key === "blink") continue;
    const change = performed[key] - motion[key];
    motion[key] += (WRAPPED.has(key) ? turn180(change) : change) * weight;
  }
  if (weight >= 0.5) motion.blink = performed.blink;
  return motion;
}
