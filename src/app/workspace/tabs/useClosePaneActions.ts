import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  closeLeaf,
  findSurfacePane,
  leafIds,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  planWorkspaceTabClose,
  type WorkspaceTabCloseScope,
} from "../../../features/workspace/model/workspaceTabGroups";
import { type Session } from "../../../features/sessions/model/session";
import type { useCloseTabActions } from "./useCloseTabActions";

export interface ClosePaneActionDeps {
  activeTab: WorkspaceTab | undefined;
  onCloseFile: (paneId: string, fileId: string, opts?: { skipConfirm?: boolean }) => void;
  onCloseTab: ReturnType<typeof useCloseTabActions>["onCloseTab"];
  onClearTabSession: (id: string) => void;
  persistSession: (session: Session | undefined) => void;
  refreshHistory: (cwd: string) => Promise<unknown>;
  sidebarCwd: string;
  tabCloseScope: WorkspaceTabCloseScope;
  tabWorktreeOf: (tab: WorkspaceTab) => string | null;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  activeTabIdRef: MutableRefObject<string>;
  movingTabIds: MutableRefObject<Set<string>>;
  windowTransferPendingRef: MutableRefObject<boolean>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
}

/** Close the focused pane or session of the active tab, and title-bar tab close. */
export function useClosePaneActions({
  activeTab,
  onCloseFile,
  onCloseTab,
  onClearTabSession,
  persistSession,
  refreshHistory,
  sidebarCwd,
  tabCloseScope,
  tabWorktreeOf,
  tabsRef,
  sessionsRef,
  activeTabIdRef,
  movingTabIds,
  windowTransferPendingRef,
  setTabs,
  setComposerFocused,
}: ClosePaneActionDeps) {

  const onClosePane = useCallback(
    (sessionId?: string) => {
      // The project terminal is shared by every workspace tab in the project.
      // Keep the global close command scoped to workspace tabs and panes even
      // while the dock has focus; terminal tabs have their own close buttons.
      if (!activeTab) return;
      const focusedSurface = findSurfacePane(activeTab, activeTab.focusedId);
      if (windowTransferPendingRef.current || movingTabIds.current.has(activeTab.id)) return;
      if (sessionId === undefined && focusedSurface) {
        onCloseFile(focusedSurface.pane.id, focusedSurface.pane.activeFileId);
        return;
      }
      const closingId = sessionId ?? activeTab.focusedId;
      const ids = leafIds(activeTab.layout);
      const sessionIds = ids.filter((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      if (!sessionIds.includes(closingId)) return;
      const nextTab = closeLeaf(activeTab, closingId);
      if (!nextTab) {
        const closePlan = planWorkspaceTabClose({
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          closingTabId: activeTab.id,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
        });
        if (closePlan.action === "keep") onClearTabSession(activeTab.id);
        else onCloseTab(activeTab.id);
        return;
      }
      persistSession(sessionsRef.current.find((s) => s.id === closingId));
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? { ...t, layout: nextTab.layout, focusedId: nextTab.focusedId }
            : t,
        ),
      );
      if (closingId === activeTab.focusedId) {
        setComposerFocused(
          nextTab && sessionsRef.current.some((session) => session.id === nextTab.focusedId),
        );
      }
      void refreshHistory(sidebarCwd);
    },
    [
      activeTab,
      onCloseFile,
      onCloseTab,
      onClearTabSession,
      persistSession,
      refreshHistory,
      sidebarCwd,
      tabCloseScope,
    ],
  );

  const onCloseTitleTab = useCallback(
    (id: string) => {
      if (windowTransferPendingRef.current || movingTabIds.current.has(id)) return;
      const closePlan = planWorkspaceTabClose({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        closingTabId: id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep" && id === activeTabIdRef.current) {
        onClosePane();
        return;
      }
      onCloseTab(id);
    },
    [onClosePane, onCloseTab, tabCloseScope],
  );

  return { onClosePane, onCloseTitleTab };
}
