import type { MutableRefObject } from "react";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import type { Session } from "../../../features/sessions/model/session";
import {
  mergeRecoveryTabs,
  sessionRecoveryTabs,
  type SessionRecovery,
} from "../../../features/workspace/model/sessionRecovery";
import { hydrateWorkspaceSnapshot } from "../../../features/workspace/model/workspaceSnapshot";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import type { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import { leafIds, newTab } from "../../../features/workspace/model/layout";
import { isRemoteProjectPath, sameProjectPath } from "../../../features/projects/model/recents";
import type { useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";

export interface OpenRecoveredSessionsDeps {
  sessionRecovery: SessionRecovery | null;
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
  removingSessionIds: MutableRefObject<Set<string>>;
  movingSessionIds: MutableRefObject<Set<string>>;
  switchingWorktrees: MutableRefObject<Map<string, string>>;
  workspaceNavigation: ReturnType<typeof useWorkspaceNavigation>;
  ensureOpenSession: (sessionId: string) => Promise<Session | null>;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  activeTabIdRef: MutableRefObject<string>;
  setActiveTabId: (id: string) => void;
  followProject: (cwd: string) => void;
  removeRecoveredSessions: (ids: string[]) => Promise<void>;
}

export interface OpenRecoveredSessions {
  openRecoveredSessions: (ids: string[], restoreLayout: boolean) => Promise<void>;
}

/** Re-opens the chosen recovered sessions and restores their saved tab layout. */
export function useOpenRecoveredSessions({
  sessionRecovery,
  lockSnapshot,
  removingSessionIds,
  movingSessionIds,
  switchingWorktrees,
  workspaceNavigation,
  ensureOpenSession,
  tabsRef,
  setTabs,
  activeTabIdRef,
  setActiveTabId,
  followProject,
  removeRecoveredSessions,
}: OpenRecoveredSessionsDeps): OpenRecoveredSessions {
  const openRecoveredSessions = async (ids: string[], restoreLayout: boolean) => {
    if (!sessionRecovery) return;
    workspaceNavigation.cancel();
    const wanted = new Set(ids);
    const recoveryTabs = sessionRecoveryTabs(sessionRecovery.workspace.tabs, wanted);
    const restored = hydrateWorkspaceSnapshot(
      { ...sessionRecovery.workspace, tabs: recoveryTabs },
      new Map(),
    );
    const failed: string[] = [];
    const opened = new Set<string>();
    for (const stub of sessionRecovery.workspace.sessions.filter(
      (entry) => wanted.has(entry.id) && !isProjectLockedIn(lockSnapshot, entry.cwd),
    )) {
      if (
        removingSessionIds.current.has(stub.id) ||
        movingSessionIds.current.has(stub.id) ||
        switchingWorktrees.current.has(stub.id)
      ) {
        failed.push(stub.id);
        continue;
      }
      try {
        let session = await ensureOpenSession(stub.id);
        // Remote transcripts live on the host; restore the exact saved shell binding.
        if (!session && isRemoteProjectPath(stub.cwd) && stub.remoteSessionId) {
          session = restored?.sessions.find((entry) => entry.id === stub.id) ?? null;
          if (session) {
            const next = [...sessionsRef.current, session];
            sessionsRef.current = next;
            setSessions(next);
          }
        }
        if (!session || !sameProjectPath(session.cwd, stub.cwd)) {
          failed.push(stub.id);
          continue;
        }
        if (isProjectLockedIn(getGroupLockView().lock, stub.cwd)) continue;
        opened.add(stub.id);
      } catch {
        failed.push(stub.id);
      }
    }
    if (opened.size) {
      const previousTabs = restoreLayout
        ? sessionRecoveryTabs(sessionRecovery.workspace.tabs, opened)
        : [...opened].map((id) => newTab(id));
      const covered = new Set(previousTabs.flatMap((tab) => leafIds(tab.layout)));
      for (const id of opened) if (!covered.has(id)) previousTabs.push(newTab(id));
      const next = mergeRecoveryTabs(tabsRef.current, previousTabs);
      tabsRef.current = next;
      setTabs(next);
      const previousFocus = sessionRecovery.workspace.tabs.find(
        (tab) => tab.id === sessionRecovery.workspace.activeTabId,
      )?.focusedId;
      const target =
        (previousFocus && opened.has(previousFocus)
          ? next.find((tab) => leafIds(tab.layout).includes(previousFocus))
          : undefined) ?? next.find((tab) => leafIds(tab.layout).some((id) => opened.has(id)));
      if (target) {
        activeTabIdRef.current = target.id;
        setActiveTabId(target.id);
        const session = sessionsRef.current.find((entry) => entry.id === target.focusedId);
        if (session) followProject(session.cwd);
      }
      await removeRecoveredSessions([...opened]);
    }
    if (failed.length) throw new Error("Recovery sessions unavailable");
  };
  return { openRecoveredSessions };
}
