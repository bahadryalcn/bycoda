import { useEffect, useRef, type MutableRefObject } from "react";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import {
  focusedFileTab,
  leafIds,
  type FilePaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  isRemoteProjectPath,
  normalizeProjectPath,
  sameProjectPath,
} from "../../../features/projects/model/recents";
import { workspaceTabCwd } from "../../../features/workspace/model/workspaceTabGroups";
import { reportBootProjectState } from "../../model/bootDiagnostics";
import { newTerminalCwd } from "../../../features/terminal/model/terminalTab";
import { remoteTabCwd } from "../../../features/connections/model/connections";
import {
  remotePath,
  remoteProjectFor,
  remoteSessionGitCwd,
} from "../../../features/connections/model/remoteProjects";

export interface ActiveWorkspaceContextDeps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  sessions: Session[];
  projectCwd: string;
  historyErrorCwd: string | null;
  loadedProjects: ReadonlySet<string>;
}

export interface ActiveWorkspaceContext {
  activeTab: WorkspaceTab | undefined;
  active: Session | undefined;
  activeFile: FilePaneTab | undefined;
  sidebarCwd: string;
  sidebarCwdRef: MutableRefObject<string>;
  sidebarCwdKey: string | null;
  historyFailed: boolean;
  historyPending: boolean;
  gitCwd: string;
  terminalCwd: string;
  filesCwd: string;
  gitCwdRef: MutableRefObject<string>;
}

/** Derives the active tab, active session and the cwd values that follow
 * from them. Pure derivation plus two render-synced refs; the only effect is
 * the boot diagnostic that logs the active tab and project. */
export function useActiveWorkspaceContext(
  deps: ActiveWorkspaceContextDeps,
): ActiveWorkspaceContext {
  const { tabs, activeTabId, sessions, projectCwd, historyErrorCwd, loadedProjects } = deps;
  // A stale id falls back to a tab of the project on screen before any other
  // project's tab, so losing the active tab never switches projects.
  const activeTab =
    tabs.find((t) => t.id === activeTabId) ??
    tabs.find((t) => {
      const cwd = workspaceTabCwd(t, sessions);
      return cwd !== null && sameProjectPath(cwd, projectCwd);
    }) ??
    tabs[0];
  const active =
    sessions.find((session) => session.id === activeTab?.focusedId) ??
    sessions.find((session) => activeTab && leafIds(activeTab.layout).includes(session.id));
  const activeFile = activeTab ? focusedFileTab(activeTab) : undefined;
  const workspaceFile = activeFile?.external ? undefined : activeFile;
  const sidebarCwd = workspaceFile?.projectCwd ?? workspaceFile?.cwd ?? active?.cwd ?? projectCwd;
  const sidebarCwdRef = useRef(sidebarCwd);
  sidebarCwdRef.current = sidebarCwd;
  const reportedTabId = activeTab?.id ?? activeTabId;
  useEffect(() => {
    reportBootProjectState({ activeTabId: reportedTabId, projectCwd, sidebarCwd });
  }, [reportedTabId, projectCwd, sidebarCwd]);
  const sidebarCwdKey = sidebarCwd && sidebarCwd !== "~" ? normalizeProjectPath(sidebarCwd) : null;
  const historyFailed = sidebarCwdKey != null && historyErrorCwd === sidebarCwdKey;
  // True from the very first frame that shows a project we have never listed,
  // so the sidebar can stay blank instead of flashing "No sessions yet".
  const historyPending =
    sidebarCwdKey != null && !loadedProjects.has(sidebarCwdKey) && !historyFailed;
  const gitCwd = workspaceFile?.cwd ?? (active ? sessionWorkCwd(active) : sidebarCwd);
  const terminalCwd = newTerminalCwd({
    activeFile: workspaceFile,
    session: active,
    fallback: sidebarCwd,
  });
  const remoteFilesProject = remoteProjectFor(sidebarCwd);
  const remoteCheckout = remoteFilesProject ? remoteTabCwd(sidebarCwd, active?.id) : undefined;
  const filesCwd = remoteFilesProject
    ? isRemoteProjectPath(gitCwd)
      ? gitCwd
      : remotePath(
          remoteFilesProject.environmentId,
          remoteCheckout ?? (gitCwd && gitCwd !== sidebarCwd ? gitCwd : remoteFilesProject.cwd),
        )
    : gitCwd;
  const gitRootCwd = remoteFilesProject
    ? remoteSessionGitCwd(remoteFilesProject, gitCwd, sidebarCwd, remoteCheckout)
    : gitCwd;
  const gitCwdRef = useRef(gitRootCwd);
  gitCwdRef.current = gitRootCwd;

  return {
    activeTab,
    active,
    activeFile,
    sidebarCwd,
    sidebarCwdRef,
    sidebarCwdKey,
    historyFailed,
    historyPending,
    gitCwd,
    terminalCwd,
    filesCwd,
    gitCwdRef,
  };
}
