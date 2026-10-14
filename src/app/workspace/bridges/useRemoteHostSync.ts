import { useCallback, useRef, type MutableRefObject } from "react";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  useAdoptedSessions,
  type RefreshAdoptedSession,
} from "../../../features/connections/model/useAdoptedSessions";
import { useDesktopLive } from "../../../features/connections/model/useDesktopLive";
import { useSharedLocalQueues } from "../../../features/connections/model/useSharedLocalQueues";
import type { DesktopLiveHandlers } from "../../../features/connections/model/desktopLive";
import type { HostSession } from "../../../features/connections/model/protocol";
import { remoteSessionState } from "../../../features/connections/model/remoteSessionState";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import type { LinkedSessionUpdate } from "../../../features/inbox/model/linkedSessionUpdates";
import { t } from "../../../shared/i18n";

export interface RemoteHostSync {
  localHostReachable: MutableRefObject<boolean>;
  loadRunningOnHostRef: MutableRefObject<((ids: string[]) => void) | undefined>;
  onRefreshAdoptedSession: RefreshAdoptedSession;
  desktopLiveHandlers: MutableRefObject<DesktopLiveHandlers>;
  linkedSessionUpdatesRef: MutableRefObject<ReadonlyMap<string, LinkedSessionUpdate>>;
  onRemoteSnapshot: (shellId: string, snapshot?: HostSession) => void;
}

/** Adopted-host and remote-snapshot wiring. The handler table for the desktop
 * live channel is assigned by the caller, since it closes over workspace state. */
export function useRemoteHostSync(): RemoteHostSync {
  const loadRunningOnHostRef = useRef<(ids: string[]) => void>(undefined);
  const refreshAdoptedSessionRef = useRef<RefreshAdoptedSession>(undefined);
  const localHostReachable = useAdoptedSessions(
    sessionsRef,
    setSessions,
    loadRunningOnHostRef,
    refreshAdoptedSessionRef,
  );
  const onRefreshAdoptedSession = useCallback<RefreshAdoptedSession>((sessionId, target) => {
    const refresh = refreshAdoptedSessionRef.current;
    if (!refresh) return Promise.reject(new Error("Host unavailable. Try again."));
    return refresh(sessionId, target);
  }, []);
  const desktopLiveHandlers = useRef<DesktopLiveHandlers>({
    stop: () => undefined,
    approve: () => undefined,
    answer: () => undefined,
  });
  useDesktopLive(sessionsRef, desktopLiveHandlers, localHostReachable);
  useSharedLocalQueues(sessionsRef, setSessions, localHostReachable);
  const linkedSessionUpdatesRef = useRef<ReadonlyMap<string, LinkedSessionUpdate>>(new Map());

  const lastRemoteSnapshot = useRef(new Map<string, HostSession>());
  const onRemoteSnapshot = useCallback((shellId: string, snapshot?: HostSession) => {
    if (!snapshot) {
      lastRemoteSnapshot.current.delete(shellId);
      setSessions((current) =>
        current.map((entry) =>
          entry.id === shellId
            ? {
                ...entry,
                get title() {
                  return t("New remote session");
                },
                blocks: [],
                busy: false,
              }
            : entry,
        ),
      );
      return;
    }
    if (lastRemoteSnapshot.current.get(shellId) === snapshot) return;
    lastRemoteSnapshot.current.set(shellId, snapshot);
    setSessions((current) => {
      const shell = current.find((entry) => entry.id === shellId);
      if (!shell) return current;
      const project = remoteProjectFor(shell.cwd);
      if (!project) return current;
      return current.map((entry) =>
        entry.id === shellId ? remoteSessionState(entry, snapshot, project) : entry,
      );
    });
  }, []);

  return {
    localHostReachable,
    loadRunningOnHostRef,
    onRefreshAdoptedSession,
    desktopLiveHandlers,
    linkedSessionUpdatesRef,
    onRemoteSnapshot,
  };
}
