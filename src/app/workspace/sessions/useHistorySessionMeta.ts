import { message } from "@tauri-apps/plugin-dialog";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { type LinkedWorkItem, type Session } from "../../../features/sessions/model/session";
import {
  setSessionLinkedWorkItem,
  setSessionPinned,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";
import {
  mergeProjectHistorySummary,
  summaryFromSession,
} from "../../../features/sessions/data/sessionHistory";
import { appName } from "../../../shared/lib/appName";
import { t } from "../../../shared/i18n";
import type { useLinkedWorkItemPanelState } from "../bridges/useLinkedWorkItemPanels";
import type { useSessionLoading } from "./useSessionLoading";

export interface HistorySessionMetaDeps {
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  history: SessionSummary[];
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  setStoredLinkedSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  loadedSessionCache: MutableRefObject<Map<string, Session>>;
  invalidateLoadedSession: ReturnType<typeof useSessionLoading>["invalidateLoadedSession"];
  setLinkedWorkItemPanels: ReturnType<
    typeof useLinkedWorkItemPanelState
  >["setLinkedWorkItemPanels"];
  refreshHistory: (cwd: string) => Promise<unknown>;
  sidebarCwd: string;
}

export function useHistorySessionMeta(deps: HistorySessionMetaDeps) {
  const {
    sessionsRef,
    setSessions,
    history,
    setHistory,
    setStoredLinkedSessions,
    loadedSessionCache,
    invalidateLoadedSession,
    setLinkedWorkItemPanels,
    refreshHistory,
    sidebarCwd,
  } = deps;

  const onPinHistorySession = useCallback(async (sessionId: string, pinned: boolean) => {
    const open = sessionsRef.current.find((session) => session.id === sessionId);
    try {
      if (open && shouldPersistSession(open)) {
        const saved = await upsertSession(open);
        if (!saved) throw new Error(t("Could not save changes"));
      }
      await setSessionPinned(sessionId, pinned);
    } catch (error) {
      await message(`${t("Could not save changes")}\n\n${String(error)}`, {
        title: appName(),
        kind: "error",
      });
      return;
    }
    setHistory((current) => {
      const existing = current.find((entry) => entry.id === sessionId);
      if (existing) {
        return mergeProjectHistorySummary(current, { ...existing, pinned });
      }
      if (!open) return current;
      return mergeProjectHistorySummary(current, {
        ...summaryFromSession(open),
        pinned,
      });
    });
  }, []);

  const onSetHistorySessionLinkedWorkItem = useCallback(
    (sessionId: string, linkedWorkItem: LinkedWorkItem | undefined) => {
      const previousLinkedWorkItem =
        sessionsRef.current.find((session) => session.id === sessionId)?.linkedWorkItem ??
        history.find((session) => session.id === sessionId)?.linkedWorkItem;
      invalidateLoadedSession(sessionId);
      loadedSessionCache.current.delete(sessionId);

      const nextSessions = sessionsRef.current.map((session) =>
        session.id === sessionId ? { ...session, linkedWorkItem } : session,
      );
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setHistory((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, linkedWorkItem } : session,
        ),
      );
      setStoredLinkedSessions((current) =>
        linkedWorkItem
          ? current.map((session) =>
              session.id === sessionId ? { ...session, linkedWorkItem } : session,
            )
          : current.filter((session) => session.id !== sessionId),
      );
      setLinkedWorkItemPanels((current) => {
        if (!current.has(sessionId)) return current;
        const next = new Map(current);
        next.delete(sessionId);
        return next;
      });

      void setSessionLinkedWorkItem(sessionId, linkedWorkItem).catch((error) => {
        const rolledBackSessions = sessionsRef.current.map((session) =>
          session.id === sessionId && session.linkedWorkItem === linkedWorkItem
            ? { ...session, linkedWorkItem: previousLinkedWorkItem }
            : session,
        );
        sessionsRef.current = rolledBackSessions;
        setSessions(rolledBackSessions);
        setHistory((current) =>
          current.map((session) =>
            session.id === sessionId && session.linkedWorkItem === linkedWorkItem
              ? { ...session, linkedWorkItem: previousLinkedWorkItem }
              : session,
          ),
        );
        setStoredLinkedSessions((current) =>
          previousLinkedWorkItem
            ? current.map((session) =>
                session.id === sessionId
                  ? {
                      ...session,
                      linkedWorkItem: previousLinkedWorkItem,
                    }
                  : session,
              )
            : current.filter((session) => session.id !== sessionId),
        );
        void refreshHistory(sidebarCwd);
        void message(`Could not update this conversation's GitHub link.\n\n${String(error)}`, {
          title: appName(),
          kind: "error",
        });
      });
    },
    [history, invalidateLoadedSession, refreshHistory, sidebarCwd],
  );

  const onPinHistorySessions = useCallback(
    async (sessionIds: readonly string[], pinned: boolean) => {
      await Promise.all(sessionIds.map((sessionId) => onPinHistorySession(sessionId, pinned)));
    },
    [onPinHistorySession],
  );

  return {
    onPinHistorySession,
    onPinHistorySessions,
    onSetHistorySessionLinkedWorkItem,
  };
}
