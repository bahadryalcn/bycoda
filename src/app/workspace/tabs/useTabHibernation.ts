import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getShellSessions,
  useShellSessionsSelector,
} from "../../../features/sessions/model/sessionsStore";
import { hasUnsentComposerDraft } from "../../../features/sessions/model/draftCache";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import { idleWorkspaceTabIds, tabIsIdle } from "../../../features/workspace/model/idleTabs";
import {
  expiredUnseenSessionIds,
  HIBERNATION_CHECK_MS,
  recordTabVisits,
  sameIdSet,
  selectHibernatedTabIds,
  trackUnseenSince,
} from "../../../features/workspace/model/tabHibernation";

export type TabHibernationInput = {
  tabs: readonly WorkspaceTab[];
  activeTabId: string;
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
  const unseenSince = useRef(new Map<string, number>());
  const expiredUnseen = useRef<ReadonlySet<string>>(new Set());
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
      unseenSince.current = trackUnseenSince(unseenSince.current, current.unseenFinishedIds, now);
      expiredUnseen.current = expiredUnseenSessionIds(unseenSince.current, now);
      const eligibleIds = new Set(
        idleWorkspaceTabIds({
          ...current,
          expiredUnseenIds: expiredUnseen.current,
          sessions: getShellSessions(),
          hasComposerDraft: hasUnsentComposerDraft,
        }),
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

  // The hibernated tabs that are still idle. Sessions come from the shell store,
  // and the result is a string, so the caller re-renders only when a hibernated
  // tab wakes (turns busy, waits for input) or another one goes to sleep.
  const asleep = useShellSessionsSelector((sessions) => {
    if (hibernated.size === 0) return "";
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    return input.tabs
      .filter(
        (tab) =>
          hibernated.has(tab.id) &&
          tab.id !== input.activeTabId &&
          tabIsIdle(
            tab,
            {
              busySessionIds: input.busySessionIds,
              unseenFinishedIds: input.unseenFinishedIds,
              expiredUnseenIds: expiredUnseen.current,
              dirtyFileIds: input.dirtyFileIds,
              movingTabIds: input.movingTabIds,
              hasComposerDraft: hasUnsentComposerDraft,
            },
            sessionsById,
          ),
      )
      .map((tab) => tab.id)
      .join(",");
  });
  const asleepIds = useMemo(() => new Set(asleep ? asleep.split(",") : []), [asleep]);
  return useCallback((tab: WorkspaceTab) => asleepIds.has(tab.id), [asleepIds]);
}
