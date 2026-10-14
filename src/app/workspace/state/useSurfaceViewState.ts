import { useState } from "react";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import type { ToolWindow } from "../../model/toolWindows";

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
  const [notesViewOpen, setNotesViewOpen] = useState(
    toolWindow?.active === "notes" && loadNotesEnabled(),
  );
  const [automationsViewOpen, setAutomationsViewOpen] = useState(
    toolWindow?.active === "automations" ||
      toolWindow?.active === "tasks" ||
      toolWindow?.active === "social",
  );
  // Tasks and Social Media share the workspace navigation lifecycle with
  // Automations; closing or restoring it also handles the selected panel.
  const [taskBoardShown, setTaskBoardShown] = useState(toolWindow?.active === "tasks");
  const [socialBoardShown, setSocialBoardShown] = useState(toolWindow?.active === "social");
  const [socialPanelCwd, setSocialPanelCwd] = useState("");
  return {
    notesViewOpen,
    setNotesViewOpen,
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
