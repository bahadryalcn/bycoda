import { useCallback, useState } from "react";
import type { SessionSummary } from "../data/sessionStore";
import type { SessionListEntry } from "../model/sessionFolders";
import { isSettledSession, type SessionLifecycleView } from "../model/sessionLifecycle";
import {
  loadSettledSessionsCollapsed,
  saveSettledSessionsCollapsed,
  shelveSettledSessions,
} from "../model/settledShelf";
import { useSessionLifecycleList } from "./useSessionLifecycle";

/**
 * The sidebar's Settled shelf uses records scoped to the project owner's Host.
 */
export function useSettledShelf(
  enabled: boolean,
  remoteViews?: ReadonlyMap<string, SessionLifecycleView>,
) {
  const lifecycle = useSessionLifecycleList(enabled);
  const { views } = lifecycle;
  const [collapsed, setCollapsedState] = useState(loadSettledSessionsCollapsed);
  const isSettled = useCallback(
    (session: SessionSummary) =>
      isSettledSession((enabled ? views : remoteViews)?.get(session.id), session.lastActivityAt),
    [enabled, views, remoteViews],
  );
  const shelve = useCallback(
    (entries: SessionListEntry[]) =>
      enabled || remoteViews ? shelveSettledSessions(entries, isSettled, collapsed) : entries,
    [enabled, remoteViews, isSettled, collapsed],
  );
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    saveSettledSessionsCollapsed(next);
  }, []);
  return { shelve, isSettled, collapsed, setCollapsed, lifecycle };
}
