/**
 * The one record of sessions that finished or failed while the owner was not
 * looking. The sidebar reads all of it; the taskbar applies the notification
 * preference gate on read (`sessionsNeedingAttention`), so neither keeps its own set.
 */
let unseen: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function unseenFinishedSnapshot(): ReadonlySet<string> {
  return unseen;
}

/** Replaces the set; listeners run only when the content changed. */
export function publishUnseenFinished(next: ReadonlySet<string>) {
  if (next.size === unseen.size && [...next].every((id) => unseen.has(id))) return;
  unseen = next;
  for (const listener of listeners) listener();
}

export function subscribeUnseenFinished(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
