import { useEffect, useRef } from "react";
import { notifySession, pendingInputNotifications } from "../model/notifications";
import type { Session } from "../../sessions/model/session";

export function useInputNotifications(sessions: Session[], activeSessionId: string | undefined) {
  const inputNotifications = pendingInputNotifications(sessions);
  const notifiedInputIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const notified = notifiedInputIdsRef.current;
    for (const key of notified) {
      if (!inputNotifications.has(key)) notified.delete(key);
    }
    const notifiedSessions = new Set<string>();
    for (const entry of inputNotifications) {
      const [key, { session, event }] = entry;
      if (notified.has(key) || notifiedSessions.has(session.id)) continue;
      notifiedSessions.add(session.id);
      // Coalesce this render's banners per session, but leave other requests
      // eligible for the next update (including resolution of the first one).
      notified.add(key);
      void notifySession(session, event, session.id === activeSessionId);
    }
  }, [activeSessionId, inputNotifications]);
}
