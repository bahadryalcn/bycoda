import { useEffect } from "react";

/** Machines the user is working in right now: the machine of an open remote project or of a
 * machine settings view. A machine that is down and not focused is checked rarely and retried
 * quietly; it never raises a notice outside its own session. */

const counts = new Map<string, number>();
const listeners = new Set<(environmentId: string) => void>();

/** Down and unfocused: one quiet check this often. */
export const UNFOCUSED_OFFLINE_CHECK_MS = 5 * 60_000;

export const isMachineFocused = (environmentId: string) => (counts.get(environmentId) ?? 0) > 0;

/** Marks the machine focused until the returned release runs. */
export function focusMachine(environmentId: string): () => void {
  const previous = counts.get(environmentId) ?? 0;
  counts.set(environmentId, previous + 1);
  if (previous === 0) listeners.forEach((listener) => listener(environmentId));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (counts.get(environmentId) ?? 1) - 1;
    if (next > 0) counts.set(environmentId, next);
    else counts.delete(environmentId);
  };
}

/** Hears a machine becoming focused, so a down machine is checked at once. */
export function subscribeMachineFocused(listener: (environmentId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Keeps the machine focused while the caller is mounted. */
export function useMachineFocus(environmentId?: string): void {
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- holds the module-level focus mark for the mounted view's machine, released on change or unmount
  useEffect(() => (environmentId ? focusMachine(environmentId) : undefined), [environmentId]);
}
