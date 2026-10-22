import { useEffect } from "react";
import { OPEN_PROJECT_CHANGES_EVENT } from "../../../features/projects/model/groupGit";
import type { SidebarTabId } from "../../../features/settings/model/appearance";

export interface OpenProjectChangesDeps {
  onSelectProject: (path: string) => void;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
}

/** A group's git overview opens a project's Changes tab. */
export function useOpenProjectChangesListener({
  onSelectProject,
  setSidebarTab,
}: OpenProjectChangesDeps): void {
  // A group's git overview opens a project's Changes tab.
  useEffect(() => {
    const open = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (typeof path !== "string" || !path) return;
      setSidebarTab("changes", path);
      onSelectProject(path);
    };
    window.addEventListener(OPEN_PROJECT_CHANGES_EVENT, open);
    return () => window.removeEventListener(OPEN_PROJECT_CHANGES_EVENT, open);
  }, [onSelectProject, setSidebarTab]);
}
