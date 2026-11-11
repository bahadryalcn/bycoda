import type { HostStore } from "../../store";
import type {
  AssistantJob,
  AssistantProjectJob,
} from "../../../src/shared/model/host-contracts/assistant";
import type { HostGoal } from "../../../src/features/tasks/model/hostGoals";
import type { HostTask } from "../../../src/features/tasks/model/hostTasks";
import {
  assistantJobProjectIds,
  sameAssistantProjectSet,
} from "../../../src/shared/model/assistantProjects";

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
/**
 * The projects in which the job's canonical goal and its current tasks reference each session.
 * Undefined when the goal is not stored. Throws when the goal no longer matches the job.
 */
async function assistantJobSessionProjects(
  store: HostStore,
  job: AssistantProjectJob,
): Promise<Map<string, Set<string>> | undefined> {
  const tables = await store.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('goals','tasks')")
    .all();
  if (!job.goalId || !tables.some((row) => row.name === "goals")) return undefined;
  const row = await store.db.prepare("SELECT value FROM goals WHERE id=?").get(job.goalId);
  if (!row) return undefined;
  const goal = JSON.parse(row.value) as HostGoal;
  assertAssistantGoalProjects(job, goal);
  const projects = new Map<string, Set<string>>();
  const reference = (sessionId: string | undefined, projectId: string) => {
    if (sessionId) projects.set(sessionId, (projects.get(sessionId) ?? new Set()).add(projectId));
  };
  for (const sessionId of [
    goal.plannerSessionId,
    goal.finalAcceptance?.sessionId,
    ...(goal.finalAcceptanceHistory ?? []).map((review) => review.sessionId),
  ])
    reference(sessionId, goal.leadProjectId);
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
        for (const sessionId of assistantTaskSessionIds(task)) reference(sessionId, task.projectId);
    }
  return projects;
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
  const expectedProjects = (await assistantJobSessionProjects(store, job))?.get(sessionId);
  return expectedProjects?.size === 1 && expectedProjects.has(projectId);
}
/**
 * The saved session ids the job's canonical goal or one of its current tasks still references.
 * `job.sessionIds` also keeps ids of removed tasks and replaced attempts so their usage stays
 * counted; those are provenance only and are left out here. Membership of one session in one
 * project is still decided by `assistantJobSessionBelongs`.
 */
export async function assistantJobCurrentSessionIds(
  store: HostStore,
  job: AssistantJob,
): Promise<string[]> {
  if (job.kind === "quick" || job.goalId !== `assistant-${job.id}`) return [];
  const projects = await assistantJobSessionProjects(store, job);
  return job.sessionIds.filter((id) => projects?.has(id));
}
