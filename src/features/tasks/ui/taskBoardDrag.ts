import { useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";
import { canMoveTask, TASK_COLUMNS, taskColumn, type TaskColumn } from "../model/hostTasks";
import type { BoardTask } from "../model/taskClient";

/** The board's own key for a card: `machineId:taskId`. */
export const taskCardKey = (task: Pick<BoardTask, "machineId" | "id">): string =>
  `${task.machineId}:${task.id}`;

export type TaskBoardDragState = {
  draggedKey: string | null;
  dropColumn: TaskColumn | null;
  /** The card a reorder would land before. */
  dropBeforeKey: string | null;
};

const IDLE: TaskBoardDragState = { draggedKey: null, dropColumn: null, dropBeforeKey: null };

/** Where drag cues live. Cards and columns subscribe to the one flag they draw, so a
 * `dragover` that moves the cue re-renders only the parts whose cue changed, never the board. */
export function createTaskBoardDrag() {
  let state = IDLE;
  const listeners = createStore();
  return {
    get: (): TaskBoardDragState => state,
    subscribe: listeners.subscribe,
    set(patch: Partial<TaskBoardDragState>) {
      const next = { ...state, ...patch };
      if (
        next.draggedKey === state.draggedKey &&
        next.dropColumn === state.dropColumn &&
        next.dropBeforeKey === state.dropBeforeKey
      )
        return;
      state = next;
      listeners.notify();
    },
    end() {
      if (state === IDLE) return;
      state = IDLE;
      listeners.notify();
    },
  };
}

export type TaskBoardDrag = ReturnType<typeof createTaskBoardDrag>;

/** Reads one slice of the drag state; `select` must return a primitive. */
export function useTaskBoardDrag<T extends string | number | boolean | null>(
  drag: TaskBoardDrag,
  select: (state: TaskBoardDragState) => T,
): T {
  return useSyncExternalStore(
    drag.subscribe,
    () => select(drag.get()),
    () => select(IDLE),
  );
}

/** A card of a manually ordered column can be dropped inside its own column. */
export function canReorderInColumn(task: BoardTask, column: TaskColumn): boolean {
  return (
    taskColumn(task.status) === column &&
    Boolean(task.workspaceControlsSupported) &&
    (column === "todo" || column === "queued")
  );
}

/** Whether a dragged card may land on `column` (a move or a reorder). */
export function canDropOnColumn(task: BoardTask, column: TaskColumn): boolean {
  return (
    canReorderInColumn(task, column) ||
    canMoveTask(task.status, column, task.crewRunId ?? task.crewDefinitionId)
  );
}

/** Whether a card can start a drag at all. */
export function taskDraggable(task: BoardTask, acting: string | null): boolean {
  return (
    !acting &&
    !task.stale &&
    (task.status === "todo" ||
      task.status === "queued" ||
      TASK_COLUMNS.some((column) =>
        canMoveTask(task.status, column, task.crewRunId ?? task.crewDefinitionId),
      ))
  );
}
