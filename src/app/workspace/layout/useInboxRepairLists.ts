import { useMemo } from "react";
import { useStableValue } from "../../../shared/hooks/useStableValue";
import { sameShallowItems } from "../helpers/stableProps";
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
  // Both lists are rebuilt on every shell change; keeping equal results lets the
  // memoized tool panels skip those renders.
  const relatedSessions = useMemo(() => {
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
  const inboxRelatedSessions = useStableValue(relatedSessions, sameShallowItems);
  const repairSessions = useStableValue(
    useMemo(() => ciRepairSessions(history, sessions), [history, sessions]),
    sameShallowItems,
  );

  return { inboxRelatedSessions, repairSessions };
}
