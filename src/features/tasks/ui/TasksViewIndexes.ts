import { useMemo } from "react";
import { projectDisplayName } from "../../projects/public/projectNames";
import { projectKey } from "../../../shared/lib/paths";
import { goalKey } from "../model/goalClient";
import { type BoardTask, tasksInColumn } from "../model/taskClient";
import { TASK_COLUMNS, unfinishedDependencies } from "../model/hostTasks";
import { resolveTabGroupLabel } from "../../workspace/public/tabGroups";

/** Per-machine task lists, column peers and neighbour order keys used by the board. */
export function useBoardIndexes(
  storedTasks: readonly BoardTask[],
  tasks: readonly BoardTask[],
  visibleTasks: readonly BoardTask[],
) {
  return useMemo(() => {
    const machineTasks = new Map<string, BoardTask[]>();
    const peers = new Map<string, BoardTask[]>();
    for (const task of storedTasks) {
      const list = machineTasks.get(task.machineId) ?? [];
      list.push(task);
      machineTasks.set(task.machineId, list);
    }
    const columns = new Map(TASK_COLUMNS.map((column) => [column, tasksInColumn(tasks, column)]));
    for (const column of TASK_COLUMNS)
      for (const task of tasksInColumn(visibleTasks, column)) {
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
    return { machineTasks, peers, columns, orders };
  }, [storedTasks, tasks, visibleTasks]);
}

/** Project, goal and waiting-for context of every task, keyed by `machineId:taskId`. */
export function useTaskContexts(
  storedTasks: readonly BoardTask[],
  machineTasks: ReadonlyMap<string, BoardTask[]>,
  groupLabels: Parameters<typeof resolveTabGroupLabel>[1],
  goalTitles: ReadonlyMap<string, string>,
) {
  return useMemo(
    () =>
      new Map(
        storedTasks.map((task) => [
          task.machineId + ":" + task.id,
          {
            project: resolveTabGroupLabel(
              projectKey(task.cwd),
              groupLabels,
              projectDisplayName(task.cwd),
            ),
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
    [storedTasks, machineTasks, groupLabels, goalTitles],
  );
}
