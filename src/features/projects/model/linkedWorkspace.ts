import { useSyncExternalStore } from "react";
import { pathKey } from "../../../shared/lib/paths";

export type WorkspaceReconcileInput = {
  /** Folders the file listed at the last sync. */
  previous: readonly string[];
  /** Folders the file lists now, or null when it is missing or unparsable. */
  next: readonly string[] | null;
  /** Projects currently in the group, in any path form. */
  members: readonly string[];
};

export type WorkspaceReconcile = {
  /** In the file now but not at the last sync, and not yet in the group. */
  toAdd: string[];
  /** Listed at the last sync, gone from the file, and still in the group. */
  toDetach: string[];
  /** Group members that stay, including ones the user added by hand. */
  unchanged: string[];
  /** The folder list to remember for the next sync. */
  linked: string[];
};

function unique(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

/**
 * Works out how a group follows its workspace file. Pure: the caller applies
 * the result and decides what to do about folders that cannot be opened.
 *
 * - A missing or unparsable file (`next` null) changes nothing.
 * - A folder renamed on disk is a removal plus an addition.
 * - A previously listed folder the user moved to another group is not pulled
 *   back, because only new folders are added.
 * - Projects the user added by hand were never listed, so they are never
 *   detached.
 */
export function reconcileLinkedWorkspace({
  previous,
  next,
  members,
}: WorkspaceReconcileInput): WorkspaceReconcile {
  const current = unique(members);
  const before = unique(previous);
  if (next === null) {
    return { toAdd: [], toDetach: [], unchanged: current, linked: before };
  }

  const now = unique(next);
  const nowKeys = new Set(now.map(pathKey));
  const beforeKeys = new Set(before.map(pathKey));
  const memberKeys = new Set(current.map(pathKey));

  const toAdd = now.filter(
    (path) => !beforeKeys.has(pathKey(path)) && !memberKeys.has(pathKey(path)),
  );
  const toDetach = before.filter(
    (path) => !nowKeys.has(pathKey(path)) && memberKeys.has(pathKey(path)),
  );
  const detachKeys = new Set(toDetach.map(pathKey));
  return {
    toAdd,
    toDetach,
    unchanged: current.filter((path) => !detachKeys.has(pathKey(path))),
    linked: now,
  };
}

export type LinkedGroupStatus =
  | { state: "missing"; message: string }
  | { state: "invalid"; message: string };

const statuses = new Map<string, LinkedGroupStatus>();
const listeners = new Set<() => void>();

/** Records why a linked group could not follow its file; null clears it. */
export function setLinkedGroupStatus(groupId: string, status: LinkedGroupStatus | null): void {
  const previous = statuses.get(groupId);
  if (status === null) {
    if (!statuses.delete(groupId)) return;
  } else {
    if (previous?.state === status.state && previous.message === status.message) return;
    statuses.set(groupId, status);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLinkedGroupStatus(groupId: string): LinkedGroupStatus | undefined {
  return useSyncExternalStore(
    subscribe,
    () => statuses.get(groupId),
    () => undefined,
  );
}
