import { useMemo, useRef } from "react";
import { worktreeTabStatsEqual } from "../../model/sidebarEquality";
import { type Session } from "../../../features/sessions/model/session";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { filterTabsForProject, isExternalFileWorkspaceTab, workspaceTabCwd } from "../../../features/workspace/model/workspaceTabGroups";
import { isRemoteProjectPath, sameProjectPath } from "../../../features/projects/model/recents";
import { pathKey } from "../../../shared/lib/paths";
import type { useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";
import type { useWorktreeFocus } from "../../../features/source-control/model/worktreeFocus";
import type { useWorkspacePins } from "../state/useWorkspacePins";

export interface WorktreeDeckTabsDeps {
  tabs: WorkspaceTab[];
  sessions: Session[];
  sidebarCwd: string;
  projectCwd: string;
  activeTabId: string;
  projectWorktree: ReturnType<typeof useWorktreeFocus>;
  tabWorkspace: ReturnType<typeof useWorkspacePins>["tabWorkspace"];
  workspaceNavigation: Pick<ReturnType<typeof useWorkspaceNavigation>, "revision">;
}

export function useWorktreeDeckTabs({
  tabs,
  sessions,
  sidebarCwd,
  projectCwd,
  activeTabId,
  projectWorktree,
  tabWorkspace,
  workspaceNavigation,
}: WorktreeDeckTabsDeps) {
  /** Open tabs per workspace in the sidebar's project, keyed by worktree
   * path, so the switcher can show what each worktree still has open. */
  const nextWorktreeTabStats = useMemo(() => {
    const stats = new Map<string, { tabs: number; busy: boolean }>();
    if (!sidebarCwd || sidebarCwd === "~" || isRemoteProjectPath(sidebarCwd)) return stats;
    for (const tab of filterTabsForProject(tabs, sessions, sidebarCwd)) {
      const workspace = tabWorkspace(tab, sessions) ?? sidebarCwd;
      const key = pathKey(workspace);
      const entry = stats.get(key) ?? { tabs: 0, busy: false };
      entry.tabs += 1;
      entry.busy ||= leafIds(tab.layout).some(
        (id) => sessions.find((session) => session.id === id)?.busy,
      );
      stats.set(key, entry);
    }
    return stats;
  }, [tabs, sessions, sidebarCwd, tabWorkspace, workspaceNavigation.revision]);
  const worktreeTabStatsRef = useRef(nextWorktreeTabStats);
  if (!worktreeTabStatsEqual(worktreeTabStatsRef.current, nextWorktreeTabStats)) {
    worktreeTabStatsRef.current = nextWorktreeTabStats;
  }
  const worktreeTabStats = worktreeTabStatsRef.current;

  const deckProjectTabs = useMemo(() => {
    // A projectless session belongs to no project, so it stands on its own
    // rather than trailing the last project's tabs.
    const active = tabs.find((tab) => tab.id === activeTabId);
    if (active && !isExternalFileWorkspaceTab(active) && !workspaceTabCwd(active, sessions)) {
      return [active];
    }
    // Each worktree keeps its own tabs; the others stay open, just hidden.
    const worktree = projectWorktree?.path ?? projectCwd;
    const projectTabs = new Set(filterTabsForProject(tabs, sessions, projectCwd));
    return tabs.filter((tab) => isExternalFileWorkspaceTab(tab) || projectTabs.has(tab)).filter((tab) => {
      if (tab.id === activeTabId) return true;
      const workspace = tabWorkspace(tab, sessions);
      return !workspace || sameProjectPath(workspace, worktree);
    });
  }, [
    activeTabId,
    tabs,
    sessions,
    projectCwd,
    projectWorktree?.path,
    tabWorkspace,
    workspaceNavigation.revision,
  ]);

  return { worktreeTabStats, deckProjectTabs };
}
