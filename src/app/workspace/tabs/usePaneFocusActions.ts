import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { selectPaneTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { type Session } from "../../../features/sessions/model/session";
import { type InboxSessionPortal } from "../../../features/inbox/ui/InboxDiscussionPanel";
import { type MaximizedPaneState } from "./useMaximizedPane";

export interface PaneFocusActionDeps {
  activeTabId: string;
  activeTabIdRef: MutableRefObject<string>;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  inboxAskPortal: InboxSessionPortal | null;
  isMovingPane: (paneId: string) => boolean;
  workspaceNavigation: { cancel: () => void };
  setMaximizedPane: Dispatch<SetStateAction<MaximizedPaneState>>;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
}

/** Focuses a pane of the active tab. */
export function usePaneFocusActions({
  activeTabId,
  activeTabIdRef,
  tabsRef,
  sessionsRef,
  inboxAskPortal,
  isMovingPane,
  workspaceNavigation,
  setMaximizedPane,
  setProjectTerminalFocused,
  setComposerFocused,
  setTabs,
}: PaneFocusActionDeps): { onFocusPane: (paneId: string) => void } {
  const onFocusPane = useCallback(
    (paneId: string) => {
      if (isMovingPane(paneId)) return;
      setMaximizedPane((current) =>
        current?.tabId === activeTabId ? { ...current, paneId } : current,
      );
      if (tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)?.focusedId !== paneId)
        workspaceNavigation.cancel();
      setProjectTerminalFocused(false);
      if (inboxAskPortal?.sessionId === paneId) {
        setComposerFocused(true);
        return;
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                layout: selectPaneTab(t.layout, paneId),
                focusedId: paneId,
                diffFocused: false,
              }
            : t,
        ),
      );
      setComposerFocused(sessionsRef.current.some((session) => session.id === paneId));
    },
    [activeTabId, inboxAskPortal],
  );

  return { onFocusPane };
}
