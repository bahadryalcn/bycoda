import type { HostTask } from "./hostTasks";

type Related = Pick<HostTask, "id" | "goalId" | "crewRunId" | "crewExecutionId">;
type Placed = Related & { machineId: string };

/**
 * Work that opens inside its owner instead of taking a row of its own: an epic's planned task
 * (shown on the epic) and a crew assignment (shown on the crew task whose run it belongs to).
 * A crew assignment whose crew task is not on the board stays a row, so no work disappears.
 */
export function isSubordinateTask(task: Placed, all: readonly Placed[]): boolean {
  if (task.goalId) return true;
  const runId = task.crewRunId;
  if (!runId) return false;
  return all.some((other) => other.machineId === task.machineId && other.crewExecutionId === runId);
}

/** The assignments of a crew task, in board order. */
export function crewAssignments<T extends Placed>(parent: Placed, all: readonly T[]): T[] {
  const runId = parent.crewExecutionId;
  if (!runId) return [];
  return all.filter((task) => task.machineId === parent.machineId && task.crewRunId === runId);
}

/** The tasks an epic planned, in plan order, leaving out deleted ones. */
export function epicTasks<T extends { id: string; machineId: string }>(
  goal: { machineId: string; taskIds: readonly string[] },
  all: readonly T[],
): T[] {
  const byId = new Map(
    all.filter((task) => task.machineId === goal.machineId).map((task) => [task.id, task]),
  );
  return goal.taskIds.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
}
