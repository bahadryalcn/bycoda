import { useSyncExternalStore } from "react";
import type { Session } from "../../sessions";
import type { AdoptedEntry } from "./adoptedSessions";

/** Open conversations whose newer host copy this window has yet to compare. */
let syncing: ReadonlySet<string> = new Set();
const noFailures: ReadonlyMap<string, string> = new Map();
let failures = noFailures;
const listeners = new Set<() => void>();

/** Loaded, idle conversations the host holds a revision of that is not mirrored
 * here yet. A host turn still running shows as running instead; a flagged one
 * shows its own notice. */
export function adoptedSyncingIds(
  entries: readonly AdoptedEntry[],
  local: readonly Session[],
  mirrored: ReadonlyMap<string, number>,
): Set<string> {
  const byId = new Map(local.map((session) => [session.id, session]));
  const ids = new Set<string>();
  for (const entry of entries) {
    const session = byId.get(entry.id);
    if (
      session &&
      !session.busy &&
      !session.adoptedSyncConflict &&
      entry.status !== "running" &&
      mirrored.get(entry.id) !== entry.revision
    )
      ids.add(entry.id);
  }
  return ids;
}

export function setAdoptedSyncing(ids: ReadonlySet<string>, reasons = noFailures): void {
  const sameIds = ids.size === syncing.size && [...ids].every((id) => syncing.has(id));
  const sameReasons =
    reasons.size === failures.size &&
    [...reasons].every(([id, reason]) => failures.get(id) === reason);
  if (sameIds && sameReasons) return;
  syncing = ids;
  failures = reasons;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether this conversation is still being compared with the other computer's copy. */
export function useAdoptedSyncing(sessionId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => syncing.has(sessionId),
    () => false,
  );
}

/** Runtime-only reason for a conversation whose automatic reads keep failing. */
export function useAdoptedSyncFailure(sessionId: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => failures.get(sessionId),
    () => undefined,
  );
}
