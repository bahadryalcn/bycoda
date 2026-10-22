/**
 * Asks the transcript to open one delegated run's row, from outside it (the
 * composer's activity dock). The row may be mounted already, or only mount once
 * the transcript has revealed it, so the request waits briefly for it.
 */
export const OPEN_SUBAGENT_EVENT = "bycoda:open-subagent";

const REQUEST_TTL_MS = 1000;

let pending: string | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;

export function requestOpenSubagent(blockId: string): void {
  pending = blockId;
  clearTimeout(expiry);
  expiry = setTimeout(() => {
    pending = null;
  }, REQUEST_TTL_MS);
  window.dispatchEvent(new Event(OPEN_SUBAGENT_EVENT));
}

/** True once for the row the pending request names. */
export function consumeOpenSubagent(blockId: string): boolean {
  if (pending !== blockId) return false;
  pending = null;
  clearTimeout(expiry);
  return true;
}

/**
 * Asks the session pane to open one delegated run's own panel, from anywhere
 * below it (the transcript's "Open" button, the composer's dock). The pane that
 * owns the block answers; every other pane ignores it.
 */
export const VIEW_SUBAGENT_EVENT = "bycoda:view-subagent";

export function requestViewSubagent(blockId: string): void {
  window.dispatchEvent(new CustomEvent<string>(VIEW_SUBAGENT_EVENT, { detail: blockId }));
}
