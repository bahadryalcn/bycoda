import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  newSession,
  retargetSessionToProject,
  type Session,
  type WorkspaceMode,
} from "../../../features/sessions/model/session";
import { isBlankSession } from "../../../features/projects/model/projectReturn";
import {
  looksLikeProject,
  normalizeProjectPath,
  rememberProject,
  sameProjectPath,
  type RecentProject,
} from "../../../features/projects/model/recents";
import {
  leafIds,
  neighborLeafId,
  newTab,
  setSplitRatio,
  type FocusDir,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { removeTabFromGroup, tabGroupProject } from "../../../features/workspace/model/tabGroups";
import {
  keepSessionChanges,
  notifyReviewChanged,
} from "../../../features/sessions/model/checkpoint";
import { notifyGitChanged } from "../../../platform/tauri/fs";
import { forgetHarnessSession } from "../../../integrations/harness";
import { projectName } from "../../../shared/lib/paths";
import type { WorktreeFocus } from "../../../features/source-control/model/worktreeFocus";

export interface WorkspaceDirectoryActionsDeps {
  activeTab: WorkspaceTab | undefined;
  onFocusPane: (paneId: string) => void;
  windowTransferPendingRef: MutableRefObject<boolean>;
  movingTabIds: MutableRefObject<Set<string>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  sessionsRef: { current: Session[] };
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<RecentProject[]>>;
  setSessions: typeof setSessions;
  projectOfTab: (id: string) => string | undefined;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  persistSession: (session: Session | undefined) => void;
  sidebarCwdRef: MutableRefObject<string>;
  workspaceNavigation: { selectWorkspace: (project: string, focus?: WorktreeFocus) => void };
}

/** Pane focus, split ratios, and the cwd, branch, and workspace-mode changes made from a session. */
export function useWorkspaceDirectoryActions({
  activeTab,
  onFocusPane,
  windowTransferPendingRef,
  movingTabIds,
  setTabs,
  sessionsRef,
  setProjectCwd,
  setRecents,
  setSessions,
  projectOfTab,
  appendTab,
  setActiveTabId,
  setComposerFocused,
  persistSession,
  sidebarCwdRef,
  workspaceNavigation,
}: WorkspaceDirectoryActionsDeps) {
  const onFocusDir = useCallback(
    (dir: FocusDir) => {
      if (!activeTab) return;
      const next = neighborLeafId(activeTab.layout, activeTab.focusedId, dir);
      if (next) onFocusPane(next);
    },
    [activeTab, onFocusPane],
  );

  const onRatio = useCallback((tabId: string, splitId: string, index: number, ratio: number) => {
    if (windowTransferPendingRef.current || movingTabIds.current.has(tabId)) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, layout: setSplitRatio(t.layout, splitId, index, ratio) } : t,
      ),
    );
  }, []);

  const onCwdChange = useCallback(
    (sessionId: string, cwd: string) => {
      const normalized = normalizeProjectPath(cwd);
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      const previous = current?.cwd;
      // Threads stay bound to their project. Switching from the composer opens a
      // new tab instead of retargeting the conversation.
      if (
        current &&
        previous &&
        looksLikeProject(previous) &&
        !sameProjectPath(previous, normalized) &&
        !isBlankSession(current)
      ) {
        setProjectCwd(normalized);
        setRecents(rememberProject(normalized));
        const session = newSession(
          current.harness,
          normalized,
          current.model,
          current.runtimeMode,
          current.modelSettings,
        );
        const tab = newTab(session.id);
        setSessions((prev) => [...prev, session]);
        appendTab(tab, normalized);
        setActiveTabId(tab.id);
        setComposerFocused(true);
        return;
      }
      if (previous && !sameProjectPath(previous, normalized) && previous !== "~") {
        void keepSessionChanges(sessionId, previous).catch((error) => {
          console.warn("App operation failed", error);
        });
      }
      setProjectCwd(normalized);
      setRecents(rememberProject(normalized));
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          // A blank session moving into a project adopts its provider defaults;
          // a conversation keeps its own provider.
          const base = isBlankSession(s) ? retargetSessionToProject(s, normalized) : s;
          return {
            ...base,
            cwd: normalized,
            branch: undefined,
            worktreeCwd: undefined,
            worktreeRemoved: undefined,
            workspaceMode: undefined,
            worktreeBase: undefined,
          };
        }),
      );
      // The session's project just moved in place; a group only holds tabs that
      // share one project, so drop this tab out if it no longer matches.
      setTabs((prev) => {
        const tab = prev.find((t) => leafIds(t.layout).includes(sessionId));
        // The tab's visible project follows its focused pane; a background
        // pane changing project doesn't change what the group check should see.
        if (!tab?.groupId || tab.focusedId !== sessionId) return prev;
        const newProject = projectName(normalized);
        const othersProject = tabGroupProject(
          prev.filter((t) => t.id !== tab.id),
          tab.groupId,
          projectOfTab,
        );
        if (othersProject && newProject && othersProject !== newProject) {
          return removeTabFromGroup(prev, tab.id);
        }
        return prev;
      });
      notifyReviewChanged(sessionId);
    },
    [appendTab, projectOfTab],
  );

  const onBranchChange = useCallback(
    (sessionId: string) => {
      notifyGitChanged();
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      void forgetHarnessSession(current.harness, sessionId);
      const next = {
        ...current,
        branch: undefined,
        providerSessionId: undefined,
        context: undefined,
      };
      sessionsRef.current = sessionsRef.current.map((s) => (s.id === sessionId ? next : s));
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? next : s)));
      persistSession(next);
      notifyReviewChanged(sessionId);
    },
    [persistSession],
  );

  const onWorkspaceModeChange = useCallback(
    (sessionId: string, mode: WorkspaceMode, base?: string) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (
            session.id !== sessionId ||
            (!isBlankSession(session) &&
              !(session.workspaceMode && !session.worktreeCwd && !session.busy))
          ) {
            return session;
          }
          return mode === "worktree"
            ? base || session.worktreeBase
              ? {
                  ...session,
                  workspaceMode: "worktree",
                  worktreeBase: base || session.worktreeBase,
                }
              : session
            : {
                ...session,
                workspaceMode: undefined,
                worktreeBase: undefined,
              };
        }),
      );
    },
    [],
  );

  const onWorktreeBaseChange = useCallback((sessionId: string, base: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId &&
        (isBlankSession(session) ||
          (!!session.workspaceMode && !session.worktreeCwd && !session.busy)) &&
        session.workspaceMode === "worktree"
          ? { ...session, worktreeBase: base }
          : session,
      ),
    );
  }, []);
  const onSelectWorkspace = useCallback(
    (focus?: WorktreeFocus) => {
      setProjectCwd(sidebarCwdRef.current);
      workspaceNavigation.selectWorkspace(sidebarCwdRef.current, focus);
    },
    [workspaceNavigation.selectWorkspace],
  );

  return {
    onFocusDir,
    onRatio,
    onCwdChange,
    onBranchChange,
    onWorkspaceModeChange,
    onWorktreeBaseChange,
    onSelectWorkspace,
  };
}
