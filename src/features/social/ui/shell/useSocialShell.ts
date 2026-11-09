import { useCallback, useState } from "react";
import { type SocialScreenId } from "./screens";

/** Section state of one Host: where it is, the last navigation target and every section it has opened. */
export type ShellPanelState = {
  screen: SocialScreenId;
  target?: unknown;
  /** Opened sections stay mounted (hidden when inactive) so their drafts survive navigation. */
  visited: SocialScreenId[];
};

export const START_PANEL: ShellPanelState = { screen: "command", visited: ["command"] };

/**
 * Section state for every Host. Each computer keeps its own section, so switching the workspace
 * and coming back restores where that computer was.
 */
export function useSocialShell(machineId: string) {
  const [panels, setPanels] = useState<Record<string, ShellPanelState>>({});
  const current = panels[machineId] ?? START_PANEL;
  const navigate = useCallback(
    (screen: SocialScreenId, target?: unknown) =>
      setPanels((previous) => {
        const before = previous[machineId] ?? START_PANEL;
        const visited = before.visited.includes(screen)
          ? before.visited
          : [...before.visited, screen];
        return { ...previous, [machineId]: { screen, target, visited } };
      }),
    [machineId],
  );
  return { screen: current.screen, target: current.target, navigate, panels };
}
