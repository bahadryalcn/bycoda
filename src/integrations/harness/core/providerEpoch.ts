import { forgetSessionCommands, getReportedCommands } from "./reportedCommands";
import { retireProviderOwner } from "./providerRetirement";

/** Retire a cancellation marker only after all captured queued work settles.
 * A replacement queue or marker retains ownership of its state. */
export function retireProviderEpoch<T>(
  epochs: Map<string, T>,
  tails: Map<string, Promise<unknown>>,
  sessionId: string,
  ...otherTails: Map<string, Promise<unknown>>[]
): void {
  if (!epochs.has(sessionId)) return;
  const epoch = epochs.get(sessionId);
  const queues = [tails, ...otherTails];
  const captured = queues.map((queue) => queue.get(sessionId));
  const retire = () => {
    const held = epochHolds.get(epochs)?.get(sessionId);
    if (held?.active) {
      held.deferred.add(retire);
      return;
    }
    if (
      epochs.get(sessionId) === epoch &&
      queues.every((queue, index) => {
        const currentTail = queue.get(sessionId);
        return !currentTail || currentTail === captured[index];
      })
    )
      epochs.delete(sessionId);
  };
  const pending = captured.filter((tail): tail is Promise<unknown> => !!tail);
  if (pending.length)
    void Promise.allSettled(pending)
      .then(retire)
      .catch(() => {});
  else retire();
}

/** Release only discovery owned before the original physical retirement. */
export async function retireProviderOwnerAndCommands(sessionId: string, retire: () => Promise<void>): Promise<void> {
  const commands = getReportedCommands(sessionId);
  await retire();
  await retireProviderOwner(sessionId);
  forgetSessionCommands(sessionId, commands);
}

type EpochHolds = { active: number; deferred: Set<() => void> };
const epochHolds = new WeakMap<object, Map<string, EpochHolds>>();

/** Hold admission before prewarm, including time before a turn tail exists. */
export function holdProviderEpoch(epochs: readonly object[], sessionId: string): () => void {
  const maps = epochs.map((epoch) => {
    let sessions = epochHolds.get(epoch);
    if (!sessions) epochHolds.set(epoch, (sessions = new Map()));
    let state = sessions.get(sessionId);
    if (!state) sessions.set(sessionId, (state = { active: 0, deferred: new Set() }));
    state.active++;
    return { sessions, state };
  });
  return () => {
    for (const { sessions, state } of maps) {
      if (--state.active !== 0) continue;
      sessions.delete(sessionId);
      for (const retire of state.deferred) retire();
    }
  };
}

export function retireProviderEpochs<T>(
  epochs: readonly Map<string, T>[],
  tails: Map<string, Promise<unknown>>,
  sessionId: string,
  ...otherTails: Map<string, Promise<unknown>>[]
): void {
  const captured = epochs.map((map) => map.get(sessionId));
  const retire = () => {
    epochs.forEach((map, index) => {
      if (map.get(sessionId) === captured[index])
        retireProviderEpoch(map, tails, sessionId, ...otherTails);
    });
  };
  const held = epochHolds.get(epochs[0])?.get(sessionId);
  if (held?.active) held.deferred.add(retire);
  else retire();
}
