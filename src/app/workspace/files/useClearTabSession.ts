import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { isRemoteProjectPath, sameProjectPath } from "../../../features/projects/model/recents";
import {
  isFilesystemTab,
  leaf,
  leafIds,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { worktreeFocus } from "../../../features/source-control/model/worktreeFocus";
import { confirmDiscardUnsaved } from "../helpers/appHelpers";
import { isBlankWorkspaceTab } from "../helpers/tabHelpers";

export interface ClearTabSessionDeps {
  tabs: WorkspaceTab[];
  tabWorkspace: (tab: WorkspaceTab, list: readonly Session[]) => string | null | undefined;
  windowTransferPendingRef: MutableRefObject<boolean>;
  movingTabIds: MutableRefObject<Set<string>>;
  sessionsRef: MutableRefObject<Session[]>;
  dirtyFilesRef: MutableRefObject<Set<string>>;
  persistSession: (session: Session | undefined) => void;
  rememberRemoteSession: (id: string) => void;
  rememberRemotePendingWorktree: (id: string) => void;
  refreshHistory: (cwd: string) => Promise<unknown>;
  sidebarCwd: string;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
}

/** Replaces a tab's conversation with a blank session and drops its open files. */
export function useClearTabSession(deps: ClearTabSessionDeps): {
  onClearTabSession: (id: string) => void;
} {
  const {
    tabs,
    tabWorkspace,
    windowTransferPendingRef,
    movingTabIds,
    sessionsRef,
    dirtyFilesRef,
    persistSession,
    rememberRemoteSession,
    rememberRemotePendingWorktree,
    refreshHistory,
    sidebarCwd,
    setSessions,
    setDirtyFiles,
    setTabs,
    setComposerFocused,
  } = deps;

  const onClearTabSession = useCallback(
    (id: string) => {
      if (windowTransferPendingRef.current || movingTabIds.current.has(id)) return;
      const tab = tabs.find((entry) => entry.id === id);
      if (!tab || isBlankWorkspaceTab(tab, sessionsRef.current)) return;

      const closingFiles = [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ];
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );

      const oldSessionId = leafIds(tab.layout).find((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      const oldSession = sessionsRef.current.find((session) => session.id === oldSessionId);
      if (!oldSession) return;

      const finishClear = () => {
        persistSession(oldSession);
        for (const shellId of leafIds(tab.layout)) {
          rememberRemoteSession(shellId);
          rememberRemotePendingWorktree(shellId);
        }

        // The blank replacement stays in the tab's worktree, so clearing the
        // last tab there does not switch the workspace back to the project.
        const workspace = tabWorkspace(tab, sessionsRef.current);
        const focus = worktreeFocus(oldSession.cwd);
        const session = {
          ...newSession(
            oldSession.harness,
            oldSession.cwd,
            oldSession.model,
            oldSession.runtimeMode,
            oldSession.modelSettings,
          ),
          ...(workspace &&
          !isRemoteProjectPath(oldSession.cwd) &&
          !sameProjectPath(workspace, oldSession.cwd)
            ? {
                worktreeCwd: workspace,
                branch:
                  (focus && sameProjectPath(focus.path, workspace) ? focus.branch : undefined) ??
                  (oldSession.worktreeCwd && sameProjectPath(oldSession.worktreeCwd, workspace)
                    ? oldSession.branch
                    : undefined) ??
                  undefined,
              }
            : {}),
        };

        setSessions((prev) => [...prev, session]);
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of closingFiles) updated.delete(file.id);
          return updated;
        });
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  layout: leaf(session.id),
                  focusedId: session.id,
                  editorPanes: [],
                  terminalPanes: [],
                  diffOpen: false,
                  diffFocused: false,
                }
              : entry,
          ),
        );
        setComposerFocused(true);
        void refreshHistory(sidebarCwd);
      };

      if (unsaved.length === 0) {
        finishClear();
        return;
      }
      void confirmDiscardUnsaved("Close this conversation with unsaved files?").then(
        (ok) => ok && finishClear(),
      );
    },
    [tabs, persistSession, refreshHistory, sidebarCwd],
  );

  return { onClearTabSession };
}
