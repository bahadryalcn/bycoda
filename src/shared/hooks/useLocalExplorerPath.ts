import { useSyncExternalStore } from "react";
import { localExplorerPath, mappingsSnapshot, subscribeMappings } from "../lib/remoteExplorerPaths";

/** `localExplorerPath` for render: re-renders the caller when a mapping is saved. */
export function useLocalExplorerPath(path: string): string | undefined {
  useSyncExternalStore(subscribeMappings, mappingsSnapshot, () => null);
  return localExplorerPath(path);
}
