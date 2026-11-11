import {
  useCallback,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  leafIds,
  selectPaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { type Session } from "../../../features/sessions/model/session";

export type MaximizedPaneState = { tabId: string; paneId: string } | null;

/**
 * Repairs a maximized pane against the current tabs: a pane that no longer
 * exists clears it, and focus moving to another pane of the same tab follows.
 * Returns the input when nothing needs repair.
 */
export function resolveMaximizedPane(
  maximizedPane: MaximizedPaneState,
  tabs: WorkspaceTab[],
): MaximizedPaneState {
  if (!maximizedPane) return maximizedPane;
  const tab = tabs.find((entry) => entry.id === maximizedPane.tabId);
  if (!tab) return null;
  const leaves = leafIds(tab.layout);
  if (!leaves.includes(maximizedPane.paneId)) return null;
  if (tab.focusedId !== maximizedPane.paneId && leaves.includes(tab.focusedId))
    return { tabId: tab.id, paneId: tab.focusedId };
  return maximizedPane;
}

/**
 * Maximized pane state, repaired against tabs while rendering. The stored state
 * is adjusted in render (not in an effect) so toggles always compare against the
 * repaired value and no stale frame commits.
 */
export function useMaximizedPane({ tabs }: { tabs: WorkspaceTab[] }): {
  maximizedPane: MaximizedPaneState;
  setMaximizedPane: Dispatch<SetStateAction<MaximizedPaneState>>;
} {
  const [stored, setMaximizedPane] = useState<MaximizedPaneState>(null);
  const maximizedPane = resolveMaximizedPane(stored, tabs);
  if (maximizedPane !== stored) setMaximizedPane(maximizedPane);
  return { maximizedPane, setMaximizedPane };
}

export interface ToggleMaximizePaneDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<string>;
  sessionsRef: MutableRefObject<Session[]>;
  windowTransferPendingRef: MutableRefObject<boolean>;
  movingTabIds: MutableRefObject<Set<string>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setMaximizedPane: Dispatch<SetStateAction<MaximizedPaneState>>;
}

/** Toggles maximize for a pane of the active tab (focusing it first). */
export function useToggleMaximizePane({
  tabsRef,
  activeTabIdRef,
  sessionsRef,
  windowTransferPendingRef,
  movingTabIds,
  setTabs,
  setProjectTerminalFocused,
  setComposerFocused,
  setMaximizedPane,
}: ToggleMaximizePaneDeps): (paneId?: string) => void {
  return useCallback(
    (paneId?: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current);
      const id = paneId ?? tab?.focusedId;
      if (!tab || !id || !leafIds(tab.layout).includes(id)) return;
      if (windowTransferPendingRef.current || movingTabIds.current.has(tab.id)) return;
      if (tab.focusedId !== id) {
        const next = tabsRef.current.map((entry) =>
          entry.id === tab.id
            ? {
                ...entry,
                layout: selectPaneTab(entry.layout, id),
                focusedId: id,
                diffFocused: false,
              }
            : entry,
        );
        tabsRef.current = next;
        setTabs(next);
        setProjectTerminalFocused(false);
        setComposerFocused(sessionsRef.current.some((session) => session.id === id));
      }
      setMaximizedPane((current) =>
        current?.tabId === tab.id && current.paneId === id ? null : { tabId: tab.id, paneId: id },
      );
    },
    [
      windowTransferPendingRef,
      movingTabIds,
      setComposerFocused,
      setTabs,
      setProjectTerminalFocused,
      tabsRef,
      sessionsRef,
      setMaximizedPane,
      activeTabIdRef,
    ],
  );
}
