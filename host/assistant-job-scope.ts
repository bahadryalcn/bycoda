import type { HostStore } from "./store";
import type { AssistantJob } from "../src/shared/model/host-contracts/assistant";
import type { HostGoal } from "../src/features/tasks/model/hostGoals";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import {
  assistantJobProjectIds,
  sameAssistantProjectSet,
} from "../src/shared/model/assistantProjects";

export class AssistantJobScopeError extends Error {
  readonly code = "ASSISTANT_JOB_SCOPE";
}

export function assertAssistantGoalProjects(
  job: Pick<AssistantJob, "kind" | "id" | "projectId" | "projectIds">,
  goal: Pick<HostGoal, "id" | "projectIds" | "leadProjectId">,
) {
  if (job.kind === "quick" || job.projectId === null)
    throw new AssistantJobScopeError(
      "Global quick jobs cannot own a goal, task or managed session.",
    );
  if (
    goal.id !== `assistant-${job.id}` ||
    goal.leadProjectId !== job.projectId ||
    !sameAssistantProjectSet(goal.projectIds, assistantJobProjectIds(job))
  )
    throw new AssistantJobScopeError(
      "The canonical goal no longer matches this assistant job's complete project scope and lead.",
    );
}
export function assistantGoalSessionIds(
  goal: HostGoal,
  children: HostTask[],
  known: string[] = [],
) {
  return [
    ...new Set(
      [
        ...known,
        goal.plannerSessionId,
        goal.finalAcceptance?.sessionId,
        ...(goal.finalAcceptanceHistory ?? []).map((review) => review.sessionId),
        ...children.flatMap(assistantTaskSessionIds),
      ].filter((id): id is string => !!id),
    ),
  ];
}
function assistantTaskSessionIds(task: HostTask) {
  return [
    task.sessionId,
    task.reviewer?.sessionId,
    task.verification?.review?.sessionId,
    task.blockedTakeover?.previousSessionId,
    ...(task.attemptHistory ?? []).flatMap((attempt) => [
      attempt.workerSessionId,
      attempt.reviewerSessionId,
    ]),
  ].filter((id): id is string => !!id);
}
/** A saved project/session array is provenance, not an independent run grant. */
export async function assistantJobSessionBelongs(
  store: HostStore,
  job: AssistantJob,
  sessionId: string,
  projectId: string,
): Promise<boolean> {
  if (job.kind === "quick") return false;
  if (
    job.goalId !== `assistant-${job.id}` ||
    !job.sessionIds.includes(sessionId) ||
    !assistantJobProjectIds(job).includes(projectId)
  )
    return false;
  const tables = await store.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('goals','tasks')")
    .all();
  if (!tables.some((row) => row.name === "goals")) return false;
  const row = await store.db.prepare("SELECT value FROM goals WHERE id=?").get(job.goalId);
  if (!row) return false;
  const goal = JSON.parse(row.value) as HostGoal;
  assertAssistantGoalProjects(job, goal);
  const children: HostTask[] = [];
  if (tables.some((row) => row.name === "tasks"))
    for (const taskRow of await store.db
      .prepare("SELECT value FROM tasks WHERE id IN (SELECT value FROM json_each(?))")
      .all(JSON.stringify(goal.taskIds))) {
      const task = JSON.parse(taskRow.value) as HostTask;
      if (
        task.goalId === goal.id &&
        goal.taskIds.includes(task.id) &&
        assistantJobProjectIds(job).includes(task.projectId)
      )
        children.push(task);
    }
  const expectedProjects = new Set<string>();
  if (
    [
      goal.plannerSessionId,
      goal.finalAcceptance?.sessionId,
      ...(goal.finalAcceptanceHistory ?? []).map((review) => review.sessionId),
    ].includes(sessionId)
  )
    expectedProjects.add(goal.leadProjectId);
  for (const task of children)
    if (assistantTaskSessionIds(task).includes(sessionId)) expectedProjects.add(task.projectId);
  return expectedProjects.size === 1 && expectedProjects.has(projectId);
}
