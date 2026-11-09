import type {
  AssistantJob,
  AssistantProfile,
  AssistantProjectJob,
} from "../../../src/shared/model/host-contracts/assistant";
import type { AssistantPorts } from "../service";

/** The job's linked goal row is missing: it was never written, or was lost. */
export class AssistantGoalMissingError extends Error {
  readonly code = "ASSISTANT_GOAL_MISSING";
  constructor() {
    super("The linked goal is unavailable.");
    this.name = "AssistantGoalMissingError";
  }
}

export const GOAL_RESENT = "The job's goal was missing; it was resubmitted to the planner.";

export function hasErrorCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

/** Re-sends a job whose goal row never got written under the same stable goal id.
 * Only a job that was submitted but has no planner, task or session yet qualifies.
 * Returns true when the goal was resubmitted; a failed attempt is retried next tick. */
export async function resubmitGoal(
  error: unknown,
  job: AssistantProjectJob,
  profile: AssistantProfile,
  ports: Pick<AssistantPorts, "createGoal">,
): Promise<boolean> {
  if (
    !hasErrorCode(error, "ASSISTANT_GOAL_MISSING") ||
    !ports.createGoal ||
    job.dispatchState !== "submitted" ||
    job.status !== "planning" ||
    job.taskIds.length > 0 ||
    job.sessionIds.length > 0 ||
    job.awaitingOwnerRestart ||
    job.pendingTaskDeletion
  )
    return false;
  try {
    await ports.createGoal({ job: job as AssistantJob, profile });
    return true;
  } catch {
    return false;
  }
}
