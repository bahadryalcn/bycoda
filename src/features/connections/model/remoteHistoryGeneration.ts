import type { HostSession } from "./protocol";

/** A new polling effect cannot inherit the previous effect's page loader. */
export function createRemoteHistoryGeneration() {
  let loaded = false;
  return {
    known(snapshot: HostSession | undefined) {
      return snapshot?.historyLoading && !loaded ? undefined : snapshot;
    },
    loaded() {
      loaded = true;
    },
    failed() {
      loaded = false;
    },
  };
}

/** Partial history belongs to its live loader and cannot outlive that binding. */
export function canCacheRemoteSnapshot(snapshot: HostSession): boolean {
  return !snapshot.historyLoading;
}
