import { useEffect, useRef } from "react";
import { setSessionQueue } from "../data/sessionStore";
import { isRemoteProjectPath } from "../../projects/model/recents";
import type { QueuedMessage, Session } from "../model/session";

/**
 * Write each session's queued follow-ups through to the store the moment they
 * change (add, edit, remove, send), so a crash or kill loses nothing. Queue
 * arrays are replaced rather than mutated, so identity says whether one changed.
 * Remote sessions have no app-side queue: their host owns the conversation.
 */
export function useQueuePersistence(sessions: Session[]): void {
  const written = useRef(new Map<string, QueuedMessage[] | undefined>());
  useEffect(() => {
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
        written.current.delete(session.id);
      });
    }
  }, [sessions]);
}
