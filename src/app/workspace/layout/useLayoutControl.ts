import { useMemo } from "react";
import { layoutLeaves } from "../../../features/workspace/model/layout";
import type { ActiveWorkspaceContext } from "../derived/useActiveWorkspaceContext";
import type { usePaneLayoutActions } from "../tabs/usePaneLayoutActions";
import type { useMaximizedPane } from "../tabs/useMaximizedPane";

export interface LayoutControlDeps {
  activeTab: ActiveWorkspaceContext["activeTab"];
  activeTabId: string;
  activeTabLayoutPreset: ReturnType<typeof usePaneLayoutActions>["activeTabLayoutPreset"];
  onArrangeActiveTab: ReturnType<typeof usePaneLayoutActions>["onArrangeActiveTab"];
  onSplit: ReturnType<typeof usePaneLayoutActions>["onSplit"];
  maximizedPane: ReturnType<typeof useMaximizedPane>["maximizedPane"];
  onToggleMaximizePane: () => void;
}

export function useLayoutControl({
  activeTab,
  activeTabId,
  activeTabLayoutPreset,
  onArrangeActiveTab,
  onSplit,
  maximizedPane,
  onToggleMaximizePane,
}: LayoutControlDeps) {
  const canArrangeActiveTab = activeTab ? layoutLeaves(activeTab.layout).length >= 2 : false;
  const layoutControl = useMemo(
    () => ({
      current: activeTabLayoutPreset,
      canArrange: canArrangeActiveTab,
      onArrange: onArrangeActiveTab,
      onSplit,
      maximized: maximizedPane?.tabId === activeTabId,
      onToggleMaximize: () => onToggleMaximizePane(),
    }),
    [
      activeTabLayoutPreset,
      canArrangeActiveTab,
      onArrangeActiveTab,
      onSplit,
      maximizedPane,
      activeTabId,
      onToggleMaximizePane,
    ],
  );

  return layoutControl;
}
