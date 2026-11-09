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
  const shelve = useCallback(
    (entries: SessionListEntry[]) =>
      enabled
        ? shelveSettledSessions(
            entries,
            (session: SessionSummary) =>
              isSettledSession(views.get(session.id), session.lastActivityAt),
            collapsed,
          )
        : entries,
    [enabled, views, collapsed],
  );
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    saveSettledSessionsCollapsed(next);
  }, []);
  return { shelve, setCollapsed };
}
