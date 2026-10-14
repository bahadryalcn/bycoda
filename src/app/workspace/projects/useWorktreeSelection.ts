import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  sessionWorkCwd,
  type Session,
} from "../../../features/sessions/model/session";
import { isBlankSession } from "../../../features/projects/model/projectReturn";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import {
  listWorktrees,
  sessionInWorktree,
  type Worktree,
} from "../../../features/source-control/model/worktrees";
import { isEqualOrInside, pathKey } from "../../../shared/lib/paths";
import {
  flushSessionCheckpoint,
  keepSessionChanges,
  notifyReviewChanged,
} from "../../../features/sessions/model/checkpoint";
import { sessionChildHarnesses } from "../../../features/sessions/model/handoff";
import { forgetHarnessSession } from "../../../integrations/harness";
import { shouldPersistSession, upsertSession } from "../../../features/sessions/data/sessionStore";
import { notifyGitChanged } from "../../../platform/tauri/fs";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { currentWorkspace } from "../helpers/appHelpers";

export interface WorktreeSelectionDeps {
  sessionsRef: { current: Session[] };
  removingSessionIds: MutableRefObject<Set<string>>;
  removingWorktreePaths: MutableRefObject<Set<string>>;
  switchingWorktrees: MutableRefObject<Map<string, string>>;
  pendingPersist: MutableRefObject<Map<string, Session>>;
  workspacePins: MutableRefObject<Map<string, string>>;
  invalidateLoadedSession: (sessionId: string) => void;
  refreshHistory: (cwd: string) => Promise<void>;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setSessions: typeof setSessions;
}

/** Switches a session to another working copy of its project, or opens that copy in a new tab. */
export function useWorktreeSelection({
  sessionsRef,
  removingSessionIds,
  removingWorktreePaths,
  switchingWorktrees,
  pendingPersist,
  workspacePins,
  invalidateLoadedSession,
  refreshHistory,
  appendTab,
  setActiveTabId,
  setComposerFocused,
  setSessions,
}: WorktreeSelectionDeps) {
  const onWorktreeChange = useCallback(
    async (
      sessionId: string,
      tree: Worktree,
      fromComposer = false,
      isCurrent: () => boolean = () => true,
    ) => {
      if (!isCurrent()) return;
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (
        !current ||
        current.busy ||
        removingSessionIds.current.has(sessionId) ||
        switchingWorktrees.current.has(sessionId)
      ) {
        throw new Error("Wait for this session to finish before changing working copies.");
      }
      if (!current.worktreeRemoved && pathKey(sessionWorkCwd(current)) === pathKey(tree.path))
        return;
      if ([...removingWorktreePaths.current].some((path) => isEqualOrInside(tree.path, path))) {
        throw new Error("This worktree is being deleted. Select another working copy.");
      }
      if (!current.worktreeRemoved && current.queuedMessages?.length) {
        throw new Error("Clear queued messages before changing working copies.");
      }
      const run = orchestrator.forSession(sessionId);
      if (run && ["active", "paused"].includes(run.status)) {
        throw new Error("Stop this orchestration run before changing working copies.");
      }
      switchingWorktrees.current.set(sessionId, tree.path);
      pendingPersist.current.delete(sessionId);
      try {
        const listed = await listWorktrees(current.cwd);
        if (!isCurrent()) return;
        const target = listed.worktrees.find(
          (entry) => pathKey(entry.path) === pathKey(tree.path) && !entry.missing,
        );
        if (!target) {
          throw new Error("This worktree is no longer available. Refresh the picker.");
        }
        const source = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !source ||
          source.busy ||
          source.cwd !== current.cwd ||
          sessionWorkCwd(source) !== sessionWorkCwd(current)
        ) {
          throw new Error("The session changed. Try selecting the working copy again.");
        }
        const selected = sessionInWorktree(source, target);
        if (selected.id !== sessionId) {
          // Leave the original conversation, checkpoints, and live provider
          // context attached to the files they describe.
          const tab = newTab(selected.id);
          if (fromComposer) workspacePins.current.set(selected.id, currentWorkspace(source.cwd));
          sessionsRef.current = [...sessionsRef.current, selected];
          setSessions(sessionsRef.current);
          appendTab(tab, selected.cwd);
          setActiveTabId(tab.id);
          setComposerFocused(true);
          return;
        }
        await flushSessionCheckpoint(sessionId);
        if (!isCurrent()) return;
        for (const harness of sessionChildHarnesses(source)) {
          await forgetHarnessSession(harness, sessionId);
          if (!isCurrent()) return;
        }
        const latest = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !latest ||
          (!latest.worktreeRemoved && !isBlankSession(latest)) ||
          latest.cwd !== current.cwd ||
          sessionWorkCwd(latest) !== sessionWorkCwd(current)
        ) {
          throw new Error("The session changed. Try selecting the working copy again.");
        }
        const next = sessionInWorktree(latest, target);
        if (fromComposer) workspacePins.current.set(sessionId, currentWorkspace(latest.cwd));
        else workspacePins.current.delete(sessionId);
        if (latest.worktreeRemoved) await keepSessionChanges(sessionId, target.path);
        pendingPersist.current.delete(sessionId);
        if (shouldPersistSession(next)) await upsertSession(next);
        if (!isCurrent()) return;
        invalidateLoadedSession(sessionId);
        sessionsRef.current = sessionsRef.current.map((s) => (s.id === sessionId ? next : s));
        setSessions(sessionsRef.current);
        notifyGitChanged();
        notifyReviewChanged(sessionId);
        void refreshHistory(next.cwd);
      } finally {
        switchingWorktrees.current.delete(sessionId);
      }
    },
    [appendTab, invalidateLoadedSession, refreshHistory, setActiveTabId],
  );

  const onComposerWorktreeChange = useCallback(
    (sessionId: string, tree: Worktree) => onWorktreeChange(sessionId, tree, true),
    [onWorktreeChange],
  );

  return { onWorktreeChange, onComposerWorktreeChange };
}
