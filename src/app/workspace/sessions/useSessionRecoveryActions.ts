import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { workspaceSnapshotWriteBlocked } from "../../model/appLifecycle";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import {
  getSessionRecovery,
  eligibleRecoverySessions,
  setRecoverySaveFailure,
  getRecoverySaveFailure,
  beginRecoveryRemoval,
  rollbackRecoveryRemoval,
  setSessionRecovery,
  type SessionRecovery,
} from "../../../features/workspace/model/sessionRecovery";
import { collectWorkspaceSnapshot } from "../../../features/workspace/model/workspaceSnapshot";
import {
  getSession,
  isPrimaryWorkspaceWindow,
  saveWorkspaceSnapshot,
} from "../../../features/sessions/data/sessionStore";
import { invoke } from "@tauri-apps/api/core";
import { listenWindow } from "../../../platform/tauri/listenWindow";
import { readToolWindow } from "../../model/toolWindows";
import { captureSessionRecovery } from "../../../features/workspace/model/sessionRecovery";
import {
  collectRetiredSessionRecovery,
  type RetirementCandidates,
} from "../../model/retiredSessionRecovery";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import type { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import type { ProjectReturnMemory } from "../../../features/projects/model/projectReturn";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import type { ProjectTerminalDockState } from "../terminal/useProjectTerminalDockState";
import { remoteSessionFor } from "../../../features/connections/model/connections";

export interface SessionRecoveryActionsDeps {
  sessionRecovery: SessionRecovery | null;
  updateSessionRecovery: Dispatch<SetStateAction<SessionRecovery | null>>;
  setRecoveryOpen: Dispatch<SetStateAction<boolean>>;
  projectCwd: string;
  projectReturnRef: MutableRefObject<ProjectReturnMemory>;
  projectTerminals: ProjectTerminalDockState["projectTerminals"];
  lastDockSide: ProjectTerminalDockState["lastDockSide"];
  keepWorkspaceTab: (tab: WorkspaceTab) => boolean;
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<string>;
}

export interface SessionRecoveryActions {
  closeRecovery: () => void;
  removeRecoveredSessions: (ids: string[]) => Promise<void>;
  recoveryCount: number;
  clearRecoveredSessions: () => Promise<void>;
}

/** Dismiss, remove and clear the recovery snapshot. */
export function useSessionRecoveryActions({
  sessionRecovery,
  updateSessionRecovery,
  setRecoveryOpen,
  projectCwd,
  projectReturnRef,
  projectTerminals,
  lastDockSide,
  keepWorkspaceTab,
  lockSnapshot,
  tabsRef,
  activeTabIdRef,
}: SessionRecoveryActionsDeps): SessionRecoveryActions {
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  const failedReceipts = useRef(new Set<string | undefined>());
  const owner = useRef({});
  const refreshOwner = useRef({});
  const mounted = useRef(true);
  const latest = useRef({ projectCwd, projectTerminals, lastDockSide, keepWorkspaceTab });
  latest.current = { projectCwd, projectTerminals, lastDockSide, keepWorkspaceTab };
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Retire recovery retry handles when their workspace owner unmounts.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (getRecoverySaveFailure()?.owner === owner.current) setRecoverySaveFailure(null);
      if (getRecoverySaveFailure()?.owner === refreshOwner.current) setRecoverySaveFailure(null);
    };
  }, []);
  const saveLatest = (recoveryReceipt?: string, prepare?: () => boolean, rollback?: () => void) => {
    const write = saveTail.current
      .catch(() => undefined)
      .then(async () => {
        if (!mounted.current || (prepare && !prepare()) || workspaceSnapshotWriteBlocked()) return;
        const context = latest.current;
        try {
          await saveWorkspaceSnapshot(
            collectWorkspaceSnapshot(
              tabsRef.current,
              sessionsRef.current,
              activeTabIdRef.current,
              context.projectCwd,
              projectReturnRef.current,
              context.projectTerminals,
              context.lastDockSide ?? undefined,
              context.keepWorkspaceTab,
            ),
            recoveryReceipt,
          );
        } catch (error) {
          rollback?.();
          throw error;
        }
      });
    saveTail.current = write;
    return write;
  };
  const persistDismissal = async (recoveryReceipt?: string) => {
    if (!mounted.current || workspaceSnapshotWriteBlocked()) return;
    try {
      await saveLatest(recoveryReceipt);
      failedReceipts.current.delete(recoveryReceipt);
      if (
        mounted.current &&
        !failedReceipts.current.size &&
        getRecoverySaveFailure()?.owner === owner.current
      )
        setRecoverySaveFailure(null);
    } catch {
      failedReceipts.current.add(recoveryReceipt);
      if (
        mounted.current &&
        (!getRecoverySaveFailure() || getRecoverySaveFailure()?.owner === owner.current)
      ) {
        setRecoverySaveFailure({
          owner: owner.current,
          retry: async () => {
            // Retry a fixed batch: a repeated failure must not re-enter this iteration.
            const receipts = Array.from(failedReceipts.current);
            for (const receipt of receipts) await persistDismissal(receipt);
          },
        });
      }
    }
  };
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the native retirement listener and its retry timer while the workspace is eligible.
  useEffect(() => {
    if (!isPrimaryWorkspaceWindow() || readToolWindow()) return;
    let disposed = false;
    let running = false;
    let requested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => invoke<RetirementCandidates>("session_recovery_candidates");
    const refresh = async () => {
      if (disposed) return;
      if (running) {
        requested = true;
        return;
      }
      running = true;
      clearTimeout(timer);
      try {
        const result = await collectRetiredSessionRecovery({
          read,
          load: getSession,
          current: getSessionRecovery,
          isLocked: (cwd) => isProjectLockedIn(getGroupLockView().lock, cwd),
        });
        if (disposed) return;
        if (getRecoverySaveFailure()?.owner === refreshOwner.current) setRecoverySaveFailure(null);
        let changed = false;
        if (result.workspace) {
          const previous = getSessionRecovery();
          const next = captureSessionRecovery(previous, result.workspace);
          if (next !== previous) {
            setSessionRecovery(next);
            updateSessionRecovery(next);
            setRecoveryOpen(true);
            changed = true;
          }
        }
        // A boot journal may already contain these references. Acknowledge the
        // exact native read only with the durable current snapshot, not a later run.
        if (changed || result.receipt) await persistDismissal(result.receipt);
        if (result.pending) requested = true;
      } catch (error) {
        console.warn("Could not refresh retired conversations", error);
        if (!disposed && !getRecoverySaveFailure())
          setRecoverySaveFailure({ owner: refreshOwner.current, retry: refresh });
      } finally {
        running = false;
        if (requested && !disposed) {
          requested = false;
          timer = setTimeout(startRefresh, 1000);
        }
      }
    };
    const startRefresh = () => {
      void refresh().catch((error) => console.warn("Retirement refresh failed", error));
    };
    const unlisten = listenWindow("session-recovery-changed", startRefresh);
    startRefresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      unlisten();
    };
  }, [lockSnapshot]);
  const closeRecovery = () => {
    setRecoveryOpen(false);
    const current = getSessionRecovery();
    if (!current) return;
    const next = { ...current, dismissed: true };
    setSessionRecovery(next);
    updateSessionRecovery(next);
    void persistDismissal();
  };
  const removeRecoveredSessions = async (ids: string[]) => {
    let removal: ReturnType<typeof beginRecoveryRemoval> | undefined;
    await saveLatest(
      undefined,
      () => {
        const current = getSessionRecovery();
        if (!current) return false;
        const lock = getGroupLockView().lock;
        const unlockedIds = ids.filter((id) =>
          current.workspace.sessions.some(
            (stub) =>
              stub.id === id &&
              !isProjectLockedIn(lock, stub.cwd) &&
              (!stub.worktreeCwd || !isProjectLockedIn(lock, stub.worktreeCwd)),
          ),
        );
        if (!unlockedIds.length) return false;
        removal = beginRecoveryRemoval(current, unlockedIds);
        setSessionRecovery(removal.next);
        updateSessionRecovery(removal.next);
        // A blocked boot read still permits the list choice; only its layout write is held back.
        return true;
      },
      () => {
        if (!removal) return;
        const next = rollbackRecoveryRemoval(removal, getSessionRecovery());
        setSessionRecovery(next);
        updateSessionRecovery(next);
      },
    );
  };
  const recoveryCount = sessionRecovery
    ? eligibleRecoverySessions(
        sessionRecovery,
        sessionsRef.current,
        (cwd) => isProjectLockedIn(lockSnapshot, cwd),
        remoteSessionFor,
      ).length
    : 0;
  const clearRecoveredSessions = async () => {
    const current = getSessionRecovery();
    if (!current) return;
    await removeRecoveredSessions(current.workspace.sessions.map((stub) => stub.id));
  };
  return { closeRecovery, removeRecoveredSessions, recoveryCount, clearRecoveredSessions };
}
