import { useMemo, useRef, type MutableRefObject } from "react";
import type { Session } from "../../../features/sessions/model/session";
import type { SessionRecovery } from "../../../features/workspace/model/sessionRecovery";
import type { useLockSnapshot } from "../../../features/group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import { isRemoteProjectPath } from "../../../features/projects/model/recents";
import {
  remoteSessionFor,
  useRemoteRailSessions,
} from "../../../features/connections/model/connections";
import { unopenedRemoteSessions } from "../../../features/connections/model/remoteRailSessions";

export interface RemoteRailProjectsDeps {
  visibleRecents: ReadonlyArray<{ path: string }>;
  sessionRecovery: SessionRecovery | null;
  lockSnapshot: ReturnType<typeof useLockSnapshot>;
  sessions: Session[];
}

export interface RemoteRailProjects {
  listedRemoteSessions: ReturnType<typeof useRemoteRailSessions>;
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
  const listedRemoteSessions = useRemoteRailSessions(remoteRailProjects);
  const loadedRemoteShellIds = useMemo(
    () =>
      sessions
        .filter((session) => isRemoteProjectPath(session.cwd) && session.blocks.length > 0)
        .map((session) => session.id)
        .join("\n"),
    [sessions],
  );
  const loadedRemoteHostIds = useMemo(() => {
    const loadedHostIds = new Set<string>();
    for (const shellId of loadedRemoteShellIds.split("\n")) {
      const hostId = shellId && remoteSessionFor(shellId);
      if (hostId) loadedHostIds.add(hostId);
    }
    return loadedHostIds;
  }, [loadedRemoteShellIds]);
  const unopenedRemote = useMemo(
    () => unopenedRemoteSessions(listedRemoteSessions, loadedRemoteHostIds),
    [listedRemoteSessions, loadedRemoteHostIds],
  );
  const unopenedRemoteRef = useRef(unopenedRemote);
  unopenedRemoteRef.current = unopenedRemote;

  return { listedRemoteSessions, loadedRemoteHostIds, unopenedRemote, unopenedRemoteRef };
}
