/**
 * In-memory record of a remote shell (tab) that is creating its host session.
 *
 * A host session id is minted on the host when the first turn is submitted and
 * bound to the local shell only after the `create` receipt returns. Until then
 * the shell has no binding, while the host already lists the new session. This
 * module names that window so the rail, session openers, recovery and the
 * empty-tab cleanup can treat the shell as owned and the new listing as taken.
 *
 * Only the pre-receipt window needs this: after `savePendingRemoteCommand` the
 * durable outbox covers reloads. Nothing here is persisted.
 */
export type RemoteCreateIntent = {
  shellId: string;
  /** Remote project path (the shell's cwd). */
  project: string;
  environmentId: string;
  startedAt: number;
  /** Host session ids already listed for the project when the create began.
   * A listed session outside this set, while the intent is active, is the one
   * being created (or arrived in the same seconds) and is not offered as unopened. */
  knownSessionIds: ReadonlySet<string>;
};

export const REMOTE_CREATE_INTENT_CHANGE = "bycoda:remote-create-intent";

const intents = new Map<string, RemoteCreateIntent>();

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REMOTE_CREATE_INTENT_CHANGE));
}

/** Marks `shellId` as creating its host session. Replaces an earlier intent of the shell. */
export function beginRemoteCreate(
  shellId: string,
  project: string,
  environmentId: string,
  knownSessionIds: Iterable<string>,
): RemoteCreateIntent {
  const intent: RemoteCreateIntent = {
    shellId,
    project,
    environmentId,
    startedAt: Date.now(),
    knownSessionIds: new Set(knownSessionIds),
  };
  intents.set(shellId, intent);
  notify();
  return intent;
}

/** Clears the shell's intent, if `intent` is still the active one (or any, when omitted). */
export function endRemoteCreate(shellId: string, intent?: RemoteCreateIntent) {
  const current = intents.get(shellId);
  if (!current || (intent && current !== intent)) return;
  intents.delete(shellId);
  notify();
}

export function remoteCreateIntent(shellId: string): RemoteCreateIntent | undefined {
  return intents.get(shellId);
}

/** Active intents, optionally only those of one remote project path. */
export function remoteCreateIntents(
  sameProject?: (project: string) => boolean,
): RemoteCreateIntent[] {
  const all = [...intents.values()];
  return sameProject ? all.filter((intent) => sameProject(intent.project)) : all;
}

/**
 * The shell whose create most plausibly produced `sessionId`: an active intent
 * of the project that did not know the id when it began. Undefined when none.
 */
export function remoteCreateShellFor(
  sessionId: string,
  sameProject: (project: string) => boolean,
): string | undefined {
  let best: RemoteCreateIntent | undefined;
  for (const intent of intents.values()) {
    if (!sameProject(intent.project) || intent.knownSessionIds.has(sessionId)) continue;
    if (!best || intent.startedAt < best.startedAt) best = intent;
  }
  return best?.shellId;
}

export function subscribeRemoteCreateIntents(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(REMOTE_CREATE_INTENT_CHANGE, listener);
  return () => window.removeEventListener(REMOTE_CREATE_INTENT_CHANGE, listener);
}

export function resetRemoteCreateIntentsForTests() {
  intents.clear();
}
