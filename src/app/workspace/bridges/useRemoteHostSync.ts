import { useCallback, useRef, type MutableRefObject } from "react";
import {
  sessionsRef,
  setSessions,
  subscribeShell,
} from "../../../features/sessions/model/sessionsStore";
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
import {
  acknowledgedHostSessionBinding,
  hostSessionBinding,
  saveHostSessionBinding,
} from "../../../features/connections/model/sessionExecutionBinding";
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
  const onRefreshAdoptedSession = useCallback<RefreshAdoptedSession>(
    (sessionId, target, resolution) => {
      const refresh = refreshAdoptedSessionRef.current;
      if (!refresh) return Promise.reject(new Error("Host unavailable. Try again."));
      return refresh(sessionId, target, resolution);
    },
    [],
  );
  const desktopLiveHandlers = useRef<DesktopLiveHandlers>({
    stop: () => undefined,
    approve: () => undefined,
    answer: () => undefined,
  });
  useDesktopLive(sessionsRef, desktopLiveHandlers, localHostReachable);
  useSharedLocalQueues(sessionsRef, setSessions, localHostReachable, subscribeShell);
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
    const shell = sessionsRef.current.find((entry) => entry.id === shellId);
    if (!shell) return;
    if (hostSessionBinding(shell)) {
      // Validate the owner and persist the acknowledged binding once, here,
      // before the display session changes. A mismatched owner throws to the
      // snapshot publisher without a storage write or a partial session update.
      const acknowledged = acknowledgedHostSessionBinding(
        shell,
        snapshot.session.id,
        snapshot.authorityGeneration,
      )!;
      const host = snapshot.session;
      const next = saveHostSessionBinding(
        {
          ...shell,
          ...host,
          id: shell.id,
          cwd: shell.cwd,
          hostBinding: acknowledged,
          worktreeCwd: host.worktreeCwd || (host.cwd !== shell.cwd ? host.cwd : undefined),
          busy: snapshot.status === "running",
          continuingElsewhere: undefined,
          historyPartial: snapshot.history?.before !== undefined,
        },
        acknowledged,
      );
      setSessions((current) => current.map((entry) => (entry.id === shellId ? next : entry)));
      return;
    }
    setSessions((current) => {
      const entry = current.find((candidate) => candidate.id === shellId);
      if (!entry) return current;
      const project = remoteProjectFor(entry.cwd);
      if (!project) return current;
      return current.map((candidate) =>
        candidate.id === shellId ? remoteSessionState(candidate, snapshot, project) : candidate,
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
