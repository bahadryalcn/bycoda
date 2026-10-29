import { useState, type Dispatch, type SetStateAction } from "react";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
import type { LinkedWorkItemPanelState } from "../helpers/types";

type Panels = ReadonlyMap<string, LinkedWorkItemPanelState>;

/** The panels whose session is still a pane of an open tab; the input when none is dropped. */
export function pruneLinkedWorkItemPanels(panels: Panels, tabs: readonly WorkspaceTab[]): Panels {
  const openSessionIds = new Set(tabs.flatMap((tab) => leafIds(tab.layout)));
  if ([...panels.keys()].every((id) => openSessionIds.has(id))) return panels;
  return new Map([...panels].filter(([id]) => openSessionIds.has(id)));
}

/**
 * Panels are tab-local UI. They stay mounted while their tab is in the workspace
 * so switching away preserves the fetched issue and its UI state, then are
 * discarded when their session leaves every open tab. Pruned while rendering,
 * when the tab list changes, rather than in an effect after the commit. Pruning
 * stays in stored state (not a read-site filter) so a panel cannot come back
 * with stale content if its session later returns to a tab.
 */
export function usePruneLinkedWorkItemPanels(
  tabs: readonly WorkspaceTab[],
  panels: Panels,
  setPanels: Dispatch<SetStateAction<Panels>>,
): Panels {
  const [prunedForTabs, setPrunedForTabs] = useState(tabs);
  if (prunedForTabs === tabs) return panels;
  setPrunedForTabs(tabs);
  const pruned = pruneLinkedWorkItemPanels(panels, tabs);
  if (pruned !== panels) setPanels(pruned);
  return pruned;
}
