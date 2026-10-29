import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  refreshRemoteProjectSessions,
  sessionAccessForMachine,
  type useRemoteProjectSessions,
} from "../../features/connections/model/connections";
import type { remoteProjectFor } from "../../features/connections/model/remoteProjects";
import { forgetRemoteQueue } from "../../features/connections/model/useRemoteQueue";
import {
  bulkDeleteOutcome,
  bulkDeleteSummary,
  deleteSessionsInBulk,
  splitRunningSessions,
} from "../../features/sessions/model/bulkSessionDelete";
import { confirmSessionDelete } from "../../features/sessions/model/confirmSessionDelete";

export type SessionBulkDeleteOptions = {
  cwd: string;
  remoteProject: boolean;
  remote: ReturnType<typeof useRemoteProjectSessions>;
  hostProject: ReturnType<typeof remoteProjectFor>;
  /** Sessions that are working or waiting for approval; never deleted in bulk. */
  runningSessionIds: ReadonlySet<string>;
  onDeleteLocalSessionNow?: (sessionId: string, skipWorktreeConfirm?: boolean) => Promise<boolean>;
  onDeleteSessions?: (sessionIds: readonly string[]) => void;
  onRemoteSessionDeleted?: (sessionId: string) => void;
  /** Called with the sessions that were really deleted. */
  onDeleted: (deletedIds: ReadonlySet<string>) => void;
};

type DeleteProgress = { cwd: string; completed: number; total: number };

/**
 * Bulk session deletion: the confirmation, per-session progress and the result
 * notice. The running set is read when a delete reaches each session, so a
 * conversation that starts running while the confirmation is open is left alone.
 */
export function useSessionBulkDelete({
  cwd,
  remoteProject,
  remote,
  hostProject,
  runningSessionIds,
  onDeleteLocalSessionNow,
  onDeleteSessions,
  onRemoteSessionDeleted,
  onDeleted,
}: SessionBulkDeleteOptions) {
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(null);
  const [deleteNoticeError, setDeleteNoticeError] = useState(false);
  const [deleteNoticeCwd, setDeleteNoticeCwd] = useState(cwd);
  const bulkDeleteActive = useRef(false);
  const runningRef = useRef(runningSessionIds);
  useLayoutEffect(() => {
    runningRef.current = runningSessionIds;
  });
  const dismissBulkNotice = useCallback(() => setBulkNotice(null), []);

  const bulkDeleteSessions = async (sessionIds: readonly string[]) => {
    if (bulkDeleteActive.current || sessionIds.length === 0) return;
    const authorityById = new Map(
      remote.sessions.map((entry) => [entry.id, entry.authorityGeneration]),
    );
    const machine = remote.machine;
    if (remoteProject && (!machine || !hostProject)) {
      window.alert("Connect this project's machine to delete its sessions.");
      return;
    }
    const deleteOne =
      remoteProject && machine && hostProject
        ? async (sessionId: string) => {
            await sessionAccessForMachine(machine.id, false, true).delete(
              sessionId,
              hostProject.projectId,
              authorityById.get(sessionId),
            );
            forgetRemoteQueue(sessionId);
            onRemoteSessionDeleted?.(sessionId);
          }
        : onDeleteLocalSessionNow
          ? (sessionId: string) =>
              sessionIds.length === 1
                ? onDeleteLocalSessionNow(sessionId, false)
                : onDeleteLocalSessionNow(sessionId)
          : undefined;
    if (!deleteOne) {
      // Without the reporting delete, only a handler that asks first may run.
      onDeleteSessions?.(sessionIds);
      return;
    }
    const { deletable, running } = splitRunningSessions(sessionIds, runningRef.current);
    if (deletable.length === 0) {
      setDeleteNoticeCwd(cwd);
      setDeleteNoticeError(false);
      setBulkNotice(bulkDeleteSummary({ skipped: running, failed: [] }));
      return;
    }
    bulkDeleteActive.current = true;
    try {
      if (
        !(await confirmSessionDelete({
          count: deletable.length,
          title:
            deletable.length === 1
              ? remote.sessions.find((entry) => entry.id === deletable[0])?.title
              : undefined,
          skippedRunning: running.length,
        }))
      )
        return;
      setBulkNotice(null);
      setDeleteNoticeCwd(cwd);
      setDeleteProgress({ cwd, completed: 0, total: deletable.length });
      const result = await deleteSessionsInBulk(deletable, {
        isRunning: (id) => runningRef.current.has(id),
        deleteOne,
        onProgress: (completed, total) => setDeleteProgress({ cwd, completed, total }),
      });
      setDeleteNoticeError(result.failed.length > 0);
      setBulkNotice(
        bulkDeleteOutcome({
          ...result,
          skipped: [...running, ...result.skipped],
        }),
      );
      onDeleted(new Set(result.deleted));
    } catch (error) {
      setDeleteNoticeCwd(cwd);
      setDeleteNoticeError(true);
      setBulkNotice(
        `Could not delete conversations: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      bulkDeleteActive.current = false;
      setDeleteProgress(null);
      if (remoteProject) refreshRemoteProjectSessions();
    }
  };

  return {
    bulkNotice,
    deleteProgress,
    deleteNoticeError,
    deleteNoticeCwd,
    deleting: deleteProgress !== null,
    dismissBulkNotice,
    bulkDeleteSessions,
  };
}
