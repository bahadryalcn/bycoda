import { useSyncExternalStore } from "react";
import {
  REMOTE_PROJECTS_CHANGED,
  remoteProjectFor,
  type RemoteProject,
} from "../../features/connections/model/remoteProjects";

function subscribe(onChange: () => void) {
  window.addEventListener(REMOTE_PROJECTS_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(REMOTE_PROJECTS_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The remote project registered for a rail path. The registry is localStorage, which React
 * Compiler cannot see change, so it is read through a subscription. The snapshot is a string
 * because each read parses a fresh object.
 */
export function useRemoteProject(path: string): RemoteProject | undefined {
  const raw = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(remoteProjectFor(path) ?? null),
    () => "null",
  );
  return (JSON.parse(raw) as RemoteProject | null) ?? undefined;
}
