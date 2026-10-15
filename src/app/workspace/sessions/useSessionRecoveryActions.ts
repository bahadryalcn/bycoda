import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import {
  getSessionRecovery,
  removeRecoverySessions,
  setSessionRecovery,
  type SessionRecovery,
} from "../../../features/workspace/model/sessionRecovery";
import {
  collectWorkspaceSnapshot,
} from "../../../features/workspace/model/workspaceSnapshot";
import { saveWorkspaceSnapshot } from "../../../features/sessions/data/sessionStore";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import type { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import type { ProjectReturnMemory } from "../../../features/projects/model/projectReturn";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import type { ProjectTerminalDockState } from "../terminal/useProjectTerminalDockState";

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
  const closeRecovery = () => {
    setRecoveryOpen(false);
    const current = getSessionRecovery();
    if (!current) return;
    const next = { ...current, dismissed: true };
    setSessionRecovery(next);
    updateSessionRecovery(next);
    void saveWorkspaceSnapshot(
      collectWorkspaceSnapshot(
        tabsRef.current,
        sessionsRef.current,
        activeTabIdRef.current,
        projectCwd,
        projectReturnRef.current,
        projectTerminals,
        lastDockSide ?? undefined,
        keepWorkspaceTab,
      ),
    ).catch((error) => console.warn("Could not save session recovery", error));
  };
  const removeRecoveredSessions = async (ids: string[]) => {
    const current = getSessionRecovery();
    if (!current) return;
    const next = removeRecoverySessions(current, ids);
    setSessionRecovery(next);
    updateSessionRecovery(next);
    try {
      await saveWorkspaceSnapshot(
        collectWorkspaceSnapshot(
          tabsRef.current, sessionsRef.current, activeTabIdRef.current,
          projectCwd, projectReturnRef.current, projectTerminals,
          lastDockSide ?? undefined, keepWorkspaceTab,
        ),
      );
    } catch (error) {
      setSessionRecovery(current);
      updateSessionRecovery(current);
      throw error;
    }
  };
  const recoveryCount = sessionRecovery?.workspace.sessions.filter(
    (stub) => !isProjectLockedIn(lockSnapshot, stub.cwd),
  ).length ?? 0;
  const clearRecoveredSessions = async () => {
    const current = getSessionRecovery();
    if (!current) return;
    await removeRecoveredSessions(current.workspace.sessions.filter(
      (stub) => !isProjectLockedIn(getGroupLockView().lock, stub.cwd),
    ).map((stub) => stub.id));
  };
  return { closeRecovery, removeRecoveredSessions, recoveryCount, clearRecoveredSessions };
}
