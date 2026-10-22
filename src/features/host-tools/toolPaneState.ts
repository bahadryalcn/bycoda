import { useSyncExternalStore } from "react";

type PaneIdentity = { cwd: string; sessionId: string };
const owners = new Map<object, readonly PaneIdentity[]>();
const listeners = new Set<() => void>();

export function setDockedToolPanes(owner: object, panes: readonly PaneIdentity[]) {
  if (panes.length) owners.set(owner, panes);
  else owners.delete(owner);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDockedTools(tools: PaneIdentity) {
  return useSyncExternalStore(
    subscribe,
    () =>
      [...owners.values()].some((panes) =>
        panes.some((pane) => pane.cwd === tools.cwd && pane.sessionId === tools.sessionId),
      ),
    () => false,
  );
}
