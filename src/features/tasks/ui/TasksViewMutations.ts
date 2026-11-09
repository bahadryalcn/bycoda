import type { RemoteMachine } from "../../connections";
import { t } from "../../../shared/i18n";
import {
  type BoardTask,
  deleteTask,
  draftFromTask,
  moveTask,
  reorderTasks,
  saveTask,
  startTask,
  type TaskDraft,
  tasksInColumn,
} from "../model/taskClient";
import {
  canMoveTask,
  EMPTY_PROMPT_ERROR,
  hasUnmergedBranch,
  taskColumn,
  type TaskColumn,
  type TaskStatus,
} from "../model/hostTasks";
import type { SprintBoardController } from "../model/sprintClient";
import { workspaceOperationKey, workspaceRequest } from "../../workspaces/public/workspaceClient";
import { taskWorkspaceState } from "../../workspaces/public/taskWorkspaceState";
import { COLUMN_LABELS } from "./TaskBoardColumns";
import type { PlanningRecovery, useTaskBoardOperations } from "./useTaskBoardOperations";

/** The board's task mutations: move, reorder, save, delete and edit, each writing the
 * host's answer back through `put` so a later poll cannot roll it back. */
export function useTaskMutations({
  ops,
  put,
  machines,
  visibleTasks,
  draft,
  setDraft,
  currentSprint,
  sprintBoard,
  addPlanningRecovery,
}: {
  ops: ReturnType<typeof useTaskBoardOperations>;
  put: {
    task: (task: BoardTask) => void;
    tasks: (tasks: BoardTask[]) => void;
    remove: (task: BoardTask) => void;
  };
  machines: RemoteMachine[];
  visibleTasks: readonly BoardTask[];
  draft: TaskDraft | null;
  setDraft: (draft: TaskDraft | null) => void;
  currentSprint: { id: string } | undefined;
  sprintBoard: SprintBoardController;
  addPlanningRecovery: (item: PlanningRecovery) => void;
}) {
  const { setError, saving, setSaving, acting, act, refresh, confirm } = ops;
  const { task: putTask, tasks: putTasks, remove: removeTask } = put;
  const report = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : String(reason));

  const actOnTask = (task: BoardTask, action: () => Promise<BoardTask>) =>
    act(task, action, putTask);

  const onMove = (task: BoardTask, to: TaskStatus) => {
    if (to === "done" && hasUnmergedBranch(task)) {
      const workspaceId = taskWorkspaceState(task).workspaceId;
      if (!workspaceId) {
        setError(
          t(
            "Update bycoda Host to mark this work finished without merging. Review changes separately to approve delivery.",
          ),
        );
        return;
      }
      act(task, async () => {
        const workspace = await workspaceRequest(
          "workspaces.get",
          { workspaceId },
          { cwd: task.cwd },
        );
        if (!workspace) throw new Error(t("Workspace not found"));
        return workspaceRequest(
          "workspaces.finish",
          {
            workspaceId,
            expectedRevision: workspace.revision,
            idempotencyKey: workspaceOperationKey(),
          },
          { cwd: task.cwd },
        );
      }).catch(report);
      return;
    }
    if (to === "queued" && !task.prompt.trim()) {
      setError(EMPTY_PROMPT_ERROR);
      return;
    }
    actOnTask(task, () =>
      to === "queued" && task.workspaceControlsSupported ? startTask(task) : moveTask(task, to),
    ).catch(report);
  };
  const onTaskDrop = async (task: BoardTask, column: TaskColumn, before?: BoardTask) => {
    if (acting || task.stale) return;
    if (taskColumn(task.status) !== column) {
      if (!canMoveTask(task.status, column, task.crewRunId ?? task.crewDefinitionId)) return;
      if (
        (column === "blocked" ||
          (column === "done" && hasUnmergedBranch(task)) ||
          (task.status === "review" && column === "queued")) &&
        !(await confirm({
          title: t("Move task"),
          message: t("Move this task to {p0}?", { p0: t(COLUMN_LABELS[column]) }),
          confirmLabel: t("Move"),
          danger: false,
        }))
      )
        return;
      onMove(task, column);
      return;
    }
    if (!task.workspaceControlsSupported) return;
    if (column !== "todo" && column !== "queued") return;
    const ordered = tasksInColumn(visibleTasks, column).filter(
      (item) => item.machineId === task.machineId && item.id !== task.id,
    );
    const index = before ? ordered.findIndex((item) => item.id === before.id) : ordered.length;
    if (
      before &&
      (before.machineId !== task.machineId ||
        before.status !== task.status ||
        before.id === task.id)
    )
      return;
    ordered.splice(index < 0 ? ordered.length : index, 0, task);
    await act(task, () => reorderTasks(ordered), putTasks);
  };

  /** `queued` starts a new task right away; `save` keeps an edited task's status. */
  const onSave = async (mode: "todo" | "queued" | "save") => {
    if (saving || !draft) return;
    setSaving(true);
    try {
      let saved = await saveTask(machines, draft, mode === "todo" ? "todo" : "queued");
      // Creation already succeeded. Publish that identity and retire the creation
      // draft before the separate start request, whose transport may fail even
      // after the host accepted it. Recovery uses this task's board controls.
      putTask(saved);
      setDraft(null);
      if (!draft.id && currentSprint && sprintBoard.supported) {
        try {
          await sprintBoard.plan(saved, currentSprint.id);
        } catch (reason) {
          addPlanningRecovery({
            id: `task:${saved.machineId}:${saved.id}`,
            title: saved.title,
            sprintId: currentSprint.id,
            task: saved,
          });
          setError(
            t("Task created. Sprint assignment failed: {p0}", {
              p0: reason instanceof Error ? reason.message : String(reason),
            }),
          );
          refresh().catch(report);
          return;
        }
      }
      if (mode === "queued" && saved.workspaceControlsSupported) {
        saved = await startTask(saved);
        putTask(saved);
      }
      setError(null);
      refresh().catch(report);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (task: BoardTask) => {
    const discard = hasUnmergedBranch(task);
    if (
      !(await confirm({
        title: t("Delete task"),
        message: discard
          ? t(
              "Delete “{p0}”? Its work on {p1} was never merged, and the branch will be discarded.",
              { p0: task.title, p1: task.branch },
            )
          : t("Delete “{p0}”?", { p0: task.title }),
        confirmLabel: t("Delete"),
      }))
    )
      return;
    act(
      task,
      () => deleteTask(task, discard),
      () => removeTask(task),
    ).catch(report);
  };

  const onEdit = (task: BoardTask) => {
    setError(null);
    setDraft(draftFromTask(task));
  };

  /** Saves a new title and description from the detail panel; true when saved. */
  const onSaveDetails = async (
    task: BoardTask,
    title: string,
    prompt: string,
  ): Promise<boolean> => {
    try {
      const saved = await saveTask(machines, { ...draftFromTask(task), title, prompt });
      putTask(saved);
      setError(null);
      refresh().catch(report);
      return true;
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };

  return { actOnTask, onMove, onTaskDrop, onSave, onDelete, onEdit, onSaveDetails };
}
