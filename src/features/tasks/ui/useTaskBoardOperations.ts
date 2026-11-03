import { useCallback, useState } from "react";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import type { RemoteDataState } from "../../connections/model/remoteDataState";
import type { BoardTask } from "../model/taskClient";
import type { useTaskBoardQueries } from "../model/useTaskBoardQueries";

/** A sprint assignment that failed after its task or goal was created. */
export type PlanningRecovery = {
  id: string;
  title: string;
  sprintId: string;
  task?: BoardTask;
  goal?: { environmentId: string; goalId: string };
};

/** What the board's owners share while one action runs: the single pending
 * action, the saving lock of the open form, the error surface and the refresh
 * that follows every attempt. Confirmed collection changes go to the board
 * query owner (useTaskBoardQueries) through each action's commit. */
export function useTaskBoardOperations(refreshQueries: () => Promise<unknown>) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const refresh = useCallback(() => refreshQueries(), [refreshQueries]);

  /** Runs one board action; the owner's other actions wait until it settles.
   * `commit` receives the host's confirmed answer before the refresh starts. */
  const act = async <T>(
    task: Pick<BoardTask, "id"> & Partial<Pick<BoardTask, "machineId">>,
    action: () => Promise<T>,
    commit?: (saved: T) => void,
  ) => {
    if (acting) return;
    setActing(task.machineId ? JSON.stringify([task.machineId, task.id]) : task.id);
    try {
      const saved = await action();
      commit?.(saved);
      setError(null);
      void refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      // A merge that failed is recorded on its task, which stays in review.
      void refresh();
    } finally {
      setActing(null);
    }
  };

  return { error, setError, saving, setSaving, acting, act, refresh, confirm, confirmDialog };
}

export type TaskBoardOperations = ReturnType<typeof useTaskBoardOperations>;

type TaskBoard = ReturnType<typeof useTaskBoardQueries>["board"];

/** The board's data state and the time its cards measure from. Both follow the
 * board query: the last verified time survives a failed refresh, so it cannot be
 * derived from the current answer alone. Adjusted during render from the
 * previously seen board, with no effect pass in between. */
export function useBoardDataState(board: TaskBoard) {
  const [seen, setSeen] = useState<TaskBoard | null>(null);
  const [state, setState] = useState<{ data: RemoteDataState; now: number }>(() => ({
    data: { phase: "loading" },
    now: Date.now(),
  }));
  if (seen !== board) {
    setSeen(board);
    setState(({ data }) => {
      // Read when the update applies, not while rendering.
      const at = Date.now();
      const updatedAt = board.hasTaskAnswer && !board.error && !board.pending ? at : data.updatedAt;
      return {
        now: at,
        data: {
          updatedAt,
          error: board.error,
          phase: board.error
            ? updatedAt
              ? "stale"
              : "error"
            : board.pending
              ? updatedAt
                ? "refreshing"
                : "loading"
              : board.machines.length
                ? "ready"
                : "empty",
        },
      };
    });
  }
  return { boardDataState: state.data, now: state.now };
}
