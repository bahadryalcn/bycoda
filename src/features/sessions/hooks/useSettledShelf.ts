import { useCallback, useState } from "react";
import type { SessionSummary } from "../data/sessionStore";
import type { SessionListEntry } from "../model/sessionFolders";
import { isSettledSession } from "../model/sessionLifecycle";
import {
  loadSettledSessionsCollapsed,
  saveSettledSessionsCollapsed,
  shelveSettledSessions,
} from "../model/settledShelf";
import { useSessionLifecycleList } from "./useSessionLifecycle";

/**
 * The sidebar's Settled shelf for sessions of this computer's Host. `enabled` is false for lists
 * of another machine, whose sessions this Host's records do not describe.
 */
export function useSettledShelf(enabled: boolean) {
  const { views } = useSessionLifecycleList(enabled);
  const [collapsed, setCollapsedState] = useState(loadSettledSessionsCollapsed);
  const isSettled = useCallback(
    (session: SessionSummary) =>
      enabled && isSettledSession(views.get(session.id), session.lastActivityAt),
    [enabled, views],
  );
  const shelve = useCallback(
    (entries: SessionListEntry[]) =>
      enabled ? shelveSettledSessions(entries, isSettled, collapsed) : entries,
    [enabled, isSettled, collapsed],
  );
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    saveSettledSessionsCollapsed(next);
  }, []);
  return { shelve, isSettled, setCollapsed };
}
