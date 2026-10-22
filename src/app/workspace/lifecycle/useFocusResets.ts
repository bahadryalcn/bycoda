import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { SidebarTabId } from "../../../features/settings/model/appearance";

export interface FocusResetDeps {
  sidebarTab: SidebarTabId;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
  dockVisible: boolean;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
}

/** Resets tab and dock focus state that no longer applies (inbox tab, hidden terminal dock). */
export function useFocusResets({
  sidebarTab,
  setSidebarTab,
  dockVisible,
  setProjectTerminalFocused,
}: FocusResetDeps): void {
  useEffect(() => {
    if (sidebarTab === "inbox") setSidebarTab("sessions");
  }, [sidebarTab]);

  useEffect(() => {
    if (!dockVisible) setProjectTerminalFocused(false);
  }, [dockVisible]);
}
