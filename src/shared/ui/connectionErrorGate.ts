import { useSyncExternalStore } from "react";

/**
 * Decides whether an error is a machine connection failure that the one central (top-center)
 * connection notice already explains. Shared failure components consult it so a pane, row or
 * field never repeats "can't reach the machine" with its own small Retry while that notice is up.
 * The workspace owner of the connection notice installs the gate; without it nothing is hidden.
 */
type Gate = (error: unknown) => boolean;

let gate: Gate | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Installs (or with `null` removes) the gate; call again whenever its answers change. */
export function setConnectionErrorGate(next: Gate | null) {
  gate = next;
  for (const listener of listeners) listener();
}

const empty = (error: unknown) => error === undefined || error === null || error === "";

/** True while the central connection notice explains this error. */
export function isConnectionErrorShownCentrally(error: unknown): boolean {
  return !!gate && !empty(error) && gate(error);
}

/**
 * Hook form of `isConnectionErrorShownCentrally`: rerenders when the gate changes, so the inline
 * failure returns once the machine is back and a remaining error is a different one.
 */
export function useConnectionErrorShownCentrally(error: unknown): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isConnectionErrorShownCentrally(error),
    () => false,
  );
}
