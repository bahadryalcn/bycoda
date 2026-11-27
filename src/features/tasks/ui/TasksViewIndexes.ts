import { useMemo } from "react";
import { projectDisplayNameFrom } from "../../projects/public/projectNames";
import { goalKey } from "../model/goalClient";
import { type BoardTask, tasksInColumn } from "../model/taskClient";
import { TASK_COLUMNS, unfinishedDependencies } from "../model/hostTasks";

/** Per-machine task lists, column peers and neighbour order keys used by the board. */
export function useBoardIndexes(storedTasks: readonly BoardTask[], tasks: readonly BoardTask[]) {
  const machineTasks = useMemo(() => {
    const byMachine = new Map<string, BoardTask[]>();
    for (const task of storedTasks) {
      const list = byMachine.get(task.machineId) ?? [];
      list.push(task);
      byMachine.set(task.machineId, list);
    }
    return byMachine;
  }, [storedTasks]);
  const columns = useMemo(
    () => new Map(TASK_COLUMNS.map((column) => [column, tasksInColumn(tasks, column)])),
    [tasks],
  );
  const { peers, orders } = useMemo(() => {
    const peers = new Map<string, BoardTask[]>();
    for (const column of TASK_COLUMNS)
      for (const task of columns.get(column) ?? []) {
        const key = task.machineId + ":" + column,
          list = peers.get(key) ?? [];
        list.push(task);
        peers.set(key, list);
      }
    const orders = new Map<string, string>();
    for (const list of peers.values())
      list.forEach((task, index) =>
        orders.set(
          task.machineId + ":" + task.id,
          JSON.stringify([list[index - 1]?.id, list[index + 1]?.id]),
        ),
      );
    return { peers, orders };
  }, [columns]);
  return { machineTasks, peers, columns, orders };
}

/** Project, goal and waiting-for context of every task, keyed by `machineId:taskId`. */
export function useTaskContexts(
  storedTasks: readonly BoardTask[],
  machineTasks: ReadonlyMap<string, BoardTask[]>,
  groupLabels: Record<string, string>,
  goalTitles: ReadonlyMap<string, string>,
  helperFailures: ReadonlyMap<string, string>,
) {
  return useMemo(
    () =>
      new Map(
        storedTasks.map((task) => [
          task.machineId + ":" + task.id,
          {
            project: projectDisplayNameFrom(task.cwd, groupLabels),
            helperFailure: helperFailures.get(task.machineId + ":" + task.id),
            goal: task.goalId ? goalTitles.get(goalKey(task.machineId, task.goalId)) : undefined,
            waitingFor:
              task.status === "queued"
                ? unfinishedDependencies(task, machineTasks.get(task.machineId) ?? []).map(
                    (other) => other.title,
                  )
                : [],
          },
        ]),
      ),
    [storedTasks, machineTasks, groupLabels, goalTitles, helperFailures],
  );
}
