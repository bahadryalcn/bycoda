import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { loadDiffViewer } from "../../../features/settings/model/settings";
import { rememberOpenedFile, resolveOpenablePath } from "../../../features/files/model/fileIndex";
import {
  newFileTab,
  openChangesTab,
  openCommitTab,
  openEditorTab,
  openSessionChangesTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import type { GitFileDiffKind, GitHistoryCommit } from "../../../platform/tauri/fs";
import type { SidebarTabId } from "../../../features/settings/model/appearance";
import type { Session } from "../../../features/sessions/model/session";

export interface SourceControlSurfacesDeps {
  activeTabId: string;
  gitCwdRef: MutableRefObject<string>;
  sidebarCwdRef: MutableRefObject<string>;
  sessionsRef: MutableRefObject<Session[]>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
}

export interface SourceControlSurfaces {
  onOpenDiff: (
    path?: string,
    session?: { sessionId: string; cwd: string },
    changeKind?: GitFileDiffKind,
    pin?: boolean,
    exact?: boolean,
    checkout?: { cwd: string; projectCwd: string },
  ) => void;
  onOpenWorkingTreeDiff: (path: string, kind?: GitFileDiffKind, pin?: boolean) => void;
  onOpenAllChanges: (kind: GitFileDiffKind, repositoryCwd?: string) => void;
  onOpenCommit: (commit: GitHistoryCommit, pin?: boolean, repositoryCwd?: string) => void;
  onShowSourceControl: () => void;
  onToggleChanges: () => void;
}

/** Opens diffs, all-changes reviews and commits in the active tab, and shows the Changes sidebar. */
export function useSourceControlSurfaces(deps: SourceControlSurfacesDeps): SourceControlSurfaces {
  const {
    activeTabId,
    gitCwdRef,
    sidebarCwdRef,
    sessionsRef,
    setTabs,
    setComposerFocused,
    setSidebarTab,
  } = deps;

  const onOpenDiff = useCallback(
    (
      path?: string,
      session?: { sessionId: string; cwd: string },
      changeKind?: GitFileDiffKind,
      pin = false,
      exact = false,
      checkout?: { cwd: string; projectCwd: string },
    ) => {
      const diffCwd = checkout?.cwd ?? session?.cwd ?? gitCwdRef.current;
      const diffProjectCwd = session
        ? sessionsRef.current.find((entry) => entry.id === session.sessionId)?.cwd
        : (checkout?.projectCwd ?? sidebarCwdRef.current);
      const open = (resolved: string | undefined) => {
        if (resolved) rememberOpenedFile(diffCwd, resolved);
        setTabs((prev) =>
          prev.map((tab) => {
            if (tab.id !== activeTabId) return tab;
            if (session) {
              return openSessionChangesTab(
                tab,
                session.cwd,
                session.sessionId,
                resolved,
                diffProjectCwd,
                pin,
              );
            }
            if (loadDiffViewer() === "unified") {
              return openChangesTab(tab, diffCwd, resolved, changeKind, diffProjectCwd);
            }
            if (!resolved) return tab;
            return openEditorTab(
              tab,
              newFileTab(resolved, diffCwd, true, changeKind, diffProjectCwd),
              { pin },
            );
          }),
        );
        setSidebarTab("changes", diffProjectCwd);
        setComposerFocused(false);
      };
      // Source control hands over exact paths from git. Only shortened paths
      // (a transcript link, a session file) need the project file index, and
      // waiting on it here held the click until the whole project was listed.
      if (!path || exact) {
        open(path);
        return;
      }
      void resolveOpenablePath(diffCwd, path).then((resolved) => open(resolved ?? path));
    },
    [activeTabId],
  );

  const onOpenWorkingTreeDiff = useCallback(
    (path: string, kind?: GitFileDiffKind, pin?: boolean) =>
      onOpenDiff(path, undefined, kind, pin, true),
    [onOpenDiff],
  );

  /** Stack one section's working-tree changes in one review, whatever the diff-view setting. */
  const onOpenAllChanges = useCallback(
    (kind: GitFileDiffKind, repositoryCwd?: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? openChangesTab(
                tab,
                repositoryCwd ?? gitCwdRef.current,
                undefined,
                kind,
                sidebarCwdRef.current,
              )
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

  const onOpenCommit = useCallback(
    (commit: GitHistoryCommit, pin?: boolean, repositoryCwd?: string) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? openCommitTab(
                tab,
                repositoryCwd ?? gitCwdRef.current,
                {
                  sha: commit.sha,
                  shortSha: commit.shortSha,
                  subject: commit.subject,
                },
                sidebarCwdRef.current,
                pin,
              )
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

  const onShowSourceControl = useCallback(() => {
    setSidebarTab("changes");
  }, []);

  const onToggleChanges = useCallback(() => {
    onShowSourceControl();
  }, [onShowSourceControl]);

  return {
    onOpenDiff,
    onOpenWorkingTreeDiff,
    onOpenAllChanges,
    onOpenCommit,
    onShowSourceControl,
    onToggleChanges,
  };
}
