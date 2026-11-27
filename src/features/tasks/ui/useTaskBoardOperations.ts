import { useCallback, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import type { RemoteDataState } from "../../connections";
import type { BoardTask } from "../model/taskClient";
import type { useTaskBoardQueries } from "../model/useTaskBoardQueries";
import { describeRemoteError } from "../../connections/public/remoteFailure";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";

/** A sprint assignment that failed after its task or goal was created. */
export type PlanningRecovery = {
  id: string;
  title: string;
  sprintId: string;
  /** Why the assignment failed; shown on the recovery row instead of a board-wide error. */
  reason?: string;
  task?: BoardTask;
  goal?: { environmentId: string; goalId: string };
};

/** What the board's owners share while one action runs: the single pending
 * action, the saving lock of the open form, the error surface and the refresh
 * that follows every attempt. Confirmed collection changes go to the board
 * query owner (useTaskBoardQueries) through each action's commit. */
export function useTaskBoardOperations(refreshQueries: () => Promise<unknown>) {
  const [failure, setFailure] = useState<{
    message: string;
    details?: string;
    machineId?: string;
  } | null>(null);
  const setError = useCallback((message: string | null) => {
    setFailure(message === null ? null : { message });
  }, []);
  const reportError = useCallback((reason: unknown, machineId?: string) => {
    setFailure({ ...describeRemoteError(reason), machineId });
  }, []);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const running = useRef(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const refresh = useCallback(() => refreshQueries(), [refreshQueries]);

  /** Runs one board action; the owner's other actions wait until it settles.
   * `commit` receives the host's confirmed answer before the refresh starts. */
  const act = async <T>(
    task: Pick<BoardTask, "id"> & Partial<Pick<BoardTask, "machineId">>,
    action: () => Promise<T>,
    commit?: (saved: T) => void,
  ) => {
    // A ref, not `acting` state: two presses before the next render must not both pass.
    if (running.current) return;
    running.current = true;
    setActing(task.machineId ? JSON.stringify([task.machineId, task.id]) : task.id);
    try {
      const saved = await action();
      commit?.(saved);
      setError(null);
      void refresh().catch((reason: unknown) => reportError(reason, task.machineId));
    } catch (reason: unknown) {
      reportError(reason, task.machineId);
      // A merge that failed is recorded on its task, which stays in review.
      void refresh().catch(() => {});
    } finally {
      running.current = false;
      setActing(null);
    }
  };

  return {
    error: failure?.message ?? null,
    errorDetails: failure?.details,
    errorMachineId: failure?.machineId,
    setError,
    reportError,
    saving,
    setSaving,
    acting,
    act,
    refresh,
    confirm,
    confirmDialog,
  };
}

/** The board's display error is already translated. Existing active reads still hold their causes. */
export function taskBoardTechnicalDetails(client: QueryClient, machineId?: string) {
  const details = new Set<string>();
  const machineIds = new Set<string>();
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: ["task-board"], type: "active" })) {
    if (machineId && query.queryKey[1] !== machineId && query.queryKey[1] !== "inventory") continue;
    const { error, data } = query.state;
    const append = (reason: unknown) => {
      if (reason == null) return;
      details.add(describeRemoteError(reason).details);
      const id = query.queryKey[1];
      if (typeof id === "string" && id !== "inventory") machineIds.add(id);
    };
    append(error);
    if (query.queryKey[5] === "capabilities") {
      append((data as { error?: unknown } | undefined)?.error);
    } else if (
      ["tasks", "goals", "stewards"].some((kind) => kind === query.queryKey[5]) &&
      Array.isArray(data)
    ) {
      for (const result of data as { status: string; failure?: unknown; error?: string }[]) {
        if (result.status === "error") append(result.failure ?? result.error);
      }
    }
  }
  return { machineIds: [...machineIds], details: [...details].filter(Boolean).join("\n\n") };
}

export type TaskBoardOperations = ReturnType<typeof useTaskBoardOperations>;

type TaskBoard = ReturnType<typeof useTaskBoardQueries>["board"];

/** The board's data state and the time its cards measure from. Both follow the
 * board query: the last verified time survives a failed refresh, so it cannot be
 * derived from the current answer alone. Adjusted during render from the
 * previously seen board, with no effect pass in between.
 *
 * Time labels also advance on the shared minute clock while the board has tasks,
 * so a running card keeps counting when the board object does not change. The
 * clock stops with no tasks and while the document is hidden. */
export function useBoardDataState(board: TaskBoard, scope = "all") {
  const [seen, setSeen] = useState<{ board: TaskBoard; scope: string } | null>(null);
  const [state, setState] = useState<{ data: RemoteDataState; now: number }>(() => ({
    data: { phase: "loading" },
    now: Date.now(),
  }));
  if (seen?.board !== board || seen?.scope !== scope) {
    setSeen({ board, scope });
    const sameScope = seen?.scope === scope;
    setState(({ data }) => {
      // Read when the update applies, not while rendering.
      const at = Date.now();
      const updatedAt =
        board.hasTaskAnswer &&
        !board.taskError &&
        !board.pending &&
        !board.tasks.some((task) => task.stale)
          ? at
          : sameScope
            ? data.updatedAt
            : undefined;
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
              ? updatedAt || board.hasTaskAnswer
                ? "refreshing"
                : "loading"
              : board.machines.length
                ? "ready"
                : "empty",
        },
      };
    });
  }
  // The minute clock is floored, so the max keeps `now` from going backwards when a
  // board update stamped a later real time.
  const minute = useMinuteNow(board.tasks.length > 0);
  return { boardDataState: state.data, now: Math.max(state.now, minute) };
}
