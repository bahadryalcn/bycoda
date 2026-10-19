import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import type { AuxiliaryToolId, ToolWindow } from "../../model/toolWindows";

export interface SurfaceViewStateDeps {
  toolWindow: ToolWindow | null;
}

/** Search, inbox and pull-request view flags with their focus tokens. */
export function useSurfaceViewFlags({ toolWindow }: SurfaceViewStateDeps) {
  const [filesSearchOpen, setFilesSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [searchViewOpen, setSearchViewOpen] = useState(false);
  const [searchViewFocusToken, setSearchViewFocusToken] = useState(0);
  const [inboxViewOpen, setInboxViewOpen] = useState(toolWindow?.active === "inbox");
  const [pullRequestsOnly, setPullRequestsOnly] = useState(false);
  return {
    filesSearchOpen,
    setFilesSearchOpen,
    searchFocusToken,
    setSearchFocusToken,
    searchViewOpen,
    setSearchViewOpen,
    searchViewFocusToken,
    setSearchViewFocusToken,
    inboxViewOpen,
    setInboxViewOpen,
    pullRequestsOnly,
    setPullRequestsOnly,
  };
}

/** Notes, automations and the task/social board flags. */
export function useSurfaceBoardFlags({ toolWindow }: SurfaceViewStateDeps) {
  const [serversViewOpen, setServersViewOpen] = useState(toolWindow?.active === "servers");
  const [notesViewOpen, setNotesViewOpen] = useState(
    toolWindow?.active === "notes" && loadNotesEnabled(),
  );
  const [auxiliaryTool, setAuxiliaryTool] = useState<AuxiliaryToolId | null>(
    toolWindow?.active === "terminal" || toolWindow?.active === "conversation-tools"
      ? toolWindow.active
      : null,
  );
  const [automationsViewOpen, setAutomationsViewOpenState] = useState(
    toolWindow?.active === "terminal" ||
      toolWindow?.active === "conversation-tools" ||
      toolWindow?.active === "automations" ||
      toolWindow?.active === "tasks" ||
      toolWindow?.active === "social",
  );
  const setAutomationsViewOpen: Dispatch<SetStateAction<boolean>> = useCallback((value) => {
    setAuxiliaryTool(null);
    setAutomationsViewOpenState(value);
  }, []);
  // Tasks and Social Media share the workspace navigation lifecycle with
  // Automations; closing or restoring it also handles the selected panel.
  const [taskBoardShown, setTaskBoardShown] = useState(toolWindow?.active === "tasks");
  const [socialBoardShown, setSocialBoardShown] = useState(toolWindow?.active === "social");
  const [socialPanelCwd, setSocialPanelCwd] = useState("");
  return {
    serversViewOpen,
    setServersViewOpen,
    notesViewOpen,
    setNotesViewOpen,
    auxiliaryTool,
    setAuxiliaryTool,
    automationsViewOpen,
    setAutomationsViewOpen,
    taskBoardShown,
    setTaskBoardShown,
    socialBoardShown,
    setSocialBoardShown,
    socialPanelCwd,
    setSocialPanelCwd,
  };
}
