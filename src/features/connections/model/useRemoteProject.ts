import { useMemo, useSyncExternalStore } from "react";
import {
  remoteProjectSnapshot,
  subscribeRemoteProjects,
  type RemoteProject,
} from "./remoteProjects";

/** Reactive `remoteProjectFor`; preserves object identity until the registered value changes. */
export function useRemoteProject(path: string): RemoteProject | undefined {
  const read = () => remoteProjectSnapshot(path);
  const snapshot = useSyncExternalStore(subscribeRemoteProjects, read, read);
  return useMemo(() => (JSON.parse(snapshot) as RemoteProject | null) ?? undefined, [snapshot]);
}
