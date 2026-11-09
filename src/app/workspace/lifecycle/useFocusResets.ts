import { useState, type Dispatch, type SetStateAction } from "react";

export interface FocusResetDeps {
  dockVisible: boolean;
  projectTerminalFocused: boolean;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
}

/**
 * Clears terminal focus when the dock becomes hidden. It is adjusted while
 * rendering (on the visibility transition only, like the effect it replaces) so
 * no committed frame shows a hidden dock as focused. Focus requested while the
 * dock is already hidden is left alone, as before.
 *
 * The stored "inbox" sidebar tab redirect that used to live here is gone:
 * `setSidebarTab` already stores "sessions" when "inbox" is chosen and
 * `loadProjectSidebarTab` never returns "inbox", so that state is unreachable.
 */
export function useFocusResets({
  dockVisible,
  projectTerminalFocused,
  setProjectTerminalFocused,
}: FocusResetDeps): void {
  const [previousDockVisible, setPreviousDockVisible] = useState(dockVisible);
  if (previousDockVisible !== dockVisible) {
    setPreviousDockVisible(dockVisible);
    if (!dockVisible && projectTerminalFocused) setProjectTerminalFocused(false);
  }
}
