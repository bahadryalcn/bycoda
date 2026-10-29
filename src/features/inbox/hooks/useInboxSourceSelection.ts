import { useState } from "react";
import {
  isTrackerSource,
  loadInboxSource,
  resolveInboxSource,
  saveInboxSource,
  visibleInboxSources,
  type InboxSource,
  type InboxSourceConnections,
} from "../model/inboxFilters";

/**
 * The source tab is the user's choice resolved against the connected providers at
 * render time. Losing a connection moves the shown source to the first available
 * one without rewriting the choice or storage; only an explicit `selectSource`
 * persists. The initial resolved source is saved once on mount, since the cached
 * status can still disagree with what storage names. A temporary reveal of
 * another source (`revealSource`) is never persisted.
 */
export function useInboxSourceSelection({
  pullRequestsOnly,
  connections,
}: {
  pullRequestsOnly: boolean;
  connections: InboxSourceConnections;
}) {
  const [chosen, setChosen] = useState<InboxSource>(() => {
    if (pullRequestsOnly) return "github";
    const initial = resolveInboxSource(loadInboxSource(), connections);
    saveInboxSource(initial);
    return initial;
  });
  let source: InboxSource;
  if (pullRequestsOnly) {
    const available = visibleInboxSources(connections).filter(
      (candidate) => !isTrackerSource(candidate),
    );
    source = available.includes(chosen) ? chosen : (available[0] ?? "github");
  } else {
    source = resolveInboxSource(chosen, connections);
  }
  const selectSource = (next: InboxSource) => {
    setChosen(next);
    if (!pullRequestsOnly) saveInboxSource(next);
  };
  return { source, selectSource, revealSource: setChosen };
}
