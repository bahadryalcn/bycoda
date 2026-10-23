import { useEffect, useRef } from "react";
import { setSessionQueue } from "../data/sessionStore";
import { isRemoteProjectPath } from "../../projects/model/recents";
import type { QueuedMessage } from "../model/session";
import { getShellSessions, subscribeShell } from "../model/sessionsStore";

/**
 * Write each session's queued follow-ups through to the store the moment they
 * change (add, edit, remove, send), so a crash or kill loses nothing. Queue
 * arrays are replaced rather than mutated, so identity says whether one changed.
 * Remote sessions have no app-side queue: their host owns the conversation.
 */
export function useQueuePersistence(): void {
  const written = useRef(new Map<string, QueuedMessage[] | undefined>());
  useEffect(() => {
    const sync = () => {
      const sessions = getShellSessions();
      const live = new Set(sessions.map((session) => session.id));
      for (const id of written.current.keys()) {
        if (!live.has(id)) written.current.delete(id);
      }
      for (const session of sessions) {
        if (session.inboxAsk || isRemoteProjectPath(session.cwd)) continue;
        const queue = session.queuedMessages;
        if (written.current.get(session.id) === queue) continue;
        // Nothing queued and nothing ever written: no row to create or clear.
        if (!queue?.length && !written.current.has(session.id)) {
          written.current.set(session.id, queue);
          continue;
        }
        written.current.set(session.id, queue);
        void setSessionQueue(session.id, queue).catch(() => {
          // Retry on the next change instead of trusting a write that failed.
          if (written.current.get(session.id) === queue) written.current.delete(session.id);
        });
      }
    };
    const unsubscribe = subscribeShell(sync);
    sync();
    return unsubscribe;
  }, []);
}
