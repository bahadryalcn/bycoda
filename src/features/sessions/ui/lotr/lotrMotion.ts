import type { CrewActivity } from "../crewMotion";
import type { LotrIdentity } from "./lotrCrew";
import {
  applyLotrLife,
  lotrContext,
  restLotrMotion,
  type LotrMotion,
  type LotrPerformer,
} from "./lotrMotionKit";
import { perform as dwarf } from "./dwarfMotion";
import { perform as gandalf } from "./gandalfMotion";
import { perform as hobbit } from "./hobbitMotion";
import { perform as nazgul } from "./nazgulMotion";
import { perform as orc } from "./orcMotion";
import { perform as sauron } from "./sauronMotion";

const PERFORMERS: Record<LotrIdentity, LotrPerformer> = {
  dwarf,
  gandalf,
  hobbit,
  nazgul,
  orc,
  sauron,
};

/** Pure, seekable acting on the scene's clock; never adds timers or per-frame assets. */
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
  PERFORMERS[character](motion, context);
  return motion;
}
