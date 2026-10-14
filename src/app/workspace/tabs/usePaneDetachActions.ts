import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import { message } from "@tauri-apps/plugin-dialog";
import {
  findSurfacePane,
  leafIds,
  surfacePanes,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { applyDetachPaneToTab } from "../../../features/workspace/model/workspaceTabGroups";
import { t } from "../../../shared/i18n";
import { type WindowMovePosition } from "../../model/windowTransferPopout";
import { type MoveTabsOutcome } from "../windows/useMoveTabsToNewWindow";

export interface PaneDetachActionDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  movingTabIds: MutableRefObject<Set<string>>;
  dirtyFilesRef: MutableRefObject<Set<string>>;
  isMovingPane: (paneId: string) => boolean;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  activateTab: (id: string, paneId?: string, reason?: "session" | "workspace") => void;
  onMoveTabsToNewWindow: (
    tabIds: string[],
    opts?: {
      position?: WindowMovePosition;
      targetWindowLabel?: string;
    },
  ) => Promise<MoveTabsOutcome | undefined>;
}

/** Detaches a pane into another tab of this window, or pops it out to a new window. */
export function usePaneDetachActions({
  tabsRef,
  movingTabIds,
  dirtyFilesRef,
  isMovingPane,
  setTabs,
  setProjectTerminalFocused,
  activateTab,
  onMoveTabsToNewWindow,
}: PaneDetachActionDeps): {
  onDetachPane: (paneId: string, targetTabId: string, position: "before" | "after") => void;
  onPopOutPane: (paneId: string, position: WindowMovePosition) => void;
} {
  const onDetachPane = useCallback(
    (paneId: string, targetTabId: string, position: "before" | "after") => {
      if (isMovingPane(paneId) || movingTabIds.current.has(targetTabId)) return;
      const result = applyDetachPaneToTab({
        tabs: tabsRef.current,
        paneId,
        targetTabId,
        position,
      });
      if (!result) return;

      tabsRef.current = result.tabs;
      setTabs(result.tabs);
      setProjectTerminalFocused(false);
      activateTab(result.activeTabId, result.focusedId);
    },
    [activateTab],
  );

  const onPopOutPane = useCallback(
    (paneId: string, position: WindowMovePosition) => {
      const source = tabsRef.current.find((tab) => leafIds(tab.layout).includes(paneId));
      if (!source || movingTabIds.current.has(source.id)) return;
      const surface = findSurfacePane(source, paneId);
      if (
        surface &&
        surfacePanes(source, surface.kind)
          .find((pane) => pane.id === paneId)
          ?.files.some((file) => dirtyFilesRef.current.has(file.id))
      ) {
        void message("Save the unsaved files before moving this pane to another window.", {
          get title() {
            return t("Move pane");
          },
        });
        return;
      }
      if (
        surface &&
        surfacePanes(source, surface.kind)
          .find((pane) => pane.id === paneId)
          ?.files.some((file) => file.terminal)
      )
        return;
      let tabId = source.id;
      let detachedState: ReturnType<typeof applyDetachPaneToTab> = null;
      if (leafIds(source.layout).length > 1) {
        const detached = applyDetachPaneToTab({
          tabs: tabsRef.current,
          paneId,
          targetTabId: source.id,
          position: "after",
        });
        if (!detached) return;
        detachedState = detached;
        // Keep ownership in this window until the receiver acknowledges it.
        // Busy sessions use the existing cancellable tab-transfer queue.
        tabId = detached.activeTabId;
        flushSync(() => {
          tabsRef.current = detached.tabs;
          setTabs(detached.tabs);
          activateTab(tabId, paneId);
        });
      }
      void onMoveTabsToNewWindow([tabId], { position }).then((outcome) => {
        if (outcome !== "failed" || !detachedState) return;
        const currentSource = tabsRef.current.find((tab) => tab.id === source.id);
        const currentDetached = tabsRef.current.find((tab) => tab.id === tabId);
        const originalRemainder = detachedState.tabs.find((tab) => tab.id === source.id);
        const originalDetached = detachedState.tabs.find((tab) => tab.id === tabId);
        // Restore the original split only if the user has not rearranged it while queued.
        if (
          !currentSource ||
          !currentDetached ||
          currentSource.layout !== originalRemainder?.layout ||
          currentDetached.layout !== originalDetached?.layout
        )
          return;
        const restored = {
          ...currentSource,
          layout: source.layout,
          focusedId: paneId,
          editorPanes: [...currentSource.editorPanes, ...currentDetached.editorPanes],
          terminalPanes: [
            ...(currentSource.terminalPanes ?? []),
            ...(currentDetached.terminalPanes ?? []),
          ],
        };
        const next = tabsRef.current
          .filter((tab) => tab.id !== tabId)
          .map((tab) => (tab.id === source.id ? restored : tab));
        tabsRef.current = next;
        setTabs(next);
        activateTab(source.id, paneId);
      });
    },
    [activateTab, onMoveTabsToNewWindow],
  );

  return { onDetachPane, onPopOutPane };
}
