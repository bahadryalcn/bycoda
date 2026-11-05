import { useRef, type MutableRefObject } from "react";
import {
  reserveSessionWindow,
  remoteSessionOwnershipKey,
} from "../../model/sessionWindowOwnership";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import {
  mergeRecoveryTabs,
  RecoveryOpenError,
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
import { remoteSessionFor } from "../../../features/connections/model/connections";
import { findRemoteSessionTab } from "../../../features/connections/model/remoteSessionNavigation";
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
  const recoveryRef = useRef(sessionRecovery);
  recoveryRef.current = sessionRecovery;
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
    // Stubs whose host session is already shown by a tab: resolved without a second shell.
    const covered = new Map<string, WorkspaceTab | undefined>();
    const openedHostSessions = new Set<string>();
    const attempted = new Set<string>();
    const held = new Map<string, NonNullable<Awaited<ReturnType<typeof reserveSessionWindow>>>>();
    const eligible = (id: string, cwd: string) =>
      !!recoveryRef.current?.workspace.sessions.some(
        (entry) => entry.id === id && sameProjectPath(entry.cwd, cwd),
      ) &&
      !removingSessionIds.current.has(id) &&
      !movingSessionIds.current.has(id) &&
      !switchingWorktrees.current.has(id) &&
      !isProjectLockedIn(getGroupLockView().lock, cwd) &&
      !isProjectLockedIn(
        getGroupLockView().lock,
        recoveryRef.current?.workspace.sessions.find((entry) => entry.id === id)?.worktreeCwd ??
          cwd,
      );
    for (const stub of sessionRecovery.workspace.sessions.filter(
      (entry) => wanted.has(entry.id) && !isProjectLockedIn(lockSnapshot, entry.cwd),
    )) {
      if (attempted.has(stub.id)) continue;
      attempted.add(stub.id);
      if (
        removingSessionIds.current.has(stub.id) ||
        movingSessionIds.current.has(stub.id) ||
        switchingWorktrees.current.has(stub.id)
      ) {
        failed.push(stub.id);
        continue;
      }
      const hostKey =
        isRemoteProjectPath(stub.cwd) && stub.remoteSessionId
          ? `${stub.cwd}|${stub.remoteSessionId}`
          : undefined;
      const existing = tabsRef.current.find((tab) => leafIds(tab.layout).includes(stub.id));
      if (
        existing &&
        sessionsRef.current.some(
          (session) => session.id === stub.id && sameProjectPath(session.cwd, stub.cwd),
        )
      ) {
        covered.set(stub.id, existing);
        continue;
      }
      if (hostKey && stub.remoteSessionId) {
        const shown = findRemoteSessionTab(
          tabsRef.current,
          sessionsRef.current,
          stub.cwd,
          stub.remoteSessionId,
          remoteSessionFor,
        );
        if (openedHostSessions.has(hostKey) || (shown && shown.shellId !== stub.id)) {
          covered.set(stub.id, shown?.tab);
          continue;
        }
      }
      try {
        const keys = [stub.id];
        if (isRemoteProjectPath(stub.cwd) && !stub.remoteSessionId) {
          failed.push(stub.id);
          continue;
        }
        if (isRemoteProjectPath(stub.cwd) && stub.remoteSessionId) {
          keys.push(remoteSessionOwnershipKey(stub.cwd, stub.remoteSessionId));
        }
        const release = await reserveSessionWindow(keys);
        if (!release) {
          if (eligible(stub.id, stub.cwd)) covered.set(stub.id, undefined);
          continue;
        }
        held.set(stub.id, release);
        if (!eligible(stub.id, stub.cwd)) continue;
        let session = await ensureOpenSession(stub.id);
        // Remote transcripts live on the host; restore the exact saved shell binding.
        if (!session && isRemoteProjectPath(stub.cwd) && stub.remoteSessionId) {
          session = restored?.sessions.find((entry) => entry.id === stub.id) ?? null;
          if (session && eligible(stub.id, stub.cwd)) {
            const next = [...sessionsRef.current, session];
            sessionsRef.current = next;
            setSessions(next);
          }
        }
        if (!session || !sameProjectPath(session.cwd, stub.cwd)) {
          failed.push(stub.id);
          continue;
        }
        if (
          !eligible(stub.id, stub.cwd) ||
          isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(session))
        )
          continue;
        opened.add(stub.id);
        if (hostKey) openedHostSessions.add(hostKey);
      } catch {
        failed.push(stub.id);
      }
    }
    for (const id of opened) {
      const stub = sessionRecovery.workspace.sessions.find((entry) => entry.id === id);
      const session = sessionsRef.current.find((entry) => entry.id === id);
      if (
        !stub ||
        !session ||
        !eligible(id, stub.cwd) ||
        isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(session))
      )
        opened.delete(id);
    }
    try {
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
      } else {
        const shown = [...covered.values()].find((tab): tab is WorkspaceTab => !!tab);
        const tab = shown && tabsRef.current.find((entry) => entry.id === shown.id);
        if (tab) {
          activeTabIdRef.current = tab.id;
          setActiveTabId(tab.id);
          const session = sessionsRef.current.find((entry) => entry.id === tab.focusedId);
          if (session) followProject(session.cwd);
        }
      }
      const resolved = [...opened, ...covered.keys()];
      if (resolved.length) {
        try {
          await removeRecoveredSessions(resolved);
        } catch {
          throw new RecoveryOpenError([...opened], [...covered.keys()], failed, true);
        }
      }
      if (failed.length) throw new RecoveryOpenError([...opened], [...covered.keys()], failed);
    } finally {
      await Promise.all(
        [...held].map(([id, release]) =>
          release(
            opened.has(id) && tabsRef.current.some((tab) => leafIds(tab.layout).includes(id)),
          ).catch((error) => console.error("Conversation ownership release failed", error)),
        ),
      );
    }
  };
  return { openRecoveredSessions };
}
