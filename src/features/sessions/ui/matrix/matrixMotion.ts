import type { CrewActivity } from "../crewMotion";
import {
  applyLotrLife,
  lotrContext,
  restLotrMotion,
  turn180,
  unit,
  type LotrMotion,
  type LotrPerformer,
} from "../lotr/lotrMotionKit";
import type { MatrixIdentity } from "./matrixCrew";
import { perform as agentSmith } from "./agentSmithMotion";
import { perform as morpheus } from "./morpheusMotion";
import { perform as neo } from "./neoMotion";

/** The Matrix crew acts on the same rig and motion kit as the Lord of the Rings crew. */
export type MatrixMotion = LotrMotion;
export type MatrixPerformer = LotrPerformer;

const PERFORMERS: Record<MatrixIdentity, MatrixPerformer> = {
  "agent-smith": agentSmith,
  morpheus,
  neo,
};

/** Hands and props may be mid-turn; blend them along the short way round. */
const WRAPPED = new Set<keyof MatrixMotion>(["weaponAngle", "propAngle"]);

/**
 * Pure, seekable acting on the scene's clock; never adds timers or per-frame assets.
 * Only working seats perform. Idle seats keep the shared breathing, blinking and glances,
 * and the scene's 0-1 `stand` ramp eases a seat into and out of its performance.
 */
export function matrixMotionAt(
  character: MatrixIdentity,
  seat: number,
  elapsed: number,
  state?: CrewActivity,
  animate = elapsed > 0,
): MatrixMotion {
  const motion = restLotrMotion();
  if (!animate || !Number.isFinite(elapsed) || elapsed <= 0) return motion;
  const context = lotrContext(seat, elapsed, state);
  applyLotrLife(motion, context, seat, state?.blink);
  // Smiths never blink at random: the bare eyes only show while the glasses are off.
  if (character === "agent-smith") motion.blink = 0;
  const weight = unit(state?.stand);
  if (weight <= 0) return motion;
  const performed = { ...motion };
  PERFORMERS[character](performed, context);
  if (weight >= 1) return performed;
  for (const key of Object.keys(motion) as (keyof MatrixMotion)[]) {
    if (key === "blink") continue;
    const change = performed[key] - motion[key];
    motion[key] += (WRAPPED.has(key) ? turn180(change) : change) * weight;
  }
  if (weight >= 0.5) motion.blink = performed.blink;
  return motion;
}
