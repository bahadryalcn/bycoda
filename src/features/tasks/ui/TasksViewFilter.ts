import { useMemo } from "react";
import type { RemoteMachine } from "../../connections";
import { goalKey } from "../model/goalClient";
import { sprintTaskKey } from "../model/hostSprints";
import { taskColumn } from "../model/hostTasks";
import type { SprintBoardController } from "../model/sprintClient";
import { taskMatchesProject } from "../model/taskBoardScope";
import type { BoardTask } from "../model/taskClient";
import { ALL_GOALS } from "./TaskGoals";

/** The tasks the current section, search and filters show; selection and counts follow it. */
export function useFilteredTasks({
  visibleTasks,
  goalFilter,
  statusFilter,
  machineFilter,
  projectFilter,
  searchQuery,
  machines,
  sprintBoard,
  accessibleSprints,
  section,
  sprintFilter,
}: {
  visibleTasks: readonly BoardTask[];
  goalFilter: string;
  statusFilter: string;
  machineFilter: string;
  projectFilter: string;
  searchQuery: string;
  machines: RemoteMachine[];
  sprintBoard: SprintBoardController;
  accessibleSprints: readonly { id: string; state: string }[];
  section: "backlog" | "sprints" | "reports";
  sprintFilter: string;
}) {
  return useMemo(
    () =>
      visibleTasks.filter(
        (task) =>
          (goalFilter === ALL_GOALS ||
            (task.goalId && goalKey(task.machineId, task.goalId) === goalFilter)) &&
          (statusFilter === "all" || taskColumn(task.status) === statusFilter) &&
          (machineFilter === "all" || task.machineId === machineFilter) &&
          taskMatchesProject(task, projectFilter, machines) &&
          (() => {
            const ref = sprintBoard.taskRef(task);
            const plan = ref ? sprintBoard.planning.get(sprintTaskKey(ref)) : undefined;
            if (section === "backlog")
              return (
                !plan?.sprintId ||
                !accessibleSprints.some(
                  (sprint) =>
                    sprint.id === plan.sprintId &&
                    (sprint.state === "active" || sprint.state === "planned"),
                )
              );
            return !sprintFilter || plan?.sprintId === sprintFilter;
          })() &&
          (!searchQuery.trim() ||
            `${task.title}\n${task.prompt}\n${task.id}`
              .toLocaleLowerCase()
              .includes(searchQuery.trim().toLocaleLowerCase())),
      ),
    [
      goalFilter,
      visibleTasks,
      statusFilter,
      machineFilter,
      projectFilter,
      searchQuery,
      machines,
      sprintBoard.planning,
      sprintBoard.taskRef,
      accessibleSprints,
      section,
      sprintFilter,
    ],
  );
}
