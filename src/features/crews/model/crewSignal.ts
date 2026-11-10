import type { BadgeTone } from "../../../shared/ui/Badge";
import type { CrewRunView } from "./crewClient";
import { crewHasRunningWork, crewRunAttention, type CrewAttention } from "./crewPresentation";

/** Execution state only; what needs the owner is `CrewAttention`. */
export type CrewExecution = "working" | "paused" | "active";

// Most urgent first: a crew shows the strongest signal across its ongoing work.
const ATTENTION_RANK: CrewAttention[] = ["decision", "review", "blocked"];
const EXECUTION_RANK: CrewExecution[] = ["working", "paused", "active"];

/** A crew's signal: attention (decision, review, blocker) is independent of paused or working. */
export function crewSignal(runs: readonly CrewRunView[]) {
  const attention = runs
    .map(crewRunAttention)
    .filter((value): value is CrewAttention => value !== null)
    .sort((a, b) => ATTENTION_RANK.indexOf(a) - ATTENTION_RANK.indexOf(b))[0];
  const execution = runs
    .map((run): CrewExecution =>
      run.status === "paused" ? "paused" : crewHasRunningWork(run) ? "working" : "active",
    )
    .sort((a, b) => EXECUTION_RANK.indexOf(a) - EXECUTION_RANK.indexOf(b))[0];
  return { attention, execution };
}

/** Tone of the dot or badge that carries a crew's attention or paused/active state. */
export const CREW_ATTENTION_TONE: Record<CrewAttention, BadgeTone> = {
  decision: "warning",
  review: "warning",
  blocked: "danger",
};
export const CREW_EXECUTION_TONE: Record<Exclude<CrewExecution, "working">, BadgeTone> = {
  paused: "neutral",
  active: "neutral",
};
