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
