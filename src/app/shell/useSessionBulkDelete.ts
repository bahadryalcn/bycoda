import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
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
import { t } from "../../shared/i18n";

export type SessionBulkDeleteOptions = {
  cwd: string;
  sessions?: readonly { id: string; title?: string }[];
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

type DeleteProgress = {
  cwd: string;
  completed: number;
  total: number;
  sessionIds: readonly string[];
  title: string;
};

/** A machine's desktop takes queued deletions on its next heartbeat; sending
 * several at once lets one heartbeat carry them instead of one per conversation. */
const REMOTE_DELETE_CONCURRENCY = 8;

type BulkDeleteRun = {
  cwd: string;
  sessions: SessionBulkDeleteOptions["sessions"];
  remote: SessionBulkDeleteOptions["remote"];
  remoteProject: boolean;
  deletable: readonly string[];
  running: readonly string[];
  deleteOne: (sessionId: string) => Promise<void | boolean>;
  isRunning: (sessionId: string) => boolean;
  /** Called first in the cleanup, before progress clears. */
  release: () => void;
  onDeleted: SessionBulkDeleteOptions["onDeleted"];
  setBulkNotice: (notice: string | null) => void;
  setDeleteProgress: Dispatch<SetStateAction<DeleteProgress | null>>;
  setDeleteNoticeCwd: (cwd: string) => void;
  setDeleteNoticeError: (error: boolean) => void;
  setDeleteNoticeSuccess: (success: boolean) => void;
};

/** Confirms and runs one bulk delete; every failure becomes the notice, so it never rejects. */
async function runBulkDelete({
  cwd,
  sessions,
  remote,
  remoteProject,
  deletable,
  running,
  deleteOne,
  isRunning,
  release,
  onDeleted,
  setBulkNotice,
  setDeleteProgress,
  setDeleteNoticeCwd,
  setDeleteNoticeError,
  setDeleteNoticeSuccess,
}: BulkDeleteRun): Promise<void> {
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
    setDeleteProgress({
      cwd,
      completed: 0,
      total: deletable.length,
      sessionIds: deletable,
      title: sessions?.find((entry) => entry.id === deletable[0])?.title || t("Deleting…"),
    });
    const result = await deleteSessionsInBulk(deletable, {
      isRunning,
      deleteOne: (id) => {
        setDeleteProgress(
          (progress) =>
            progress && {
              ...progress,
              title: sessions?.find((entry) => entry.id === id)?.title || t("Deleting…"),
            },
        );
        return deleteOne(id);
      },
      onProgress: (completed, total) =>
        setDeleteProgress((progress) => progress && { ...progress, completed, total }),
      concurrency: remoteProject ? REMOTE_DELETE_CONCURRENCY : 1,
    });
    setDeleteNoticeError(result.failed.length > 0);
    setDeleteNoticeSuccess(
      result.deleted.length > 0 &&
        result.failed.length === 0 &&
        running.length === 0 &&
        result.skipped.length === 0,
    );
    setBulkNotice(
      bulkDeleteOutcome({
        ...result,
        skipped: [...running, ...result.skipped],
      }),
    );
    onDeleted(new Set(result.deleted));
  } catch (error) {
    setDeleteNoticeSuccess(false);
    setDeleteNoticeCwd(cwd);
    setDeleteNoticeError(true);
    setBulkNotice(
      t("Could not delete conversations: {p0}", {
        p0: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    release();
    setDeleteProgress(null);
    if (remoteProject) refreshRemoteProjectSessions();
  }
}

/**
 * Bulk session deletion: the confirmation, per-session progress and the result
 * notice. The running set is read when a delete reaches each session, so a
 * conversation that starts running while the confirmation is open is left alone.
 */
export function useSessionBulkDelete({
  cwd,
  sessions,
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
  const [deleteNoticeSuccess, setDeleteNoticeSuccess] = useState(false);
  const [deleteNoticeCwd, setDeleteNoticeCwd] = useState(cwd);
  const bulkDeleteActive = useRef(false);
  const runningRef = useRef(runningSessionIds);
  useLayoutEffect(() => {
    runningRef.current = runningSessionIds;
  });
  const dismissBulkNotice = useCallback(() => setBulkNotice(null), []);
  useEffect(() => {
    if (!bulkNotice || !deleteNoticeSuccess || deleteProgress) return;
    const timer = window.setTimeout(dismissBulkNotice, 10_000);
    return () => window.clearTimeout(timer);
  }, [bulkNotice, deleteNoticeSuccess, deleteProgress, dismissBulkNotice]);

  const bulkDeleteSessions = async (sessionIds: readonly string[]) => {
    if (bulkDeleteActive.current || sessionIds.length === 0) return;
    const authorityById = new Map(
      remote.sessions.map((entry) => [entry.id, entry.authorityGeneration]),
    );
    const machine = remote.machine;
    if (remoteProject && (!machine || !hostProject)) {
      setDeleteNoticeSuccess(false);
      setDeleteNoticeCwd(cwd);
      setDeleteNoticeError(true);
      setBulkNotice(t("Connect this project's machine to delete its sessions."));
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
      setDeleteNoticeSuccess(false);
      setDeleteNoticeCwd(cwd);
      setDeleteNoticeError(false);
      setBulkNotice(bulkDeleteSummary({ skipped: running, failed: [] }));
      return;
    }
    bulkDeleteActive.current = true;
    await runBulkDelete({
      cwd,
      sessions,
      remote,
      remoteProject,
      deletable,
      running,
      deleteOne,
      isRunning: (id) => runningRef.current.has(id),
      release: () => {
        bulkDeleteActive.current = false;
      },
      onDeleted,
      setBulkNotice,
      setDeleteProgress,
      setDeleteNoticeCwd,
      setDeleteNoticeError,
      setDeleteNoticeSuccess,
    });
  };

  return {
    bulkNotice,
    deleteProgress,
    deleteNoticeError,
    deleteNoticeSuccess,
    deleteNoticeCwd,
    deleting: deleteProgress !== null,
    dismissBulkNotice,
    bulkDeleteSessions,
  };
}
