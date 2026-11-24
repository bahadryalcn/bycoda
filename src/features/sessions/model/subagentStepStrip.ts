import type { StepStripCell } from "../../../shared/ui/StepStrip";
import type { AgentStep } from "./session";
import { isFailedStatus } from "./transcriptActivity";

/** Steps a run's row can draw; the counts still cover the whole run. */
export const SUBAGENT_STRIP_CELLS = 20;

export type SubagentStepStrip = {
  cells: StepStripCell[];
  total: number;
  failed: number;
};

/** A run's tool calls as strip cells. `working` marks the newest call as the current one. */
export function subagentStepStrip(
  steps: readonly AgentStep[],
  working: boolean,
): SubagentStepStrip {
  const tools = steps.filter((step) => step.kind === "tool");
  const failed = tools.filter((step) => isFailedStatus(step.status)).length;
  const cells = tools.slice(-SUBAGENT_STRIP_CELLS).map((step, index, recent): StepStripCell => {
    if (isFailedStatus(step.status)) return "failed";
    return working && index === recent.length - 1 ? "active" : "done";
  });
  return { cells, total: tools.length, failed };
}
