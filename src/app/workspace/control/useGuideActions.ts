import { useEffect, useRef, type MutableRefObject } from "react";
import { GUIDE_ACTION_EVENT, type GuideAction } from "../../../features/onboarding/model/guide";
import type { SidebarTabId } from "../../../features/settings/model/appearance";
import { SOCIAL_PANEL_EVENT } from "../../../features/social/ui/SocialShortcut";
import type { WorkspaceActions } from "../input/useWorkspaceActions";

export interface GuideActionDeps {
  actions: MutableRefObject<WorkspaceActions>;
  projectCwd: string;
  closeSurfaces: () => void;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
  setSessionSidebarOpen: (open: boolean) => void;
  onShowProjectTerminal: () => void;
}

/** Routes guide "show me" requests to the workspace's existing openers. */
export function useGuideActions(deps: GuideActionDeps): void {
  const latest = useRef(deps);
  latest.current = deps;
  useEffect(() => {
    const onAction = (event: Event) => {
      const action = (event as CustomEvent<GuideAction>).detail;
      const { actions, projectCwd, closeSurfaces, setSidebarTab, setSessionSidebarOpen } =
        latest.current;
      const workspace = actions.current;
      switch (action) {
        case "open-project":
          void workspace.pickProject();
          break;
        case "new-session":
          closeSurfaces();
          workspace.onNew();
          break;
        case "changes":
        case "files":
          closeSurfaces();
          setSidebarTab(action, projectCwd);
          setSessionSidebarOpen(true);
          break;
        case "command-palette":
          workspace.onOpenCommandPalette();
          break;
        case "terminal":
          closeSurfaces();
          latest.current.onShowProjectTerminal();
          break;
        case "inbox":
          workspace.onOpenInbox();
          break;
        case "notes":
          workspace.onOpenNotes();
          break;
        case "automations":
          workspace.onOpenAutomations();
          break;
        case "tasks":
          workspace.onOpenTasks();
          break;
        case "social":
          window.dispatchEvent(
            new CustomEvent(SOCIAL_PANEL_EVENT, { detail: { cwd: projectCwd } }),
          );
          break;
        case "connections":
          workspace.openSettings("connections");
          break;
        case "keybindings":
          workspace.openSettings("keybindings");
          break;
        case "workspace-settings":
          workspace.openSettings("workspace");
          break;
      }
    };
    window.addEventListener(GUIDE_ACTION_EVENT, onAction);
    return () => window.removeEventListener(GUIDE_ACTION_EVENT, onAction);
  }, []);
}
