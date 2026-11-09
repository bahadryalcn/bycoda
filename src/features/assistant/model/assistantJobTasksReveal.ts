import type { AssistantJob } from "../../../shared/model/host-contracts/assistant";
import {
  assistantJobProjectIds,
  sameAssistantProjectSet,
} from "../../../shared/model/assistantProjects";
import type { AssistantJobTasksTarget } from "./assistantJobDeletion";

/** Reviewing retained tasks grants neither plan approval nor execution authority. */
export function assistantJobTasksGoal(
  target: AssistantJobTasksTarget,
  actualEnvironmentId: string,
  job: AssistantJob | undefined,
  goals: readonly { id: string; projectIds: string[]; leadProjectId: string }[],
  projects: readonly { id: string; path: string }[],
  canOpenProject: (path: string) => boolean,
) {
  const goal = goals.find((row) => row.id === target.goalId);
  const participants = job && job.kind !== "quick" ? assistantJobProjectIds(job) : undefined;
  if (
    !target.environmentId ||
    actualEnvironmentId !== target.environmentId ||
    !job ||
    job.kind === "quick" ||
    job.id !== target.jobId ||
    job.goalId !== target.goalId ||
    job.goalId !== `assistant-${job.id}` ||
    job.projectId !== target.projectId ||
    !goal ||
    goal.leadProjectId !== target.projectId ||
    !participants?.length ||
    !sameAssistantProjectSet(participants, target.projectIds) ||
    !sameAssistantProjectSet(participants, goal.projectIds) ||
    !participants.every((id) => {
      const project = projects.find((row) => row.id === id);
      return !!project && canOpenProject(project.path);
    })
  )
    throw new Error("The linked job tasks changed or their projects are unavailable.");
  return goal;
}
