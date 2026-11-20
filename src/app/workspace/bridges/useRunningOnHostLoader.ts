import { useCallback, useRef, type MutableRefObject } from "react";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import type { Session } from "../../../features/sessions/model/session";
import { sessionWorkCwd } from "../../../features/sessions/model/session";
import { getSession, persistFingerprint } from "../../../features/sessions/data/sessionStore";
import { bindHarnessSession, isLiveHarness } from "../../../integrations/harness";

export interface RunningOnHostLoaderDeps {
  loadRunningOnHostRef: MutableRefObject<((ids: string[]) => void) | undefined>;
  openingSessionIds: MutableRefObject<Set<string>>;
  removingSessionIds: MutableRefObject<Set<string>>;
  loadedSessionCache: MutableRefObject<Map<string, Session>>;
  lastPersisted: MutableRefObject<Map<string, string>>;
}

/** Loads sessions this machine's host runs for another computer, so the
 * Working card shows them without a tab; they unload once seen after done. */
export function useRunningOnHostLoader({
  loadRunningOnHostRef,
  openingSessionIds,
  removingSessionIds,
  loadedSessionCache,
  lastPersisted,
}: RunningOnHostLoaderDeps): void {
  const loadingIds = useRef(new Set<string>());
  const loadRunningOnHost = useCallback(
    (sessionIds: string[]) => {
      for (const sessionId of sessionIds) {
        if (
          openingSessionIds.current.has(sessionId) ||
          removingSessionIds.current.has(sessionId) ||
          loadingIds.current.has(sessionId) ||
          sessionsRef.current.some((session) => session.id === sessionId)
        )
          continue;
        loadingIds.current.add(sessionId);
        void getSession(sessionId)
          .then((restored) => {
            if (
              !restored ||
              restored.inboxAsk ||
              removingSessionIds.current.has(sessionId) ||
              sessionsRef.current.some((session) => session.id === sessionId)
            )
              return;
            loadedSessionCache.current.delete(sessionId);
            if (
              !restored.worktreeRemoved &&
              restored.providerSessionId &&
              isLiveHarness(restored.harness)
            ) {
              bindHarnessSession(
                restored.harness,
                restored.id,
                restored.providerSessionId,
                sessionWorkCwd(restored),
                restored.providerAccountId,
                restored.blocks,
              );
            }
            lastPersisted.current.set(restored.id, persistFingerprint(restored));
            const next = [
              ...sessionsRef.current,
              { ...restored, busy: false, continuingElsewhere: true },
            ];
            sessionsRef.current = next;
            setSessions(next);
          })
          .catch((error) => console.warn("Running Host conversation could not be loaded", error))
          .finally(() => loadingIds.current.delete(sessionId));
      }
    },
    [removingSessionIds, loadedSessionCache, lastPersisted, openingSessionIds],
  );
  loadRunningOnHostRef.current = loadRunningOnHost;
}
