import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Session } from "../../../features/sessions/model/session";
import {
  persistFingerprint,
  shouldPersistSession,
  upsertSession,
  upsertSessionLive,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";
import { mergeProjectHistorySummary } from "../../../features/sessions/data/sessionHistory";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import { takePendingSessionWrites } from "../../model/pendingSessionWrites";
import { lastUserBlockId, openSessionIds } from "../helpers/sessionHelpers";
import { LIVE_PERSIST_MS } from "../helpers/appHelpers";

export interface SessionPersistenceRefs {
  turnGen: MutableRefObject<Map<string, number>>;
  retiringTurns: MutableRefObject<Map<string, number>>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  lastBoundProvider: MutableRefObject<Map<string, string>>;
  lastPersistedUserBlock: MutableRefObject<Map<string, string>>;
  observedSessions: MutableRefObject<Map<string, Session>>;
  pendingPersist: MutableRefObject<Map<string, Session>>;
}

// Persistence bookkeeping refs. Created at the top of Workspace because the
// session-open, import and turn-start code all read them.
export function useSessionPersistenceRefs(): SessionPersistenceRefs {
  const turnGen = useRef(new Map<string, number>());
  const retiringTurns = useRef(new Map<string, number>());
  const lastPersisted = useRef(new Map<string, string>());
  const lastBoundProvider = useRef(new Map<string, string>());
  const lastPersistedUserBlock = useRef(new Map<string, string>());
  const observedSessions = useRef(new Map<string, Session>());
  const pendingPersist = useRef(new Map<string, Session>());
  return {
    turnGen,
    retiringTurns,
    lastPersisted,
    lastBoundProvider,
    lastPersistedUserBlock,
    observedSessions,
    pendingPersist,
  };
}

export interface SessionPersistenceDeps {
  refs: SessionPersistenceRefs;
  sessions: Session[];
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sidebarCwdRef: MutableRefObject<string>;
  removingSessionIds: MutableRefObject<Set<string>>;
  switchingWorktrees: MutableRefObject<Map<string, string>>;
  setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
  localHostReachable: MutableRefObject<boolean>;
}

export interface SessionPersistenceState {
  persistSession: (session: Session | undefined) => void;
}

// Writes session transcripts to the store: per-change persistence, the 650ms
// debounced flush of pending writes, and the live transcript interval.
export function useSessionPersistence({
  refs,
  sessions,
  tabsRef,
  sidebarCwdRef,
  removingSessionIds,
  switchingWorktrees,
  setHistory,
  localHostReachable,
}: SessionPersistenceDeps): SessionPersistenceState {
  const { lastPersisted, lastBoundProvider, lastPersistedUserBlock, observedSessions, pendingPersist } =
    refs;

  const persistSession = useCallback((session: Session | undefined) => {
    if (
      !session ||
      !shouldPersistSession(session) ||
      removingSessionIds.current.has(session.id) ||
      switchingWorktrees.current.has(session.id)
    )
      return;
    const fingerprint = persistFingerprint(session);
    // Leaving a session flushes it. An unchanged one would still rewrite and
    // re-diff its whole transcript under the store lock, stalling the next load.
    if (lastPersisted.current.get(session.id) === fingerprint) return;
    void upsertSession(session)
      .then((summary) => {
        if (!summary) return;
        lastPersisted.current.set(session.id, fingerprint);
        if (summary.cwd === sidebarCwdRef.current) {
          setHistory((current) => mergeProjectHistorySummary(current, summary));
        }
      })
      .catch((error) => {
        console.warn("App operation failed", error);
      });
  }, []);

  useEffect(() => {
    const liveIds = new Set(sessions.map((session) => session.id));
    const visibleIds = openSessionIds(tabsRef.current);
    for (const session of sessions) {
      if (removingSessionIds.current.has(session.id) || switchingWorktrees.current.has(session.id))
        continue;
      if (observedSessions.current.get(session.id) === session) continue;
      observedSessions.current.set(session.id, session);
      const parked = !visibleIds.has(session.id);
      const newlyBound =
        !!session.providerSessionId &&
        lastBoundProvider.current.get(session.id) !== session.providerSessionId;
      const lastUserId = lastUserBlockId(session);
      const newUserTurn =
        !!lastUserId && lastPersistedUserBlock.current.get(session.id) !== lastUserId;
      if (newlyBound && session.providerSessionId) {
        lastBoundProvider.current.set(session.id, session.providerSessionId);
      }
      if (newUserTurn && lastUserId) {
        lastPersistedUserBlock.current.set(session.id, lastUserId);
      }
      if ((!session.busy || newlyBound || newUserTurn) && shouldPersistSession(session)) {
        persistSession(session);
      }
      if (
        shouldPersistSession(session) &&
        (!session.busy ||
          parked ||
          newlyBound ||
          newUserTurn ||
          !lastPersisted.current.has(session.id))
      ) {
        pendingPersist.current.set(session.id, session);
      }
    }
    for (const sessionId of observedSessions.current.keys()) {
      if (liveIds.has(sessionId)) continue;
      observedSessions.current.delete(sessionId);
      pendingPersist.current.delete(sessionId);
    }
    if (pendingPersist.current.size === 0) return;

    const timer = window.setTimeout(() => {
      const dirty = takePendingSessionWrites(pendingPersist.current, sessionsRef.current);
      void Promise.all(
        dirty.map(async (session) => {
          if (
            removingSessionIds.current.has(session.id) ||
            switchingWorktrees.current.has(session.id)
          )
            return;
          const fingerprint = persistFingerprint(session);
          if (lastPersisted.current.get(session.id) === fingerprint) return;
          const summary = await upsertSession(session).catch(() => null);
          if (!summary) return;
          lastPersisted.current.set(session.id, fingerprint);
          if (summary.cwd === sidebarCwdRef.current) {
            setHistory((current) => mergeProjectHistorySummary(current, summary));
          }
        }),
      );
    }, 650);
    return () => window.clearTimeout(timer);
  }, [persistSession, sessions]);

  // Keep running transcripts durable even without a host. The shell skips
  // text-only frames, so its delayed snapshots cannot protect live replies.
  useEffect(() => {
    const timer = window.setInterval(() => {
      for (const session of sessionsRef.current) {
        if (
          !session.busy ||
          !shouldPersistSession(session) ||
          removingSessionIds.current.has(session.id) ||
          switchingWorktrees.current.has(session.id)
        )
          continue;
        const fingerprint = persistFingerprint(session);
        if (lastPersisted.current.get(session.id) === fingerprint) continue;
        // The fingerprint is recorded when the write starts: a snapshot that
        // is replaced while queued behind a slow write never claims to be saved.
        void upsertSessionLive(session, {
          shouldWrite: () =>
            !removingSessionIds.current.has(session.id) &&
            !switchingWorktrees.current.has(session.id),
          onStart: () => lastPersisted.current.set(session.id, fingerprint),
          onFailed: () => {
            if (lastPersisted.current.get(session.id) === fingerprint) {
              lastPersisted.current.delete(session.id);
            }
          },
        });
      }
    }, LIVE_PERSIST_MS);
    return () => window.clearInterval(timer);
  }, [localHostReachable]);

  return { persistSession };
}
