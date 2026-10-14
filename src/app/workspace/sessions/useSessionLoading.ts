import { useCallback, type MutableRefObject } from "react";
import { flushSync } from "react-dom";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import { getSession, persistFingerprint } from "../../../features/sessions/data/sessionStore";
import { rememberLoadedSession } from "../../../features/sessions/data/sessionCache";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import { leafIds, newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { bindHarnessSession, isLiveHarness } from "../../../integrations/harness";
import { type WindowMovePosition } from "../../model/windowTransferPopout";

export interface SessionLoadingDeps {
  sessionsRef: { current: Session[] };
  setSessions: typeof setSessions;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  onPopOutPane: (paneId: string, position: WindowMovePosition) => void;
  lastPersisted: MutableRefObject<Map<string, string>>;
  loadedSessionCache: MutableRefObject<Map<string, Session>>;
  sessionLoads: MutableRefObject<Map<string, Promise<Session | null>>>;
  sessionLoadEpochs: MutableRefObject<Map<string, number>>;
  openingSessionIds: MutableRefObject<Set<string>>;
  removingSessionIds: MutableRefObject<Set<string>>;
  activeSessionPrefetch: MutableRefObject<Promise<Session | null> | null>;
  sidebarCwd: string;
  refreshHistory: (cwd: string) => Promise<void>;
}

/** Stored-session loading: cache, in-flight loads, open-on-demand and pop-out. */
export function useSessionLoading({
  sessionsRef,
  setSessions,
  setTabs,
  tabsRef,
  onPopOutPane,
  lastPersisted,
  loadedSessionCache,
  sessionLoads,
  sessionLoadEpochs,
  openingSessionIds,
  removingSessionIds,
  activeSessionPrefetch,
  sidebarCwd,
  refreshHistory,
}: SessionLoadingDeps) {
  const invalidateLoadedSession = useCallback((sessionId: string) => {
    openingSessionIds.current.delete(sessionId);
    loadedSessionCache.current.delete(sessionId);
    sessionLoads.current.delete(sessionId);
    sessionLoadEpochs.current.set(sessionId, (sessionLoadEpochs.current.get(sessionId) ?? 0) + 1);
  }, []);

  const loadStoredSession = useCallback((sessionId: string): Promise<Session | null> => {
    const cached = loadedSessionCache.current.get(sessionId);
    if (cached && !cached.historyLoading) {
      // The cache owns closed sessions only. Transfer this reference into
      // live state instead of retaining a stale duplicate while it changes.
      loadedSessionCache.current.delete(sessionId);
      return Promise.resolve(cached);
    }

    if (cached?.historyLoading) loadedSessionCache.current.delete(sessionId);
    const pending = sessionLoads.current.get(sessionId);
    if (pending) return pending;

    const epoch = sessionLoadEpochs.current.get(sessionId) ?? 0;
    const loading = getSession(sessionId, {
      onHydrated: (original, hydrated) => {
        if (
          removingSessionIds.current.has(sessionId) ||
          (sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch
        )
          return;
        // Repairs may finish after a new turn, edit, queue operation or tab
        // reload. Never overwrite that state with the older loaded snapshot.
        const owns = (value: Session) =>
          value.id === sessionId &&
          !value.busy &&
          value.blocks === original.blocks &&
          value.queuedMessages === original.queuedMessages;
        if (
          original.historyLoading &&
          !hydrated.historyLoading &&
          hydrated.providerSessionId &&
          !hydrated.worktreeRemoved &&
          isLiveHarness(hydrated.harness) &&
          sessionsRef.current.some(owns)
        ) {
          bindHarnessSession(
            hydrated.harness,
            hydrated.id,
            hydrated.providerSessionId,
            sessionWorkCwd(hydrated),
            hydrated.providerAccountId,
            hydrated.blocks,
          );
        }
        const cached = loadedSessionCache.current.get(sessionId);
        if (cached && owns(cached)) loadedSessionCache.current.set(sessionId, hydrated);
        setSessions((previous) =>
          previous.map((value) =>
            owns(value)
              ? {
                  ...value,
                  blocks: hydrated.blocks,
                  queuedMessages: hydrated.queuedMessages,
                  queueStatus: hydrated.queueStatus,
                  historyLoading: hydrated.historyLoading,
                  historyLoadError: undefined,
                }
              : value,
          ),
        );
      },
      onHydrationFailed: (original) => {
        if ((sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch) return;
        setSessions((previous) =>
          previous.map((value) =>
            value.id === sessionId && value.blocks === original.blocks && value.historyLoading
              ? {
                  ...value,
                  historyLoadError:
                    "Earlier messages could not be loaded. Reopen this chat to retry.",
                }
              : value,
          ),
        );
      },
    })
      .then((loaded) => {
        if (
          !loaded ||
          removingSessionIds.current.has(sessionId) ||
          (sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch
        ) {
          return null;
        }
        return loaded;
      })
      .catch(() => null);
    sessionLoads.current.set(sessionId, loading);
    void loading.then(() => {
      if (sessionLoads.current.get(sessionId) === loading) {
        sessionLoads.current.delete(sessionId);
      }
    });
    return loading;
  }, []);

  const ensureOpenSession = useCallback(
    async (sessionId: string): Promise<Session | null> => {
      const open = sessionsRef.current.find((session) => session.id === sessionId);
      if (open) return open;

      openingSessionIds.current.add(sessionId);
      const restored = await loadStoredSession(sessionId);
      if (!restored || removingSessionIds.current.has(sessionId)) {
        openingSessionIds.current.delete(sessionId);
        void refreshHistory(sidebarCwd);
        return null;
      }
      loadedSessionCache.current.delete(sessionId);
      const appeared = sessionsRef.current.find((session) => session.id === sessionId);
      if (appeared) return appeared;
      if (
        !restored.historyLoading &&
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
      if (!sessionsRef.current.some((session) => session.id === restored.id)) {
        const next = [...sessionsRef.current, restored];
        sessionsRef.current = next;
        setSessions(next);
      }
      return restored;
    },
    [loadStoredSession, refreshHistory, sidebarCwd],
  );

  const onPopOutSession = useCallback(
    async (
      sessionId: string,
      position: { x: number; y: number; clientX?: number; clientY?: number },
    ) => {
      const session = await ensureOpenSession(sessionId);
      if (!session) return;
      if (!tabsRef.current.some((tab) => leafIds(tab.layout).includes(sessionId))) {
        flushSync(() => {
          const next = [...tabsRef.current, newTab(sessionId)];
          tabsRef.current = next;
          setTabs(next);
        });
      }
      onPopOutPane(sessionId, position);
    },
    [ensureOpenSession, onPopOutPane],
  );

  const onPrefetchHistorySession = useCallback(
    (sessionId: string) => {
      if (
        removingSessionIds.current.has(sessionId) ||
        sessionsRef.current.some((session) => session.id === sessionId) ||
        loadedSessionCache.current.has(sessionId) ||
        sessionLoads.current.has(sessionId) ||
        activeSessionPrefetch.current
      ) {
        return;
      }
      const loading = loadStoredSession(sessionId);
      activeSessionPrefetch.current = loading;
      void loading.then((loaded) => {
        if (
          loaded &&
          !removingSessionIds.current.has(sessionId) &&
          !sessionsRef.current.some((session) => session.id === sessionId)
        ) {
          rememberLoadedSession(loadedSessionCache.current, loaded);
        }
        if (activeSessionPrefetch.current === loading) {
          activeSessionPrefetch.current = null;
        }
      });
    },
    [loadStoredSession],
  );

  return {
    invalidateLoadedSession,
    loadStoredSession,
    ensureOpenSession,
    onPopOutSession,
    onPrefetchHistorySession,
  };
}
