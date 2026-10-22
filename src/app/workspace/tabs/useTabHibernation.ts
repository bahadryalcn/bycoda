import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../../../features/sessions/model/session";
import { hasUnsentComposerDraft } from "../../../features/sessions/model/draftCache";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import { idleWorkspaceTabIds, tabIsIdle } from "../../../features/workspace/model/idleTabs";
import {
  HIBERNATION_CHECK_MS,
  recordTabVisits,
  sameIdSet,
  selectHibernatedTabIds,
} from "../../../features/workspace/model/tabHibernation";

export type TabHibernationInput = {
  tabs: readonly WorkspaceTab[];
  activeTabId: string;
  sessions: readonly Session[];
  busySessionIds: ReadonlySet<string>;
  unseenFinishedIds: ReadonlySet<string>;
  dirtyFileIds: ReadonlySet<string>;
  movingTabIds: ReadonlySet<string>;
};

/**
 * Tracks which hidden tabs should release their pane tree. One interval for the
 * window; state changes only when the hibernated set itself changes, so a quiet
 * check causes no re-render. Returns a predicate for render: a tab is
 * hibernated only while it is hidden and still idle. A tab that turns busy or
 * is activated mounts again on that same render, without waiting for the next check.
 */
export function useTabHibernation(input: TabHibernationInput): (tab: WorkspaceTab) => boolean {
  const latest = useRef(input);
  const visits = useRef(new Map<string, number>());
  const lastActive = useRef(input.activeTabId);
  const [hibernated, setHibernated] = useState<ReadonlySet<string>>(() => new Set());

  // Declared first so the effects below see this commit's values.
  useLayoutEffect(() => {
    latest.current = input;
  });

  useLayoutEffect(() => {
    const now = Date.now();
    const previous = lastActive.current;
    lastActive.current = input.activeTabId;
    if (previous !== input.activeTabId) visits.current.set(previous, now);
    visits.current = recordTabVisits(
      visits.current,
      input.tabs.map((tab) => tab.id),
      input.activeTabId,
      now,
    );
  }, [input.activeTabId, input.tabs]);

  useEffect(() => {
    const check = () => {
      const current = latest.current;
      const now = Date.now();
      const tabIds = current.tabs.map((tab) => tab.id);
      visits.current = recordTabVisits(visits.current, tabIds, current.activeTabId, now);
      const eligibleIds = new Set(
        idleWorkspaceTabIds({ ...current, hasComposerDraft: hasUnsentComposerDraft }),
      );
      const next = selectHibernatedTabIds({
        tabIds,
        activeTabId: current.activeTabId,
        visits: visits.current,
        eligibleIds,
        now,
      });
      setHibernated((previous) => (sameIdSet(previous, next) ? previous : next));
    };
    const timer = setInterval(check, HIBERNATION_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  const sessionsById = useMemo(
    () => new Map(input.sessions.map((session) => [session.id, session])),
    [input.sessions],
  );

  return useCallback(
    (tab: WorkspaceTab) =>
      hibernated.has(tab.id) &&
      tab.id !== input.activeTabId &&
      tabIsIdle(
        tab,
        {
          busySessionIds: input.busySessionIds,
          unseenFinishedIds: input.unseenFinishedIds,
          dirtyFileIds: input.dirtyFileIds,
          movingTabIds: input.movingTabIds,
          hasComposerDraft: hasUnsentComposerDraft,
        },
        sessionsById,
      ),
    [
      hibernated,
      input.activeTabId,
      input.busySessionIds,
      input.unseenFinishedIds,
      input.dirtyFileIds,
      input.movingTabIds,
      sessionsById,
    ],
  );
}
