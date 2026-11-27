import { useCallback, useRef, type MutableRefObject } from "react";
import { flushSync } from "react-dom";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  getEarlierStoredHistory,
  getSession,
  persistFingerprint,
  type SessionHydrationOptions,
} from "../../../features/sessions/data/sessionStore";
import { rememberLoadedSession } from "../../../features/sessions/data/sessionCache";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import { leafIds, newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { bindHarnessSession, isLiveHarness } from "../../../integrations/harness";
import { type WindowMovePosition } from "../../model/windowTransferPopout";
import {
  reserveSessionWindow,
  remoteSessionOwnershipKey,
} from "../../model/sessionWindowOwnership";
import { remoteSessionFor } from "../../../features/connections/model/connections";
import { prefetchLocalSessionPage } from "../../../features/connections/model/localSessionPagePreview";
import { isRemoteProjectPath, sameProjectPath } from "../../../features/projects/model/recents";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";

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

type HydrationOwners = Pick<
  SessionLoadingDeps,
  "sessionsRef" | "setSessions" | "loadedSessionCache" | "removingSessionIds" | "sessionLoadEpochs"
>;

/**
 * Publishes a stored session's earlier pages into live state, only while the live copy is still the
 * one that asked. `adopted` is that copy for a retry, whose fresh tail read is a different object
 * with the same content: the turns on screen are kept until the first page replaces them.
 */
export function hydrationHandlers(
  {
    sessionsRef,
    setSessions,
    loadedSessionCache,
    removingSessionIds,
    sessionLoadEpochs,
  }: HydrationOwners,
  sessionId: string,
  epoch: number,
  adopted?: Session,
): SessionHydrationOptions {
  let owner = adopted;
  return {
    onHydrated: (original, hydrated) => {
      const asked = owner ?? original;
      owner = undefined;
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
        value.blocks === asked.blocks &&
        value.queuedMessages === asked.queuedMessages;
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
                storedHistory: hydrated.storedHistory,
                historyLoadError: undefined,
              }
            : value,
        ),
      );
    },
    onHydrationFailed: (original) => {
      const asked = owner ?? original;
      if ((sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch) return;
      setSessions((previous) =>
        previous.map((value) =>
          value.id === sessionId && value.blocks === asked.blocks && value.historyLoading
            ? {
                ...value,
                historyLoadError:
                  "Earlier messages could not be loaded. Reopen this chat to retry.",
              }
            : value,
        ),
      );
    },
  };
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
      ...hydrationHandlers(
        { sessionsRef, setSessions, loadedSessionCache, removingSessionIds, sessionLoadEpochs },
        sessionId,
        epoch,
      ),
      deferHistory: true,
      cachedPreview: cached?.storedHistory ? cached : undefined,
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

  const onLoadSessionHistory = useCallback(
    async (sessionId: string, findAll?: AbortSignal): Promise<number> => {
      const original = sessionsRef.current.find((session) => session.id === sessionId);
      const privacy = getGroupLockView();
      if (
        !original?.storedHistory ||
        removingSessionIds.current.has(sessionId) ||
        isProjectLockedIn(privacy.lock, original.cwd) ||
        isProjectLockedIn(privacy.lock, sessionWorkCwd(original))
      )
        return 0;
      const pages: Session["blocks"][] = [];
      let cursor = original.storedHistory;
      let current: Session | undefined = original;
      do {
        if (findAll?.aborted) return 0;
        const page = await getEarlierStoredHistory(
          { ...original, storedHistory: cursor },
          !!findAll,
        );
        current = sessionsRef.current.find((session) => session.id === sessionId);
        if (
          !page ||
          !current ||
          findAll?.aborted ||
          removingSessionIds.current.has(sessionId) ||
          getGroupLockView() !== privacy ||
          current.storedHistory !== original.storedHistory ||
          current.cwd !== original.cwd ||
          sessionWorkCwd(current) !== sessionWorkCwd(original)
        )
          return 0;
        pages.push(page.blocks);
        cursor = page.cursor;
      } while (findAll && cursor.before != null);
      // Explicit Find reads one pinned revision, without publishing each older page
      // to every session subscriber. Normal upward scrolling still reads a single page.
      const older = pages.length === 1 ? pages[0] : pages.reverse().flat();
      setSessions((previous) =>
        previous.map((session) =>
          session === current
            ? {
                ...session,
                blocks: [...older, ...session.blocks],
                storedHistory: cursor,
              }
            : session,
        ),
      );
      return older.length;
    },
    [removingSessionIds, sessionsRef, setSessions],
  );

  const historyForExecution = useRef(new Map<string, Promise<boolean>>());
  // Only the most recently edited tail is warmed. Closing or replacing that session can release
  // the full transcript, even when the user never sends the draft.
  const warmedHistory = useRef(
    new WeakMap<
      Session,
      {
        privacy: ReturnType<typeof getGroupLockView>;
        epoch: number;
        read: Promise<Session | null>;
      }
    >(),
  );
  const ensureSessionHistoryForExecution = useCallback(
    (sessionId: string, mode?: "prefetch"): Promise<boolean> => {
      const pending = historyForExecution.current.get(sessionId);
      if (pending) return pending;
      const original = sessionsRef.current.find((session) => session.id === sessionId);
      if (!original?.storedHistory) return Promise.resolve(!!original && !original.historyLoading);
      const privacy = getGroupLockView();
      if (
        isProjectLockedIn(privacy.lock, original.cwd) ||
        isProjectLockedIn(privacy.lock, sessionWorkCwd(original))
      )
        return Promise.resolve(false);
      const epoch = sessionLoadEpochs.current.get(sessionId) ?? 0;
      const cached = warmedHistory.current.get(original);
      const warm = cached?.privacy === privacy && cached.epoch === epoch ? cached.read : undefined;
      if (mode === "prefetch") {
        if (original.busy || removingSessionIds.current.has(sessionId))
          return Promise.resolve(false);
        if (warm) return warm.then(Boolean);
        const read = getSession(sessionId);
        const cache = new WeakMap([[original, { privacy, epoch, read }]]);
        warmedHistory.current = cache;
        return read.then(
          (session) => {
            if (!session) cache.delete(original);
            return !!session;
          },
          () => {
            cache.delete(original);
            return false;
          },
        );
      }
      warmedHistory.current.delete(original);
      const loading = (warm ?? getSession(sessionId))
        .then((hydrated) => {
          const current = sessionsRef.current.find((session) => session.id === sessionId);
          if (
            !hydrated ||
            !current?.storedHistory ||
            current.busy ||
            current.storedHistory.revision !== original.storedHistory?.revision ||
            current.blocks !== original.blocks ||
            current.queuedMessages !== original.queuedMessages ||
            current.cwd !== original.cwd ||
            sessionWorkCwd(current) !== sessionWorkCwd(original) ||
            getGroupLockView() !== privacy ||
            removingSessionIds.current.has(sessionId) ||
            (sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch
          )
            return false;
          hydrationHandlers(
            { sessionsRef, setSessions, loadedSessionCache, removingSessionIds, sessionLoadEpochs },
            sessionId,
            epoch,
          ).onHydrated?.(current, {
            ...hydrated,
            queuedMessages: current.queuedMessages,
            queueStatus: current.queueStatus,
          });
          lastPersisted.current.set(sessionId, persistFingerprint(hydrated));
          return !sessionsRef.current.find((session) => session.id === sessionId)?.historyLoading;
        })
        .finally(() => historyForExecution.current.delete(sessionId));
      historyForExecution.current.set(sessionId, loading);
      return loading;
    },
    [
      lastPersisted,
      loadedSessionCache,
      removingSessionIds,
      sessionLoadEpochs,
      sessionsRef,
      setSessions,
    ],
  );

  const retryingHistory = useRef(new Set<string>());
  /**
   * Reads a conversation's history again after it failed. The turns on screen stay while the read
   * runs; the failure clears at once so Retry cannot be pressed twice, and a new failure shows again.
   */
  const onRetrySessionHistory = useCallback((sessionId: string) => {
    const failed = sessionsRef.current.find(
      (session) =>
        session.id === sessionId &&
        session.historyLoading &&
        session.historyLoadError &&
        !session.busy,
    );
    if (!failed || retryingHistory.current.has(sessionId)) return;
    retryingHistory.current.add(sessionId);
    setSessions((previous) =>
      previous.map((value) =>
        value.id === sessionId && value.blocks === failed.blocks
          ? { ...value, historyLoadError: undefined }
          : value,
      ),
    );
    const handlers = hydrationHandlers(
      { sessionsRef, setSessions, loadedSessionCache, removingSessionIds, sessionLoadEpochs },
      sessionId,
      sessionLoadEpochs.current.get(sessionId) ?? 0,
      failed,
    );
    // The tail read can fail before any page is requested; that is the same failure again.
    getSession(sessionId, handlers)
      .catch(() => handlers.onHydrationFailed?.(failed))
      .finally(() => retryingHistory.current.delete(sessionId));
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
    [
      loadStoredSession,
      refreshHistory,
      sidebarCwd,
      loadedSessionCache,
      openingSessionIds,
      sessionsRef,
      removingSessionIds,
      setSessions,
      lastPersisted,
    ],
  );

  const onPopOutSession = useCallback(
    async (
      sessionId: string,
      position: { x: number; y: number; clientX?: number; clientY?: number },
    ) => {
      const epoch = sessionLoadEpochs.current.get(sessionId) ?? 0;
      const loaded =
        sessionsRef.current.find((entry) => entry.id === sessionId) ??
        (await loadStoredSession(sessionId));
      if (
        !loaded ||
        removingSessionIds.current.has(sessionId) ||
        (sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch ||
        isProjectLockedIn(getGroupLockView().lock, loaded.cwd) ||
        isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(loaded))
      )
        return;
      const remoteId = remoteSessionFor(loaded.id);
      const keys = [sessionId];
      if (isRemoteProjectPath(loaded.cwd) && !remoteId) return;
      if (isRemoteProjectPath(loaded.cwd) && remoteId)
        keys.push(remoteSessionOwnershipKey(loaded.cwd, remoteId));
      const release = await reserveSessionWindow(keys);
      if (!release) return;
      let retained = false;
      try {
        if (
          removingSessionIds.current.has(sessionId) ||
          (sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch ||
          isProjectLockedIn(getGroupLockView().lock, loaded.cwd) ||
          isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(loaded))
        )
          return;
        if (!sessionsRef.current.some((entry) => entry.id === sessionId))
          rememberLoadedSession(loadedSessionCache.current, loaded);
        const session = await ensureOpenSession(sessionId);
        if (
          !session ||
          !sameProjectPath(session.cwd, loaded.cwd) ||
          (remoteId && remoteSessionFor(session.id) !== remoteId) ||
          removingSessionIds.current.has(sessionId) ||
          (sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch ||
          isProjectLockedIn(getGroupLockView().lock, session.cwd) ||
          isProjectLockedIn(getGroupLockView().lock, sessionWorkCwd(session)) ||
          !sessionsRef.current.some((entry) => entry.id === sessionId)
        )
          return;
        if (!tabsRef.current.some((tab) => leafIds(tab.layout).includes(sessionId))) {
          flushSync(() => {
            const next = [...tabsRef.current, newTab(sessionId)];
            tabsRef.current = next;
            setTabs(next);
          });
        }
        retained = true;
        onPopOutPane(sessionId, position);
      } finally {
        await release(retained).catch((error) =>
          console.error("Conversation ownership release failed", error),
        );
      }
    },
    [ensureOpenSession, loadStoredSession, onPopOutPane],
  );

  const onPrefetchHistorySession = useCallback(
    (sessionId: string) => {
      if (removingSessionIds.current.has(sessionId)) return;
      const privacy = getGroupLockView();
      const epoch = sessionLoadEpochs.current.get(sessionId);
      const warmOwnerPage = (session: Session) => {
        if (
          !session.hostBinding?.created ||
          isProjectLockedIn(privacy.lock, session.cwd) ||
          isProjectLockedIn(privacy.lock, sessionWorkCwd(session))
        )
          return;
        prefetchLocalSessionPage(
          sessionId,
          session.hostBinding,
          () =>
            getGroupLockView() === privacy &&
            !removingSessionIds.current.has(sessionId) &&
            sessionLoadEpochs.current.get(sessionId) === epoch,
        );
      };
      const resident =
        sessionsRef.current.find((session) => session.id === sessionId) ??
        loadedSessionCache.current.get(sessionId);
      if (resident) {
        warmOwnerPage(resident);
        return;
      }
      if (sessionLoads.current.has(sessionId) || activeSessionPrefetch.current) return;
      const loading = loadStoredSession(sessionId);
      activeSessionPrefetch.current = loading;
      void loading.then((loaded) => {
        if (loaded) warmOwnerPage(loaded);
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
    ensureOpenSession,
    onPopOutSession,
    onPrefetchHistorySession,
    onRetrySessionHistory,
    onLoadSessionHistory,
    ensureSessionHistoryForExecution,
  };
}
