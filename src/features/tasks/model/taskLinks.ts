import type { RemoteMachine } from "../../connections";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { CrewsPageTarget } from "../../crews/public/crewsPage";
import { workCrewId } from "./hostTasks";
import type { BoardTask } from "./taskClient";

/** The automation row to reveal, by the exact Host that owns it. */
export type AutomationOpenTarget = {
  id: string;
  projectId: string;
  environmentId: string;
  machineId: string;
};

/**
 * The automation that started a task, by the ids the Host recorded on the task. Undefined when the
 * task has no automation or its machine does not say which Host it is, so a same-id automation
 * from another Host is never revealed.
 */
export function taskAutomationTarget(
  task: Pick<BoardTask, "automationId" | "origin" | "projectId" | "machineId">,
  machines: readonly RemoteMachine[],
): AutomationOpenTarget | undefined {
  if (!task.automationId || (task.origin && task.origin.kind !== "automation")) return undefined;
  const environmentId = machines.find((machine) => machine.id === task.machineId)?.environmentId;
  if (!environmentId) return undefined;
  return {
    id: task.automationId,
    projectId: task.projectId,
    environmentId,
    machineId: task.machineId,
  };
}

/**
 * Where the Crews page shows the run a task belongs to. The page lists this computer's crews, so
 * only a task this computer's Host ran links there.
 */
export function taskCrewRunTarget(
  task: Pick<BoardTask, "crewRunId" | "executor" | "resolved" | "machineId">,
  machines: readonly RemoteMachine[],
): CrewsPageTarget | undefined {
  const machine = machines.find((entry) => entry.id === task.machineId);
  if (!task.crewRunId || !machine || !isLocalSyncMachine(machine)) return undefined;
  const definitionId = workCrewId(task);
  return { tab: "work", runId: task.crewRunId, ...(definitionId ? { definitionId } : {}) };
}
