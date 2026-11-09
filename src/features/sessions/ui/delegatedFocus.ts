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
