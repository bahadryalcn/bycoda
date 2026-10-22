import {
  useCallback,
  useEffect,
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

/** Maximized pane state plus the effect that repairs it when tabs change. */
export function useMaximizedPane({ tabs }: { tabs: WorkspaceTab[] }): {
  maximizedPane: MaximizedPaneState;
  setMaximizedPane: Dispatch<SetStateAction<MaximizedPaneState>>;
} {
  const [maximizedPane, setMaximizedPane] = useState<{ tabId: string; paneId: string } | null>(
    null,
  );
  useEffect(() => {
    if (
      maximizedPane &&
      !tabs.some(
        (tab) =>
          tab.id === maximizedPane.tabId && leafIds(tab.layout).includes(maximizedPane.paneId),
      )
    )
      setMaximizedPane(null);
    else if (maximizedPane) {
      const tab = tabs.find((entry) => entry.id === maximizedPane.tabId);
      if (
        tab &&
        tab.focusedId !== maximizedPane.paneId &&
        leafIds(tab.layout).includes(tab.focusedId)
      )
        setMaximizedPane({ tabId: tab.id, paneId: tab.focusedId });
    }
  }, [tabs, maximizedPane]);
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
  return useCallback((paneId?: string) => {
    const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current);
    const id = paneId ?? tab?.focusedId;
    if (!tab || !id || !leafIds(tab.layout).includes(id)) return;
    if (windowTransferPendingRef.current || movingTabIds.current.has(tab.id)) return;
    if (tab.focusedId !== id) {
      const next = tabsRef.current.map((entry) =>
        entry.id === tab.id
          ? { ...entry, layout: selectPaneTab(entry.layout, id), focusedId: id, diffFocused: false }
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
  }, []);
}
