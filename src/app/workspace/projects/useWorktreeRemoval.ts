import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  flushSessionWrites,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";
import { flushSessionCheckpoint, notifyReviewChanged } from "../../../features/sessions/model/checkpoint";
import { sessionChildHarnesses } from "../../../features/sessions/model/handoff";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import { rememberProject, type RecentProject } from "../../../features/projects/model/recents";
import type { ProjectTerminalDock } from "../../../features/projects/model/projectTerminal";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  bindHarnessSession,
  forgetHarnessSession,
  stopStreaming,
} from "../../../integrations/harness";
import {
  assertWorktreeFilesClosed,
  checkWorktreeRemoval,
  detachSessionWorktree,
  listWorktrees,
  removeWorktree,
  worktreeSessionIds,
} from "../../../features/source-control/model/worktrees";
import { isEqualOrInside, pathKey } from "../../../shared/lib/paths";
import { bindResumedSessions } from "../../model/appLifecycle";
import { filesInWorkspaceTabs } from "../helpers/tabHelpers";

export interface WorktreeRemovalDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  projectTerminalsRef: MutableRefObject<ProjectTerminalDock[]>;
  sessionsRef: { current: Session[] };
  projectCwdRef: MutableRefObject<string>;
  removingSessionIds: MutableRefObject<Set<string>>;
  removingWorktreePaths: MutableRefObject<Set<string>>;
  switchingWorktrees: MutableRefObject<Map<string, string>>;
  pendingPersist: MutableRefObject<Map<string, Session>>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  invalidateLoadedSession: (sessionId: string) => void;
  stopSessionForRemoval: (sessionId: string) => Promise<Session | undefined>;
  setSessions: typeof setSessions;
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  setStoredLinkedSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<RecentProject[]>>;
}

/** Guards worktree deletion: open-file checks, the native removal check, and session cleanup. */
export function useWorktreeRemoval({
  tabsRef,
  projectTerminalsRef,
  sessionsRef,
  projectCwdRef,
  removingSessionIds,
  removingWorktreePaths,
  switchingWorktrees,
  pendingPersist,
  lastPersisted,
  invalidateLoadedSession,
  stopSessionForRemoval,
  setSessions,
  setHistory,
  setStoredLinkedSessions,
  setProjectCwd,
  setRecents,
}: WorktreeRemovalDeps) {
  const checkOpenWorktreeFiles = useCallback((path: string) => {
    assertWorktreeFilesClosed(path, [
      ...filesInWorkspaceTabs(tabsRef.current),
      ...projectTerminalsRef.current.flatMap((dock) => dock.pane.files),
    ]);
  }, []);

  const onCheckWorktreeRemoval = useCallback(
    async (cwd: string, path: string, force: boolean) => {
      checkOpenWorktreeFiles(path);
      await checkWorktreeRemoval(cwd, path, force);
      // Re-read UI state after the native check, before deleting sessions.
      checkOpenWorktreeFiles(path);
    },
    [checkOpenWorktreeFiles],
  );

  const onRemoveWorktree = useCallback(
    async (cwd: string, path: string, force: boolean, keepSessions = false) => {
      if (removingWorktreePaths.current.has(path)) {
        throw new Error("This worktree is already being deleted.");
      }
      removingWorktreePaths.current.add(path);
      const lockedIds = new Set<string>();
      const forgottenIds = new Set<string>();
      try {
        if (
          [...switchingWorktrees.current.values()].some((target) => isEqualOrInside(target, path))
        ) {
          throw new Error(
            "A session is selecting this worktree. Try deleting it again once selection finishes.",
          );
        }
        await onCheckWorktreeRemoval(cwd, path, force);
        const listed = await listWorktrees(cwd);
        const tree = listed.worktrees.find((entry) => pathKey(entry.path) === pathKey(path));
        if (!tree) throw new Error("This worktree is no longer available.");
        const ids = worktreeSessionIds(tree, sessionsRef.current);
        if (!keepSessions && ids.length) {
          throw new Error("Move or delete the sessions using this worktree first.");
        }
        if (
          ids.some((id) => removingSessionIds.current.has(id) || switchingWorktrees.current.has(id))
        ) {
          throw new Error(
            "Wait for these sessions to finish changing before deleting the worktree.",
          );
        }
        for (const id of ids) {
          removingSessionIds.current.add(id);
          lockedIds.add(id);
          pendingPersist.current.delete(id);
          invalidateLoadedSession(id);
        }
        for (const id of ids) {
          await stopSessionForRemoval(id);
          const session = sessionsRef.current.find((entry) => entry.id === id);
          if (!session) continue;
          await flushSessionCheckpoint(id);
          forgottenIds.add(id);
          for (const harness of sessionChildHarnesses(session)) {
            await forgetHarnessSession(harness, id);
          }
          const latest = sessionsRef.current.find((entry) => entry.id === id);
          if (!latest) continue;
          const stopped = {
            ...stopStreaming(latest),
            busy: false,
            queueStatus: "paused" as const,
            pendingQuestion: undefined,
          };
          sessionsRef.current = sessionsRef.current.map((entry) =>
            entry.id === id ? stopped : entry,
          );
          setSessions(sessionsRef.current);
          if (shouldPersistSession(stopped)) await upsertSession(stopped);
        }
        await flushSessionWrites();
        checkOpenWorktreeFiles(path);
        const removed = await removeWorktree(cwd, path, force, keepSessions);
        const affected = new Set([...ids, ...removed.sessionIds]);
        if (isEqualOrInside(projectCwdRef.current, path)) {
          setProjectCwd(removed.projectCwd);
          setRecents(rememberProject(removed.projectCwd));
        }
        for (const id of affected) {
          invalidateLoadedSession(id);
          pendingPersist.current.delete(id);
          lastPersisted.current.delete(id);
        }
        sessionsRef.current = sessionsRef.current.map((session) =>
          affected.has(session.id)
            ? detachSessionWorktree(session, removed.projectCwd, path)
            : session,
        );
        setSessions(sessionsRef.current);
        const patchSummary = (entry: SessionSummary) =>
          affected.has(entry.id) ? detachSessionWorktree(entry, removed.projectCwd, path) : entry;
        setHistory((current) => current.map(patchSummary));
        setStoredLinkedSessions((current) => current.map(patchSummary));
        for (const id of affected) notifyReviewChanged(id);
      } catch (error) {
        // Removal may fail after idle agent processes were stopped. Rebind
        // their saved threads so the unchanged working copy can still resume.
        const kept = sessionsRef.current.filter(
          (session) => forgottenIds.has(session.id) && !session.worktreeRemoved,
        );
        bindResumedSessions(kept);
        for (const session of kept) {
          const pending = session.pendingSwitch;
          if (pending?.fromProviderSessionId) {
            bindHarnessSession(
              pending.from,
              session.id,
              pending.fromProviderSessionId,
              sessionWorkCwd(session),
              pending.fromProviderAccountId,
              session.blocks,
            );
          }
        }
        throw error;
      } finally {
        removingWorktreePaths.current.delete(path);
        for (const id of lockedIds) removingSessionIds.current.delete(id);
      }
    },
    [
      checkOpenWorktreeFiles,
      invalidateLoadedSession,
      onCheckWorktreeRemoval,
      stopSessionForRemoval,
    ],
  );

  return { checkOpenWorktreeFiles, onCheckWorktreeRemoval, onRemoveWorktree };
}
