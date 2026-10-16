import { useCallback, useState, type MutableRefObject } from "react";
import { type SidebarTabId } from "../../../features/settings/model/appearance";
import { loadProjectSidebarTab, saveProjectSidebarTab } from "../../../features/settings/model/projectSidebarTab";
import { pathKey } from "../../../shared/lib/paths";

export interface SidebarTabSelectionDeps {
  sidebarCwd: string;
  sidebarCwdRef: MutableRefObject<string>;
}

export function useSidebarTabSelection({ sidebarCwd, sidebarCwdRef }: SidebarTabSelectionDeps) {
  const [sidebarTabSelection, setSidebarTabSelection] = useState<{
    project: string;
    tab: SidebarTabId;
  }>(() => ({
    project: pathKey(sidebarCwd),
    tab: loadProjectSidebarTab(sidebarCwd),
  }));
  const sidebarTab =
    sidebarTabSelection.project === pathKey(sidebarCwd)
      ? sidebarTabSelection.tab
      : loadProjectSidebarTab(sidebarCwd);
  const setSidebarTab = useCallback((tab: SidebarTabId, project?: string) => {
    const cwd = project ?? sidebarCwdRef.current;
    saveProjectSidebarTab(cwd, tab);
    setSidebarTabSelection({
      project: pathKey(cwd),
      tab: tab === "inbox" ? "sessions" : tab,
    });
  }, []);

  return { sidebarTab, setSidebarTabSelection, setSidebarTab };
}
