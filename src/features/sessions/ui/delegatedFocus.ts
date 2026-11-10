/** One pending request survives parent pane mounting, and expires when navigation stops. */
export const VIEW_DELEGATED_EVENT = "bycoda:view-delegated";
let pending: { parentId: string; childId: string } | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;

export function requestViewDelegated(parentId: string, childId: string): void {
  pending = { parentId, childId };
  clearTimeout(expiry);
  expiry = setTimeout(() => {
    pending = undefined;
  }, 10_000);
  window.dispatchEvent(new Event(VIEW_DELEGATED_EVENT));
}

export function consumeViewDelegated(parentId: string): string | undefined {
  if (pending?.parentId !== parentId) return undefined;
  const childId = pending.childId;
  pending = undefined;
  clearTimeout(expiry);
  return childId;
}

const stoppers = new Map<string, (childId: string) => Promise<void>>();

/** The pane that owns a session's delegated children answers their Stop from the transcript. */
export function registerDelegatedStop(
  parentId: string,
  stop: (childId: string) => Promise<void>,
): () => void {
  stoppers.set(parentId, stop);
  return () => {
    if (stoppers.get(parentId) === stop) stoppers.delete(parentId);
  };
}

export function stopDelegated(parentId: string, childId: string): Promise<void> {
  const stop = stoppers.get(parentId);
  return stop ? stop(childId) : Promise.reject(new Error("No pane owns this conversation"));
}
