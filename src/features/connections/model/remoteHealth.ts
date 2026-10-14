import { useSyncExternalStore } from "react";
import {
  classifyRemoteError,
  isConnectionFailure,
  unreachablePollDelay,
  type RemoteFailure,
} from "./remoteFailure";
import {
  INITIAL_CONNECTION,
  reduceConnection,
  type RemoteConnectionEvent,
  type RemoteConnectionState,
} from "./remoteConnection";
import { parseRemotePath } from "./remoteProjects";

/** What the views of a remote project last learned about its machine. Each view
 * reports the outcome of its loads under its own `source` ("changes", "graph",
 * "files"…); this module keeps the latest failure per source for display, and
 * tells pollers to back off while the machine is unreachable. Local paths are
 * never recorded. */

const failures = new Map<string, RemoteFailure>();
/** Machines whose last requests failed to connect, and when. */
const unreachable = new Map<string, { count: number; at: number }>();
/** One connection state per machine, fed by the outcome of every load. */
const connections = new Map<string, RemoteConnectionState>();
const changeListeners = new Set<() => void>();
const recoveredListeners = new Set<() => void>();

const environmentOf = (cwd: string) => parseRemotePath(cwd)?.environmentId;
const keyFor = (environmentId: string, source: string) => `${environmentId}\n${source}`;
const emit = () => changeListeners.forEach((listener) => listener());

/** Applies one event to a machine's connection state. Listeners hear about it
 * only when what the user sees changed, not for every successful poll. */
export function applyRemoteConnection(environmentId: string, event: RemoteConnectionEvent): void {
  const previous = connections.get(environmentId) ?? INITIAL_CONNECTION;
  const next = reduceConnection(previous, event);
  if (next === previous) return;
  connections.set(environmentId, next);
  if (next.status !== previous.status || next.error !== previous.error) emit();
}

/** Records one outcome of a request to a machine, from a view that has no cwd. */
export function recordRemoteConnection(environmentId: string, error?: unknown): void {
  applyRemoteConnection(
    environmentId,
    error === undefined
      ? { type: "ok", at: Date.now() }
      : { type: "failure", error, at: Date.now() },
  );
}

export function listRemoteConnections(): [string, RemoteConnectionState][] {
  return [...connections];
}

export function readRemoteConnection(environmentId: string): RemoteConnectionState {
  return connections.get(environmentId) ?? INITIAL_CONNECTION;
}

/** Records one load: `error` undefined means it succeeded. */
export function reportRemoteLoad(cwd: string, source: string, error?: unknown): void {
  const environmentId = environmentOf(cwd);
  if (!environmentId) return;
  recordRemoteConnection(environmentId, error);
  const key = keyFor(environmentId, source);
  if (error === undefined) {
    const wasUnreachable = unreachable.delete(environmentId);
    const changed = failures.delete(key);
    if (wasUnreachable) return recover(environmentId);
    if (changed) emit();
    return;
  }
  const failure = classifyRemoteError(error);
  const previous = failures.get(key);
  const changed = previous?.kind !== failure.kind || previous.message !== failure.message;
  // Keep the stored object when nothing changed, so readers see a stable value.
  if (changed) failures.set(key, failure);
  if (failure.kind === "unreachable") {
    unreachable.set(environmentId, {
      count: (unreachable.get(environmentId)?.count ?? 0) + 1,
      at: Date.now(),
    });
  } else if (unreachable.delete(environmentId)) {
    return recover(environmentId); // the machine answered, with an error of its own
  }
  if (changed) emit();
}

/** `reportRemoteLoad` for views that show their own errors: only a failure to
 * reach the machine (or an outdated host) is recorded; any other error means
 * the machine answered. */
export function reportRemoteConnection(cwd: string, source: string, error?: unknown): void {
  reportRemoteLoad(
    cwd,
    source,
    error !== undefined && isConnectionFailure(classifyRemoteError(error)) ? error : undefined,
  );
}

/** The machine answered again: drop what we showed about it being down and let
 * every view reload now. Also called after a reconnect or a host update, with
 * the machine's environment when it is known. */
export function notifyRemoteRecovered(environmentId?: string): void {
  if (environmentId) applyRemoteConnection(environmentId, { type: "recovered", at: Date.now() });
  unreachable.clear();
  for (const [key, failure] of [...failures])
    if (failure.kind === "unreachable") failures.delete(key);
  emit();
  recoveredListeners.forEach((listener) => listener());
}

/** A machine's address was edited: forget that it was unreachable and let the
 * next attempt, to the new address, speak for itself. */
export function resetRemoteConnection(environmentId: string): void {
  unreachable.delete(environmentId);
  for (const key of [...failures.keys()])
    if (
      key.startsWith(`${environmentId}
`)
    )
      failures.delete(key);
  applyRemoteConnection(environmentId, { type: "reset" });
  emit();
}

function recover(environmentId: string): void {
  for (const [key, failure] of [...failures])
    if (key.startsWith(`${environmentId}\n`) && failure.kind === "unreachable")
      failures.delete(key);
  emit();
  recoveredListeners.forEach((listener) => listener());
}

/** Whether a background poll of this project should run now. Always true
 * unless its machine is unreachable, when polls are slowed to every 15-30
 * seconds. Loads the user triggers themselves skip this check. */
export function remotePollDue(cwd: string): boolean {
  const environmentId = environmentOf(cwd);
  const state = environmentId ? unreachable.get(environmentId) : undefined;
  return !state || Date.now() - state.at >= unreachablePollDelay(state.count);
}

export function subscribeRemoteRecovered(listener: () => void): () => void {
  recoveredListeners.add(listener);
  return () => recoveredListeners.delete(listener);
}

export function subscribeChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** The latest failure of one view's loads for a remote project, if any. */
export function useRemoteLoadFailure(cwd: string, source: string): RemoteFailure | undefined {
  const environmentId = environmentOf(cwd);
  const read = () => (environmentId ? failures.get(keyFor(environmentId, source)) : undefined);
  return useSyncExternalStore(subscribeChanges, read, read);
}

/** For tests: forget everything. */
export function resetRemoteHealth(): void {
  failures.clear();
  unreachable.clear();
  connections.clear();
}
