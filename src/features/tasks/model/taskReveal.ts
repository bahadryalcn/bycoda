import { projectKey } from "../../../shared/lib/paths";
import type { RemoteMachine } from "../../connections";
import type { BoardTask } from "./taskClient";

/** Exact execution owner for navigation from an automation occurrence. */
export type TaskRevealTarget = {
  machineId: string;
  environmentId?: string;
  projectId: string;
  cwd: string;
  taskId: string;
};

/** Never substitute a same-ID Task from another execution owner. */
export function findRevealedTask(
  target: TaskRevealTarget,
  machines: readonly RemoteMachine[],
  tasks: readonly BoardTask[],
) {
  const machine = machines.find(
    (entry) =>
      entry.id === target.machineId &&
      (!target.environmentId || entry.environmentId === target.environmentId),
  );
  if (!machine) return undefined;
  return tasks.find(
    (entry) =>
      entry.machineId === machine.id &&
      entry.projectId === target.projectId &&
      entry.id === target.taskId &&
      projectKey(entry.cwd) === projectKey(target.cwd),
  );
}
