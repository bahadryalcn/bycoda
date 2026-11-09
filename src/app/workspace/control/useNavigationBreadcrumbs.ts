import { useEffect } from "react";
import { recordNavigation } from "../../../features/diagnostics";
import type { AppUiControlDeps } from "./useAppUiControl";

/** The view the user is on, by name only: never a project, session title or path. */
export function currentViewName(surface: AppUiControlDeps["surface"]): string {
  if (surface.settingsOpen) return "settings";
  if (surface.inboxViewOpen) return "inbox";
  if (surface.automationsViewOpen) return "automations";
  if (surface.notesViewOpen) return "notes";
  if (surface.searchViewOpen) return "search";
  if (surface.serversViewOpen) return "servers";
  if (surface.socialBoardShown) return "social";
  if (surface.taskBoardShown) return "tasks";
  return "conversation";
}

/** Leaves a `ui.nav` breadcrumb for every view or Settings section change. */
export function useNavigationBreadcrumbs(surface: AppUiControlDeps["surface"]): void {
  const view = currentViewName(surface);
  const section = view === "settings" ? String(surface.settingsSection ?? "") : "";
  useEffect(() => {
    recordNavigation(view, section || undefined);
  }, [view, section]);
}
