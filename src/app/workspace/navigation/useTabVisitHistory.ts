import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  canTabVisitBack,
  canTabVisitForward,
  emptyTabVisitHistory,
  pruneTabVisitHistory,
  recordTabVisit,
  type TabVisitHistory,
} from "../../../features/workspace/model/tabVisitHistory";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";

export interface TabVisitNav {
  canBack: boolean;
  canForward: boolean;
}

export interface TabVisitState {
  tabVisitRef: MutableRefObject<TabVisitHistory>;
  tabVisitFromHistoryRef: MutableRefObject<boolean>;
  tabVisitNav: TabVisitNav;
  commitTabVisit: (history: TabVisitHistory) => void;
}

/**
 * Tab visit history refs and back/forward availability. Call where the refs were
 * declared; the recording effect lives in `useTabVisitRecorder` at its original position.
 */
export function useTabVisitState(activeTabId: string): TabVisitState {
  const tabVisitRef = useRef(emptyTabVisitHistory(activeTabId));
  const tabVisitFromHistoryRef = useRef(false);
  const [tabVisitNav, setTabVisitNav] = useState<TabVisitNav>({
    canBack: false,
    canForward: false,
  });

  const commitTabVisit = useCallback((history: TabVisitHistory) => {
    tabVisitRef.current = history;
    const canBack = canTabVisitBack(history);
    const canForward = canTabVisitForward(history);
    setTabVisitNav((prev) =>
      prev.canBack === canBack && prev.canForward === canForward ? prev : { canBack, canForward },
    );
  }, []);

  return { tabVisitRef, tabVisitFromHistoryRef, tabVisitNav, commitTabVisit };
}

export interface TabVisitRecorderDeps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  tabVisitRef: MutableRefObject<TabVisitHistory>;
  tabVisitFromHistoryRef: MutableRefObject<boolean>;
  commitTabVisit: (history: TabVisitHistory) => void;
}

/** Records each active-tab change into visit history and prunes closed tabs. */
export function useTabVisitRecorder({
  tabs,
  activeTabId,
  tabVisitRef,
  tabVisitFromHistoryRef,
  commitTabVisit,
}: TabVisitRecorderDeps): void {
  useEffect(() => {
    const openIds = new Set(tabs.map((tab) => tab.id));
    let next = pruneTabVisitHistory(tabVisitRef.current, openIds, activeTabId);
    if (tabVisitFromHistoryRef.current) {
      tabVisitFromHistoryRef.current = false;
    } else if (next.current !== activeTabId) {
      next = recordTabVisit(next, activeTabId);
    }
    commitTabVisit(pruneTabVisitHistory(next, openIds, activeTabId));
  }, [activeTabId, commitTabVisit, tabs]);
}
