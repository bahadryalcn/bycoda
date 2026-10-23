import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Session } from "../../../features/sessions/model/session";
import type { LinkedSessionUpdate } from "../../../features/inbox/model/linkedSessionUpdates";
import { isFilesystemTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { switchSessionInTab } from "../../../features/workspace/model/workspaceTabGroups";
import { adjacentItemId } from "../../../features/workspace/model/tabKeys";
import {
  isRemoteProjectPath,
  loadRecents,
  normalizeProjectPath,
  projectRailItems,
  sameProjectPath,
} from "../../../features/projects/model/recents";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { visibleProjects } from "../../../features/group-lock/model/lockState";
import {
  remoteSessionFor,
  rememberRemoteSession,
} from "../../../features/connections/model/connections";
import { remoteCreateShellFor } from "../../../features/connections/model/remoteCreateIntent";
import { resolveRemoteSessionTarget } from "../../../features/connections/model/remoteSessionNavigation";

export interface ListNavigationDeps {
  tabs: WorkspaceTab[];
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<string>;
  sessionsRef: MutableRefObject<Session[]>;
  sessionNavigationIdsRef: MutableRefObject<readonly string[]>;
  projectCwdRef: MutableRefObject<string>;
  linkedSessionUpdatesRef: MutableRefObject<ReadonlyMap<string, LinkedSessionUpdate>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  ensureOpenSession: (sessionId: string) => Promise<Session | null>;
  onPrefetchHistorySession: (sessionId: string) => void;
  onSelectHistorySession: (sessionId: string) => Promise<unknown>;
  onSelectRemoteSession: (project: string, remoteSessionId: string) => void;
  revealLinkedSessionUpdate: (sessionId: string, update: LinkedSessionUpdate) => void;
  onSelectProject: (path: string) => void;
}

export interface ListNavigation {
  openFilePaths: string[];
  onSessionNavigationOrder: (ids: readonly string[]) => void;
  onNavigateSessionList: (delta: number, inCurrentTab?: boolean) => void;
  onNavigateProjectList: (delta: number) => void;
}

/** Keyboard list stepping for sessions and projects, plus the open-file path list. */
export function useListNavigation({
  tabs,
  tabsRef,
  activeTabIdRef,
  sessionsRef,
  sessionNavigationIdsRef,
  projectCwdRef,
  linkedSessionUpdatesRef,
  setComposerFocused,
  setTabs,
  ensureOpenSession,
  onPrefetchHistorySession,
  onSelectHistorySession,
  onSelectRemoteSession,
  revealLinkedSessionUpdate,
  onSelectProject,
}: ListNavigationDeps): ListNavigation {
  const openFilePaths = useMemo(() => {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const tab of tabs) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (!isFilesystemTab(file) || seen.has(file.path)) continue;
          seen.add(file.path);
          paths.push(file.path);
        }
      }
    }
    return paths;
  }, [tabs]);

  const onSessionNavigationOrder = useCallback((ids: readonly string[]) => {
    sessionNavigationIdsRef.current = ids;
  }, []);

  const onNavigateSessionList = useCallback(
    (delta: number, inCurrentTab = false) => {
      const activeWorkspace = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current);
      if (!activeWorkspace || activeWorkspace.diffFocused) return;
      const current = sessionsRef.current.find(
        (session) => session.id === activeWorkspace.focusedId,
      );
      if (!current) return;
      const remoteProject = isRemoteProjectPath(current.cwd);
      const navigationId = remoteProject ? remoteSessionFor(current.id) : current.id;
      if (!navigationId) return;

      const next = adjacentItemId(sessionNavigationIdsRef.current, navigationId, delta);
      if (!next || next === navigationId) return;
      if (remoteProject) {
        // Another tab (or the one creating it) already shows `next`: go there, since
        // binding this shell too would take the session over and blank that tab.
        const owner = inCurrentTab
          ? resolveRemoteSessionTarget(
              tabsRef.current,
              sessionsRef.current,
              current.cwd,
              next,
              remoteSessionFor,
              remoteCreateShellFor,
            )
          : undefined;
        if (inCurrentTab && !owner) {
          rememberRemoteSession(current.id, next);
          setComposerFocused(true);
        } else {
          onSelectRemoteSession(current.cwd, next);
        }
        return;
      }
      // Stepping gives no hover to warm the transcript, so load the one a
      // further step away once this switch has its own session.
      const prefetchAhead = () => {
        const ahead = adjacentItemId(sessionNavigationIdsRef.current, next, delta);
        if (ahead && ahead !== current.id) onPrefetchHistorySession(ahead);
      };
      if (!inCurrentTab) {
        void onSelectHistorySession(next).then(prefetchAhead);
        return;
      }
      const activeTabId = activeWorkspace.id;
      const focusedId = current.id;
      void ensureOpenSession(next).then((session) => {
        prefetchAhead();
        if (!session || session.inboxAsk) return;
        if (activeTabIdRef.current !== activeTabId) return;
        const currentTab = tabsRef.current.find((tab) => tab.id === activeTabId);
        if (currentTab?.focusedId !== focusedId) return;
        setTabs((prev) => switchSessionInTab(prev, activeTabId, focusedId, next) ?? prev);
        setComposerFocused(true);
        const linkedUpdate = linkedSessionUpdatesRef.current.get(next);
        if (linkedUpdate) revealLinkedSessionUpdate(next, linkedUpdate);
      });
    },
    [
      ensureOpenSession,
      onPrefetchHistorySession,
      onSelectHistorySession,
      onSelectRemoteSession,
      revealLinkedSessionUpdate,
    ],
  );

  const onNavigateProjectList = useCallback(
    (delta: number) => {
      const current = normalizeProjectPath(projectCwdRef.current);
      const ids = projectRailItems(
        visibleProjects(getGroupLockView().lock, loadRecents(), (project) => project.path),
        current,
      ).map((project) => project.path);
      const next = adjacentItemId(ids, current, delta);
      if (!next || sameProjectPath(next, current)) return;
      onSelectProject(next);
    },
    [onSelectProject],
  );

  return {
    openFilePaths,
    onSessionNavigationOrder,
    onNavigateSessionList,
    onNavigateProjectList,
  };
}
