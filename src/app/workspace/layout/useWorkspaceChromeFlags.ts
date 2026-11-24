import { useMemo } from "react";
import { pathKey } from "../../../shared/lib/paths";
import type { ToolWindow } from "../../model/toolWindows";
import type { WindowTransferPayload } from "../../model/windowTransfer";
import type { useSettingsBackedFlags } from "../state/useSettingsBackedFlags";
import type { useProjectState } from "../state/useProjectState";

export interface WorkspaceChromeFlagsDeps {
  toolWindow: ToolWindow | null;
  windowTransfer: WindowTransferPayload | null;
  collapsedProjectRailMode: ReturnType<typeof useSettingsBackedFlags>["collapsedProjectRailMode"];
  projectRailOpen: boolean;
  visibleRecents: ReturnType<typeof useProjectState>["visibleRecents"];
}

export function useWorkspaceChromeFlags({
  toolWindow,
  windowTransfer,
  collapsedProjectRailMode,
  projectRailOpen,
  visibleRecents,
}: WorkspaceChromeFlagsDeps) {
  const compactProjectRail = collapsedProjectRailMode === "compact";
  const detachedSessionWindow = Boolean(windowTransfer || toolWindow);
  const compactRailActive = !detachedSessionWindow && compactProjectRail && !projectRailOpen;
  const trayProjectKeys = useMemo(
    () => new Set(visibleRecents.map((project) => pathKey(project.path))),
    [visibleRecents],
  );

  return {
    compactProjectRail,
    detachedSessionWindow,
    compactRailActive,
    trayProjectKeys,
  };
}
