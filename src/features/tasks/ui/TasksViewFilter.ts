import { useMemo } from "react";
import type { RemoteMachine } from "../../connections";
import { goalKey } from "../model/goalClient";
import { sprintTaskKey } from "../model/hostSprints";
import { taskColumn } from "../model/hostTasks";
import type { SprintBoardController } from "../model/sprintClient";
import { taskMatchesProject } from "../model/taskBoardScope";
import type { BoardTask } from "../model/taskClient";
import { taskGroup, type TaskGroup } from "../model/taskGroups";
import { ALL_GOALS } from "./TaskGoals";
import type { TaskSection } from "./TaskToolbar";

export type TaskCountFilter = Exclude<TaskGroup, "done"> | "doneToday" | "suggestions";

/** The chip and the list use the same state predicate, in the current local day. */
export function matchesTaskCount(task: BoardTask, filter: TaskCountFilter, now: number) {
  if (filter !== "doneToday" && filter !== "suggestions") return taskGroup(task) === filter;
  if (task.stale) return false;
  const at = filter === "doneToday" ? (task.completedAt ?? task.updatedAt) : task.createdAt;
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (at < today || at > now) return false;
  return filter === "doneToday"
    ? taskGroup(task) === "done"
    : task.source === "steward" && task.status === "todo";
}

/** Scope and search come first. Chips count this population before the state filters apply. */
export function useFilteredTasks({
  visibleTasks,
  goalFilter,
  statusFilter,
  countFilter,
  machineFilter,
  projectFilter,
  searchQuery,
  machines,
  sprintBoard,
  accessibleSprints,
  section,
  sprintFilter,
  now,
}: {
  visibleTasks: readonly BoardTask[];
  goalFilter: string;
  statusFilter: string;
  countFilter: TaskCountFilter | null;
  machineFilter: string;
  projectFilter: string;
  searchQuery: string;
  machines: RemoteMachine[];
  sprintBoard: SprintBoardController;
  accessibleSprints: readonly { id: string; state: string }[];
  section: TaskSection;
  sprintFilter: string;
  now: number;
}) {
  const scoped = useMemo(() => {
    const search = searchQuery.trim().toLocaleLowerCase();
    const planned = new Set(
      accessibleSprints
        .filter((sprint) => sprint.state === "active" || sprint.state === "planned")
        .map((sprint) => sprint.id),
    );
    return visibleTasks.filter((task) => {
      if (
        goalFilter !== ALL_GOALS &&
        (!task.goalId || goalKey(task.machineId, task.goalId) !== goalFilter)
      )
        return false;
      if (machineFilter !== "all" && task.machineId !== machineFilter) return false;
      if (!taskMatchesProject(task, projectFilter, machines)) return false;
      const ref = sprintBoard.taskRef(task);
      const sprint = ref ? sprintBoard.planning.get(sprintTaskKey(ref))?.sprintId : undefined;
      if (section === "backlog" && sprint && planned.has(sprint)) return false;
      if (section === "sprints" && sprintFilter && sprint !== sprintFilter) return false;
      return (
        !search || `${task.title}\n${task.prompt}\n${task.id}`.toLocaleLowerCase().includes(search)
      );
    });
  }, [
    goalFilter,
    visibleTasks,
    machineFilter,
    projectFilter,
    searchQuery,
    machines,
    sprintBoard.planning,
    sprintBoard.taskRef,
    accessibleSprints,
    section,
    sprintFilter,
  ]);
  const tasks = useMemo(
    () =>
      scoped.filter(
        (task) =>
          (statusFilter === "all" ||
            task.status === statusFilter ||
            taskColumn(task.status) === statusFilter) &&
          (!countFilter || matchesTaskCount(task, countFilter, now)),
      ),
    [scoped, statusFilter, countFilter, now],
  );
  return { scoped, tasks };
}
