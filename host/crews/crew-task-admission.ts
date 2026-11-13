import type { HostTasks } from "../tasks/tasks";
import type { HostStore } from "../store";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import { crewScopesOverlap } from "../../src/features/crews/model/crew";
import { readCrewRun } from "./crew-scheduler-projection";

/** Direct checkout writers honor active Crew leases; isolated tasks remain independent. */
export async function crewTaskCanStart(
  store: HostStore,
  tasks: Pick<HostTasks, "list">,
  task: HostTask,
): Promise<boolean> {
  if (task.crewDefinitionId) return true;
  if (!task.crewRunId)
    return (
      task.isolate !== false ||
      !(await tasks.list(task.projectId)).some(
        (other) =>
          other.id !== task.id &&
          !!other.crewRunId &&
          !other.crewDefinitionId &&
          other.isolate === false &&
          (other.status === "running" || other.status === "verifying") &&
          crewScopesOverlap(["."], other.crewScopes ?? ["."]),
      )
    );
  const run = await readCrewRun(store, task.crewRunId);
  if (!run || run.status !== "active") return false;
  const tasksInProject = await tasks.list(run.projectId);
  return (
    !tasksInProject.some(
      (other) =>
        other.id !== task.id &&
        !other.crewDefinitionId &&
        other.isolate === false &&
        (other.status === "running" || other.status === "verifying") &&
        crewScopesOverlap(task.crewScopes ?? ["."], other.crewScopes ?? ["."]),
    ) &&
    tasksInProject.filter(
      (other) =>
        other.crewRunId === run.id && (other.status === "running" || other.status === "verifying"),
    ).length < run.definition.policy.maxParallel
  );
}

/** A coordinator retains its canonical Task's live parent authority on every turn. */
export async function crewTaskAdmitted(
  tasks: Pick<HostTasks, "get" | "assistantTaskAdmission">,
  run: { id: string; projectId: string; sourceTaskId?: string },
): Promise<boolean> {
  if (!run.sourceTaskId || !tasks.assistantTaskAdmission) return true;
  const task = await tasks.get(run.sourceTaskId);
  return (
    !!task &&
    task.projectId === run.projectId &&
    task.crewExecutionId === run.id &&
    (await tasks.assistantTaskAdmission(task))
  );
}
