import { useCallback } from "react";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";

export interface TabNavigationDeps {
  activateTab: (id: string) => void;
  activeTabId: string;
  deckProjectTabs: readonly WorkspaceTab[];
}

export interface TabNavigation {
  onNext: () => void;
  onPrev: () => void;
}

/** Cycles through project tabs. Visit history belongs to the window navigation. */
export function useTabNavigation({
  activateTab,
  activeTabId,
  deckProjectTabs,
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

  return { onNext, onPrev };
}
