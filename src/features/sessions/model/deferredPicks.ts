import { isPreparingHandoff } from "./handoff";
import { getSessions, subscribeSessionCommits } from "./sessionsStore";

/**
 * Model and account picks made while a provider handoff is being prepared. The
 * handoff owns the provider and account until it ends, so a pick would race it;
 * instead of refusing, the newest pick per kind waits and runs once the
 * handoff is over (finished, failed or cancelled).
 */
const waiting = new Map<string, Map<string, () => void>>();
let unsubscribe: (() => void) | null = null;

function settle(): void {
  const sessions = getSessions();
  for (const [sessionId, picks] of Array.from(waiting)) {
    const session = sessions.find((entry) => entry.id === sessionId);
    // A closed conversation takes no pick; nothing is lost with it.
    if (session && isPreparingHandoff(session)) continue;
    waiting.delete(sessionId);
    if (!session) continue;
    // Not inside the store commit that ended the handoff: the pick reads and writes sessions itself.
    for (const run of picks.values()) {
      queueMicrotask(() => {
        try {
          run();
        } catch (error) {
          console.warn("A deferred pick could not be applied", error);
        }
      });
    }
  }
  if (waiting.size === 0) {
    unsubscribe?.();
    unsubscribe = null;
  }
}

/** Runs `run` after the handoff of `sessionId` ends. A newer pick of the same `kind` replaces the waiting one. */
export function deferPickUntilHandoffEnds(sessionId: string, kind: string, run: () => void): void {
  const picks = waiting.get(sessionId) ?? new Map<string, () => void>();
  picks.set(kind, run);
  waiting.set(sessionId, picks);
  unsubscribe ??= subscribeSessionCommits(() => settle());
  // The handoff may have ended between the refusal and now.
  settle();
}
