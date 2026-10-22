import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { acceptQuickLaunch } from "../../model/quickLaunchSession";
import { leafIds, splitPane, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { loadRecents, sameProjectPath } from "../../../features/projects/model/recents";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import type { QuickLaunch } from "../../../features/quick-composer/model/quickComposer";
import type { AppSessionPlacement } from "../../../features/agent-app/model/agentApp";
import type { Attachment } from "../../../features/sessions/model/session";
import type { Submit } from "../helpers/types";
import type { SidebarTabId } from "../../../features/settings/model/appearance";

export interface QuickSessionLaunchDeps {
  appendTab: (tab: WorkspaceTab, cwd: string) => void;
  submitSession: Submit;
  onSaveDraft: (
    id: string,
    prompt: string,
    attachments: Attachment[],
    requestId: string,
  ) => boolean;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  setTabs: (tabs: WorkspaceTab[]) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: (focused: boolean) => void;
  setSearchViewOpen: (open: boolean) => void;
  setInboxViewOpen: (open: boolean) => void;
  setNotesViewOpen: (open: boolean) => void;
  setAutomationsViewOpen: (open: boolean) => void;
  setServersViewOpen?: (open: boolean) => void;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
  setProjectCwd: Dispatch<SetStateAction<string>>;
  setRecents: Dispatch<SetStateAction<ReturnType<typeof loadRecents>>>;
}

// Quick composer launch into a session or beside an anchor session. Verbatim from Workspace.
export function useQuickSessionLaunch({
  appendTab,
  submitSession,
  onSaveDraft,
  tabsRef,
  setTabs,
  setActiveTabId,
  setComposerFocused,
  setSearchViewOpen,
  setInboxViewOpen,
  setNotesViewOpen,
  setAutomationsViewOpen,
  setServersViewOpen,
  setSidebarTab,
  setProjectCwd,
  setRecents,
}: QuickSessionLaunchDeps) {
  const launchQuickSession = useCallback(
    (launch: QuickLaunch, deliveryId: string, placement?: AppSessionPlacement) =>
      acceptQuickLaunch(
        launch,
        deliveryId,
        {
          getSessions: () => sessionsRef.current,
          updateSessions: (update) => {
            sessionsRef.current = update(sessionsRef.current);
            // Compose with submission's queued transcript updates.
            setSessions(update);
          },
          appendTab,
          placeSession: (sessionId, target, cwd) => {
            const anchor = sessionsRef.current.find(
              (session) => session.id === target.besideSessionId,
            );
            const tab = tabsRef.current.find((entry) =>
              leafIds(entry.layout).includes(target.besideSessionId),
            );
            if (!anchor || !sameProjectPath(anchor.cwd, cwd) || !tab)
              throw new Error("The target session must be open in this project");
            const nextTabs = tabsRef.current.map((entry) =>
              entry.id === tab.id
                ? {
                    ...entry,
                    layout: splitPane(
                      entry.layout,
                      target.besideSessionId,
                      target.direction,
                      sessionId,
                    ),
                    focusedId: launch.reveal ? sessionId : entry.focusedId,
                    diffFocused: launch.reveal ? false : entry.diffFocused,
                  }
                : entry,
            );
            tabsRef.current = nextTabs;
            setTabs(nextTabs);
            return tab.id;
          },
          setProjectCwd,
          setRecents,
          revealTab: (id, cwd) => {
            setActiveTabId(id);
            setComposerFocused(false);
            setSearchViewOpen(false);
            setInboxViewOpen(false);
            setNotesViewOpen(false);
            setAutomationsViewOpen(false);
            setServersViewOpen?.(false);
            setSidebarTab("sessions", cwd);
          },
          submit: submitSession,
          saveDraft: (id, prompt, attachments, requestId) =>
            flushSync(() => onSaveDraft(id, prompt, attachments, requestId)),
        },
        placement,
      ),
    [appendTab, submitSession, onSaveDraft],
  );

  return { launchQuickSession };
}
