import { useCallback, type MutableRefObject } from "react";
import {
  pruneTabVisitHistory,
  tabVisitBack,
  tabVisitForward,
  type TabVisitHistory,
} from "../../../features/workspace/model/tabVisitHistory";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";

export interface TabNavigationDeps {
  activateTab: (id: string) => void;
  activeTabId: string;
  deckProjectTabs: readonly WorkspaceTab[];
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  activeTabIdRef: MutableRefObject<string>;
  tabVisitRef: MutableRefObject<TabVisitHistory>;
  tabVisitFromHistoryRef: MutableRefObject<boolean>;
  commitTabVisit: (history: TabVisitHistory) => void;
}

export interface TabNavigation {
  onNext: () => void;
  onPrev: () => void;
  onVisitBack: () => void;
  onVisitForward: () => void;
}

/** Steps through project tabs and walks the tab visit history. */
export function useTabNavigation({
  activateTab,
  activeTabId,
  deckProjectTabs,
  tabsRef,
  activeTabIdRef,
  tabVisitRef,
  tabVisitFromHistoryRef,
  commitTabVisit,
}: TabNavigationDeps): TabNavigation {
  const onNext = useCallback(() => {
    const index = deckProjectTabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0) activateTab(deckProjectTabs[(index + 1) % deckProjectTabs.length].id);
  }, [activateTab, activeTabId, deckProjectTabs]);

  const onPrev = useCallback(() => {
    const index = deckProjectTabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0) {
      activateTab(
        deckProjectTabs[(index - 1 + deckProjectTabs.length) % deckProjectTabs.length].id,
      );
    }
  }, [activateTab, activeTabId, deckProjectTabs]);

  const onVisitBack = useCallback(() => {
    const openIds = new Set(tabsRef.current.map((tab) => tab.id));
    const pruned = pruneTabVisitHistory(tabVisitRef.current, openIds, activeTabIdRef.current);
    const next = tabVisitBack(pruned);
    if (!next || !openIds.has(next.current)) return;
    tabVisitFromHistoryRef.current = true;
    commitTabVisit(next);
    activateTab(next.current);
  }, [activateTab, commitTabVisit]);

  const onVisitForward = useCallback(() => {
    const openIds = new Set(tabsRef.current.map((tab) => tab.id));
    const pruned = pruneTabVisitHistory(tabVisitRef.current, openIds, activeTabIdRef.current);
    const next = tabVisitForward(pruned);
    if (!next || !openIds.has(next.current)) return;
    tabVisitFromHistoryRef.current = true;
    commitTabVisit(next);
    activateTab(next.current);
  }, [activateTab, commitTabVisit]);

  return { onNext, onPrev, onVisitBack, onVisitForward };
}
