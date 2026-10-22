import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  leafIds,
  splitPaneAtSelfEdge,
  type PaneEdge,
  type PaneTabDropPosition,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { applyGroupedReorder } from "../../../features/workspace/model/tabGroups";
import {
  applyMovePaneBetweenTabs,
  applyMoveFileBetweenPanes,
} from "../../../features/workspace/model/workspaceTabGroups";
import { newDefaultSession, type Session } from "../../../features/sessions/model/session";
import { mergeOrderedSubset, orderByIds } from "../../../shared/lib/reorder";
import { filesInWorkspaceTabs } from "../helpers/tabHelpers";

export interface PaneMoveActionDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  projectCwdRef: MutableRefObject<string>;
  dirtyFilesRef: MutableRefObject<Set<string>>;
  movingTabIds: MutableRefObject<Set<string>>;
  isMovingPane: (paneId: string) => boolean;
  projectOfTab: (id: string) => string | undefined;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setActiveTabId: (id: string) => void;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
}

/** Tab reorder and pane / file moves between panes and tabs. */
export function usePaneMoveActions({
  tabsRef,
  sessionsRef,
  projectCwdRef,
  dirtyFilesRef,
  movingTabIds,
  isMovingPane,
  projectOfTab,
  setTabs,
  setSessions,
  setActiveTabId,
  setProjectTerminalFocused,
  setComposerFocused,
}: PaneMoveActionDeps): {
  onReorderTabs: (ids: string[], movedId?: string) => void;
  onMovePane: (fromId: string, toId: string, edge: PaneEdge, tabPosition?: PaneTabDropPosition) => void;
  onMoveFileBetweenPanes: (
    fileId: string,
    targetPaneId: string,
    edge: PaneEdge,
    targetFileId?: string,
    position?: PaneTabDropPosition,
  ) => void;
} {
  const onReorderTabs = useCallback(
    (ids: string[], movedId?: string) => {
      setTabs((prev) => {
        const visibleIds = new Set(ids);
        const visibleTabs = prev.filter((tab) => visibleIds.has(tab.id));
        if (movedId) {
          const reordered = applyGroupedReorder(visibleTabs, ids, movedId, projectOfTab);
          return reordered ? mergeOrderedSubset(prev, reordered) : prev;
        }
        return mergeOrderedSubset(prev, orderByIds(visibleTabs, ids));
      });
    },
    [projectOfTab],
  );

  const onMovePane = useCallback(
    (fromId: string, toId: string, edge: PaneEdge, tabPosition?: PaneTabDropPosition) => {
      if (isMovingPane(fromId) || isMovingPane(toId)) return;
      if (fromId === toId) {
        if (edge === "center") return;
        const source = tabsRef.current.find((tab) => leafIds(tab.layout).includes(fromId));
        if (!source) return;
        const currentSession = sessionsRef.current.find((session) => session.id === fromId);
        const empty = newDefaultSession(
          currentSession?.cwd ?? projectCwdRef.current,
          currentSession?.runtimeMode,
        );
        const next = tabsRef.current.map((tab) =>
          tab.id === source.id
            ? {
                ...tab,
                layout: splitPaneAtSelfEdge(tab.layout, fromId, edge, empty.id),
                focusedId: fromId,
              }
            : tab,
        );
        sessionsRef.current = [...sessionsRef.current, empty];
        tabsRef.current = next;
        setSessions(sessionsRef.current);
        setTabs(next);
        return;
      }
      const result = applyMovePaneBetweenTabs({
        tabs: tabsRef.current,
        fromId,
        toId,
        edge,
        tabPosition,
      });
      if (!result) return;
      tabsRef.current = result.tabs;
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(sessionsRef.current.some((session) => session.id === result.focusedId));
    },
    [],
  );

  const onMoveFileBetweenPanes = useCallback(
    (
      fileId: string,
      targetPaneId: string,
      edge: PaneEdge,
      targetFileId?: string,
      position?: PaneTabDropPosition,
    ) => {
      const source = tabsRef.current.find((tab) =>
        filesInWorkspaceTabs([tab]).some((file) => file.id === fileId),
      );
      if (
        !source ||
        movingTabIds.current.has(source.id) ||
        isMovingPane(targetPaneId) ||
        dirtyFilesRef.current.has(fileId)
      )
        return;
      const result = applyMoveFileBetweenPanes({
        tabs: tabsRef.current,
        fileId,
        targetPaneId,
        edge,
        targetFileId,
        position,
      });
      if (!result) return;
      tabsRef.current = result.tabs;
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(false);
    },
    [],
  );

  return { onReorderTabs, onMovePane, onMoveFileBetweenPanes };
}
