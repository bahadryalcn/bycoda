/**
 * Pure bookkeeping for tab hibernation. A hidden tab that has not been the
 * active tab for HIBERNATE_AFTER_MS releases its pane tree; the tab itself
 * (layout, title, order, persistence) is untouched. Eligibility comes from
 * idleTabs.ts, so the same rules protect busy, pending or unsent work.
 */

export const HIBERNATE_AFTER_MS = 10 * 60 * 1000;
export const HIBERNATION_CHECK_MS = 60 * 1000;

/**
 * Last time each tab was the active one. The active tab is stamped with `now`.
 * A tab seen for the first time counts as visited then, so restored tabs wait
 * their full window instead of hibernating on the first check. Tabs that are
 * gone are dropped.
 */
export function recordTabVisits(
  visits: ReadonlyMap<string, number>,
  tabIds: readonly string[],
  activeTabId: string,
  now: number,
): Map<string, number> {
  const next = new Map<string, number>();
  for (const id of tabIds) {
    next.set(id, id === activeTabId ? now : (visits.get(id) ?? now));
  }
  return next;
}

/** Tabs that are non-active, eligible, and not visited for at least `afterMs`. */
export function selectHibernatedTabIds({
  tabIds,
  activeTabId,
  visits,
  eligibleIds,
  now,
  afterMs = HIBERNATE_AFTER_MS,
}: {
  tabIds: readonly string[];
  activeTabId: string;
  visits: ReadonlyMap<string, number>;
  eligibleIds: ReadonlySet<string>;
  now: number;
  afterMs?: number;
}): Set<string> {
  const hibernated = new Set<string>();
  for (const id of tabIds) {
    if (id === activeTabId || !eligibleIds.has(id)) continue;
    const seen = visits.get(id);
    if (seen !== undefined && now - seen >= afterMs) hibernated.add(id);
  }
  return hibernated;
}

/** Lets a periodic check keep the previous Set (and skip a re-render) when nothing changed. */
export function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
