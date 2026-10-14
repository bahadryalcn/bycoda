import { useCallback, type MutableRefObject } from "react";
import { type Session } from "../../../features/sessions/model/session";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
import type { useHistorySessionArchive } from "./useHistorySessionArchive";
import type { useHistorySessionDelete } from "./useHistorySessionDelete";

export interface TitleTabActionsDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  onArchiveHistorySessions: ReturnType<typeof useHistorySessionArchive>["onArchiveHistorySessions"];
  onDeleteHistorySession: ReturnType<typeof useHistorySessionDelete>["onDeleteHistorySession"];
  onDeleteHistorySessions: ReturnType<typeof useHistorySessionDelete>["onDeleteHistorySessions"];
}

export function useTitleTabActions(deps: TitleTabActionsDeps) {
  const {
    tabsRef,
    sessionsRef,
    onArchiveHistorySessions,
    onDeleteHistorySession,
    onDeleteHistorySessions,
  } = deps;

  const sessionIdsInTitleTab = useCallback((tabId: string): string[] => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    if (!tab) return [];
    const openSessionIds = new Set(sessionsRef.current.map((session) => session.id));
    return leafIds(tab.layout).filter((id) => openSessionIds.has(id));
  }, []);

  const onArchiveTitleTab = useCallback(
    (tabId: string) => {
      const sessionIds = sessionIdsInTitleTab(tabId);
      void onArchiveHistorySessions(sessionIds, true);
    },
    [onArchiveHistorySessions, sessionIdsInTitleTab],
  );

  const onDeleteTitleTab = useCallback(
    (tabId: string) => {
      const sessionIds = sessionIdsInTitleTab(tabId);
      if (sessionIds.length === 1) {
        void onDeleteHistorySession(sessionIds[0]);
      } else if (sessionIds.length > 1) {
        void onDeleteHistorySessions(sessionIds);
      }
    },
    [onDeleteHistorySession, onDeleteHistorySessions, sessionIdsInTitleTab],
  );

  return { onArchiveTitleTab, onDeleteTitleTab };
}
