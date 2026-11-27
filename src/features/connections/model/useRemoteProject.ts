import { useMemo, useSyncExternalStore } from "react";
import {
  remoteProjectSnapshot,
  remoteProjectsOn,
  subscribeRemoteProjects,
  type RemoteProject,
} from "./remoteProjects";

/** Reactive `remoteProjectFor`; preserves object identity until the registered value changes. */
export function useRemoteProject(path: string): RemoteProject | undefined {
  const read = () => remoteProjectSnapshot(path);
  const snapshot = useSyncExternalStore(subscribeRemoteProjects, read, read);
  return useMemo(() => (JSON.parse(snapshot) as RemoteProject | null) ?? undefined, [snapshot]);
}

/** Reactive `remoteProjectsOn`: the projects remembered for one machine; empty without an id. */
export function useRemoteProjectsOn(environmentId: string | undefined): RemoteProject[] {
  const read = () => JSON.stringify(environmentId ? remoteProjectsOn(environmentId) : []);
  const snapshot = useSyncExternalStore(subscribeRemoteProjects, read, read);
  return useMemo(() => JSON.parse(snapshot) as RemoteProject[], [snapshot]);
}
