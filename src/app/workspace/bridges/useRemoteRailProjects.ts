import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Session } from "../../../features/sessions/model/session";
import type { SessionRecovery } from "../../../features/workspace/model/sessionRecovery";
import type { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import { isRemoteProjectPath } from "../../../features/projects/model/recents";
import {
  REMOTE_TAB_BINDING_CHANGE,
  remoteSessionFor,
  useRemoteRailSessions,
} from "../../../features/connections/model/connections";
import {
  remoteCreateIntents,
  subscribeRemoteCreateIntents,
} from "../../../features/connections/model/remoteCreateIntent";
import { unopenedRemoteSessions } from "../../../features/connections/model/remoteRailSessions";
import { remoteSessionProjectKey } from "../../../features/connections/model/sessionMachineTarget";

export interface RemoteRailProjectsDeps {
  visibleRecents: ReadonlyArray<{ path: string }>;
  sessionRecovery: SessionRecovery | null;
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
  sessions: Session[];
  includeProjectless?: boolean;
}

export interface RemoteRailProjects {
  listedRemoteSessions: ReturnType<typeof useRemoteRailSessions>["sessions"];
  freshRemoteProjects: readonly string[];
  loadedRemoteHostIds: Set<string>;
  unopenedRemote: ReturnType<typeof unopenedRemoteSessions>;
  unopenedRemoteRef: MutableRefObject<ReturnType<typeof unopenedRemoteSessions>>;
}

/** Host sessions of the rail's remote projects that no tab here has loaded:
 * they run on their machine whether or not this app looks at them. */
export function useRemoteRailProjects({
  visibleRecents,
  sessionRecovery,
  lockSnapshot,
  sessions,
  includeProjectless = false,
}: RemoteRailProjectsDeps): RemoteRailProjects {
  const remoteRailProjects = useMemo(
    () => [
      ...new Set(
        [
          ...visibleRecents.map((project) => project.path),
          ...(sessionRecovery?.workspace.sessions
            .filter((stub) => !isProjectLockedIn(lockSnapshot, stub.cwd))
            .map((stub) => stub.cwd) ?? []),
        ].filter(isRemoteProjectPath),
      ),
    ],
    [visibleRecents, sessionRecovery, lockSnapshot],
  );
  const { sessions: listedRemoteSessions, freshProjects: freshRemoteProjects } =
    useRemoteRailSessions(remoteRailProjects, includeProjectless);
  // Bindings and create intents live outside React state: re-derive when they change.
  const [bindingRevision, setBindingRevision] = useState(0);
  const [createIntentRevision, setCreateIntentRevision] = useState(0);
  useEffect(() => {
    const changed = () => setBindingRevision((revision) => revision + 1);
    window.addEventListener(REMOTE_TAB_BINDING_CHANGE, changed);
    return () => window.removeEventListener(REMOTE_TAB_BINDING_CHANGE, changed);
  }, []);
  useEffect(
    () => subscribeRemoteCreateIntents(() => setCreateIntentRevision((revision) => revision + 1)),
    [],
  );
  const remoteShellIds = useMemo(
    () =>
      sessions
        .filter((session) => isRemoteProjectPath(remoteSessionProjectKey(session)))
        .map((session) => session.id)
        .join("\n"),
    [sessions],
  );
  // A bound shell is open even with an empty transcript (loading, or just created).
  const loadedRemoteHostIds = useMemo(() => {
    const loadedHostIds = new Set<string>();
    for (const shellId of remoteShellIds.split("\n")) {
      const hostId = shellId && remoteSessionFor(shellId);
      if (hostId) loadedHostIds.add(hostId);
    }
    return loadedHostIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revisions invalidate external storage reads
  }, [remoteShellIds, bindingRevision]);
  const unopenedRemote = useMemo(
    () => unopenedRemoteSessions(listedRemoteSessions, loadedRemoteHostIds, remoteCreateIntents()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the intent revision invalidates the module registry read
    [listedRemoteSessions, loadedRemoteHostIds, createIntentRevision],
  );
  const unopenedRemoteRef = useRef(unopenedRemote);
  unopenedRemoteRef.current = unopenedRemote;

  return {
    listedRemoteSessions,
    freshRemoteProjects,
    loadedRemoteHostIds,
    unopenedRemote,
    unopenedRemoteRef,
  };
}
