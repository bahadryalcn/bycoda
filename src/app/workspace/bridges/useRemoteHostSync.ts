import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { startProviderAccountHostSync } from "../../../features/providers/public/providerAccountHostSync";
import { WorkspaceActionError } from "../../model/workspaceActionError";
import { startModelEnabledHostSync } from "../../../features/sessions/model/modelEnabledHostSync";
import { startBykitHostSync } from "../../../features/host-tools/public/bykitHostSync";
import {
  getShellSessions,
  sessionsRef,
  setSessions,
  subscribeShell,
} from "../../../features/sessions/model/sessionsStore";
import type { Session } from "../../../features/sessions/model/session";
import {
  useAdoptedSessions,
  type RefreshAdoptedSession,
} from "../../../features/connections/model/useAdoptedSessions";
import { useDesktopLive } from "../../../features/connections/model/useDesktopLive";
import { startOwnerActivityReports } from "../../../features/connections/model/ownerActivity";
import { useSharedLocalQueues } from "../../../features/connections/model/useSharedLocalQueues";
import type { DesktopLiveHandlers } from "../../../features/connections/model/desktopLive";
import type { HostSession } from "../../../features/connections/model/protocol";
import {
  keepUnchangedFields,
  remoteSessionState,
} from "../../../features/connections/model/remoteSessionState";
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

/** Forget the snapshot of every shell no longer in `sessions`. */
export function pruneClosedSnapshots(
  snapshots: Map<string, HostSession>,
  sessions: readonly Session[],
): void {
  if (!snapshots.size) return;
  const open = new Set(sessions.map((session) => session.id));
  for (const shellId of snapshots.keys()) if (!open.has(shellId)) snapshots.delete(shellId);
}

/** Adopted-host and remote-snapshot wiring. The handler table for the desktop
 * live channel is assigned by the caller, since it closes over workspace state. */
export function useRemoteHostSync(): RemoteHostSync {
  const loadRunningOnHostRef = useRef<(ids: string[]) => void>(undefined);
  const refreshAdoptedSessionRef = useRef<RefreshAdoptedSession>(undefined);
  useEffect(() => startProviderAccountHostSync(), []);
  useEffect(() => startModelEnabledHostSync(), []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- publishes the Settings bykit switch to the local Host while the workspace is mounted
  useEffect(() => startBykitHostSync(), []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- timer reporting owner input to other connected Hosts while the workspace is mounted
  useEffect(() => startOwnerActivityReports(), []);
  const localHostReachable = useAdoptedSessions(
    sessionsRef,
    setSessions,
    loadRunningOnHostRef,
    refreshAdoptedSessionRef,
  );
  const onRefreshAdoptedSession = useCallback<RefreshAdoptedSession>(
    (sessionId, target, resolution) => {
      const refresh = refreshAdoptedSessionRef.current;
      if (!refresh)
        return Promise.reject(
          new WorkspaceActionError("hostUnavailable", "Host unavailable. Try again."),
        );
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
  // A closed or deleted tab never reports an empty snapshot; drop the whole
  // transcript it last showed once its shell leaves the session list.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- subscribes to the shell store while mounted to prune closed tabs' snapshots
  useEffect(
    () =>
      subscribeShell(() => pruneClosedSnapshots(lastRemoteSnapshot.current, getShellSessions())),
    [],
  );
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
          // The host omits a finished wait; spreading alone would keep the old one.
          backgroundTasks: host.backgroundTasks,
          backgroundAgents: host.backgroundAgents,
          backgroundSince: host.backgroundSince,
          continuingElsewhere: undefined,
          historyPartial: snapshot.history?.before !== undefined,
        },
        acknowledged,
      );
      setSessions((current) =>
        current.map((entry) => (entry.id === shellId ? keepUnchangedFields(entry, next) : entry)),
      );
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
