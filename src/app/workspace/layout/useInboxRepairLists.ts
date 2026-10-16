import { useMemo } from "react";
import { type SessionSummary } from "../../../features/sessions/data/sessionStore";
import { type Session } from "../../../features/sessions/model/session";
import { summaryFromSession } from "../../../features/sessions/data/sessionHistory";
import { ciRepairSessions } from "../../../features/inbox/model/ciRepairSessions";

export interface InboxRepairListsDeps {
  storedLinkedSessions: SessionSummary[];
  history: SessionSummary[];
  sessions: Session[];
}

export function useInboxRepairLists({ storedLinkedSessions, history, sessions }: InboxRepairListsDeps) {
  const inboxRelatedSessions = useMemo(() => {
    const byId = new Map<string, SessionSummary>();
    for (const session of storedLinkedSessions) byId.set(session.id, session);
    for (const session of history) {
      if (session.linkedWorkItem) byId.set(session.id, session);
    }
    for (const session of sessions) {
      if (session.inboxAsk || !session.linkedWorkItem) continue;
      const current = byId.get(session.id);
      const summary = summaryFromSession(session);
      byId.set(
        session.id,
        current
          ? {
              ...current,
              harness: summary.harness,
              model: summary.model,
              runtimeMode: summary.runtimeMode,
              title: summary.title,
              cwd: summary.cwd,
              linkedWorkItem: summary.linkedWorkItem,
            }
          : summary,
      );
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }, [history, sessions, storedLinkedSessions]);
  const repairSessions = useMemo(() => ciRepairSessions(history, sessions), [history, sessions]);

  return { inboxRelatedSessions, repairSessions };
}
