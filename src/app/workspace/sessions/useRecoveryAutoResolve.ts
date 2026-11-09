import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Session } from "../../../features/sessions/model/session";
import { getSession } from "../../../features/sessions/data/sessionStore";
import { parseRemotePath } from "../../../features/connections/model/remoteProjects";
import { remoteSessionFor } from "../../../features/connections/model/connections";
import type { RemoteRailSession } from "../../../features/connections/model/remoteRailSessions";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import type { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import {
  eligibleRecoverySessions,
  recoveryEntryStatus,
  recoveryNeedsAttention,
  type SessionRecovery,
} from "../../../features/workspace/model/sessionRecovery";

export interface RecoveryAutoResolveDeps {
  enabled: boolean;
  sessionRecovery: SessionRecovery | null;
  sessions: readonly Session[];
  remoteSessions: readonly RemoteRailSession[];
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
  removeRecoveredSessions: (ids: string[]) => Promise<void>;
  setRecoveryOpen: Dispatch<SetStateAction<boolean>>;
}

type Stored = Session | null | "error";

/**
 * Recovery is for interrupted work. Entries whose conversation is confirmed
 * Done or Idle are resolved here (references only: history and running work are
 * untouched, and resolved ids stay held from automatic continuation). Unknown,
 * unavailable and unverified entries are never resolved. After the first full
 * pass the dialog opens by itself only when something still needs attention.
 */
export function useRecoveryAutoResolve({
  enabled,
  sessionRecovery,
  sessions,
  remoteSessions,
  lockSnapshot,
  removeRecoveredSessions,
  setRecoveryOpen,
}: RecoveryAutoResolveDeps): void {
  const [, setReadRevision] = useState(0);
  const stored = useRef(new Map<string, Stored>());
  const queued = useRef(new Set<string>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const attempted = useRef(new Set<string>());
  const autoOpenDecided = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !sessionRecovery) return;
    const eligible = eligibleRecoverySessions(
      sessionRecovery,
      sessions,
      (cwd) => isProjectLockedIn(lockSnapshot, cwd),
      remoteSessionFor,
    );
    let settled = true;
    let attention = false;
    const resolved: string[] = [];
    for (const stub of eligible) {
      const remote = !!parseRemotePath(stub.cwd);
      const open = sessions.find((session) => session.id === stub.id);
      let saved: Stored | undefined;
      if (!remote && !open) {
        saved = stored.current.get(stub.id);
        if (saved === undefined) {
          settled = false;
          if (!queued.current.has(stub.id)) {
            queued.current.add(stub.id);
            chain.current = chain.current.then(async () => {
              try {
                stored.current.set(stub.id, await getSession(stub.id));
              } catch {
                stored.current.set(stub.id, "error");
              }
              if (mounted.current) setReadRevision((revision) => revision + 1);
            });
          }
          continue;
        }
      }
      const local = open ?? (saved && saved !== "error" ? saved : undefined);
      // A placeholder has no transcript yet, so it cannot be judged complete.
      if (local?.historyLoading) {
        settled = false;
        continue;
      }
      const host = remote
        ? remoteSessions.find(
            (entry) => entry.project === stub.cwd && entry.session.id === stub.remoteSessionId,
          )
        : undefined;
      const status = recoveryEntryStatus({ remote, host, local, storedMissing: saved === null });
      const unreadable = !!local?.historyLoadError || saved === "error";
      if (!unreadable && !recoveryNeedsAttention(status)) {
        if (!attempted.current.has(stub.id)) resolved.push(stub.id);
      } else if (!(remote && !host?.fresh)) {
        attention = true;
      }
    }
    if (resolved.length) {
      for (const id of resolved) attempted.current.add(id);
      void removeRecoveredSessions(resolved).catch(() => {
        // The list stays as it was; the entries are re-evaluated on the next boot.
      });
      return;
    }
    if (!settled) return;
    if (autoOpenDecided.current) return;
    autoOpenDecided.current = true;
    if (attention && !sessionRecovery.dismissed) setRecoveryOpen(true);
  }, [
    enabled,
    sessionRecovery,
    sessions,
    remoteSessions,
    lockSnapshot,
    removeRecoveredSessions,
    setRecoveryOpen,
  ]);
}
