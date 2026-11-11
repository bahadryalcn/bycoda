import type { HostStore } from "../../store";
import type { HostGoal } from "../../../src/features/tasks/model/hostGoals";
import type { HostTask } from "../../../src/features/tasks/model/hostTasks";
import type {
  AssistantJob,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";
import { assistantJobProjectIds } from "../../../src/shared/model/assistantProjects";
import { assistantActiveHours } from "../../../src/shared/model/assistantPolicy";
import type { AssistantRepository } from "../repository";
import { assertAssistantGoalProjects } from "./assistant-job-scope";

export interface GoalAdmissionDeps {
  store: HostStore;
  repository: AssistantRepository;
  profile(): Promise<AssistantProfile>;
  now(): number;
  /** Whether today's token budget is spent. Reporting mode (80%) restricts the
   * supervisor and new jobs only; dispatched children continue until exhaustion. */
  budgetExhausted(profile: AssistantProfile): Promise<boolean>;
  paused(): Promise<boolean>;
  /** Shutdown, emergency stop or a pending stop of this job. */
  stopping(jobId: string): boolean;
}

/** Read-only final admission; this restricts canonical assistant work and grants nothing. */
export async function autonomousJobAllowed(
  deps: GoalAdmissionDeps,
  goalId: string,
): Promise<boolean> {
  const { store, repository } = deps;
  return store.db.scope(async () => {
    if (!goalId.startsWith("assistant-"))
      return !(await store.db
        .prepare(
          "SELECT 1 FROM assistant_jobs WHERE deleted_at IS NULL AND json_extract(value,'$.goalId')=? LIMIT 1",
        )
        .get(goalId));
    const id = goalId.slice("assistant-".length),
      job = await repository.get<AssistantJob>("jobs", id);
    if (
      !job ||
      job.kind === "quick" ||
      (job.goalId !== undefined && job.goalId !== goalId) ||
      (job.goalId === undefined &&
        (job.status !== "planning" || job.dispatchState !== "unknown")) ||
      ["queued", "done", "failed", "paused", "cancelled"].includes(job.status) ||
      job.pendingTaskDeletion ||
      job.awaitingOwnerRestart
    )
      return false;
    try {
      const row = await store.db.prepare("SELECT value FROM goals WHERE id=?").get(goalId);
      if (!row) return false;
      const goal = JSON.parse(row.value) as HostGoal;
      assertAssistantGoalProjects(job, goal);
      if (goal.status === "cancelled" || goal.awaitingOwnerRestart) return false;
      const rows = await store.db
          .prepare("SELECT value FROM tasks WHERE json_extract(value,'$.goalId')=?")
          .all(goalId),
        tasks = rows.map((row) => JSON.parse(row.value) as HostTask);
      if (
        tasks.length !== goal.taskIds.length ||
        new Set(goal.taskIds).size !== goal.taskIds.length ||
        tasks.some(
          (task) =>
            !goal.taskIds.includes(task.id) ||
            !assistantJobProjectIds(job).includes(task.projectId),
        )
      )
        return false;
      if (
        await store.db
          .prepare(
            "SELECT goal_id FROM task_goal_holds WHERE goal_id=? UNION SELECT goal_id FROM task_goal_reason_holds WHERE goal_id=? AND reason='assistant-budget' UNION SELECT goal_id FROM task_goal_deletion_holds WHERE goal_id=? LIMIT 1",
          )
          .get(goalId, goalId, goalId)
      )
        return false;
    } catch {
      return false;
    }
    const profile = await deps.profile();
    if (
      !profile.enabled ||
      !profile.setupComplete ||
      profile.autonomy === "report" ||
      !assistantActiveHours(profile, deps.now()) ||
      (await deps.budgetExhausted(profile)) ||
      (await deps.paused())
    )
      return false;
    return !deps.stopping(job.id);
  });
}
