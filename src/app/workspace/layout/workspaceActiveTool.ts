import type { AuxiliaryToolId, WorkspaceToolId } from "../../model/toolWindows";

/** The tool the workspace is showing, or null on the conversation view. Crews wins: it closes the rest. */
export function workspaceActiveTool(view: {
  crewsOpen: boolean;
  auxiliaryTool?: AuxiliaryToolId | null;
  automationsViewOpen: boolean;
  serversViewOpen: boolean;
  inboxViewOpen: boolean;
  notesViewOpen: boolean;
  socialBoardShown: boolean;
  taskBoardShown: boolean;
}): WorkspaceToolId | null {
  if (view.crewsOpen) return "crews";
  if (view.automationsViewOpen && view.auxiliaryTool) return view.auxiliaryTool;
  if (view.serversViewOpen) return "servers";
  if (view.inboxViewOpen) return "inbox";
  if (view.notesViewOpen) return "notes";
  if (!view.automationsViewOpen) return null;
  return view.socialBoardShown ? "social" : view.taskBoardShown ? "tasks" : "automations";
}
