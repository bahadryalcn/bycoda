import { sameToolsSession } from "./toolsSessionRegistry";
import { useSyncExternalStore } from "react";
import { createStore } from "../../shared/lib/store";

type PaneIdentity = { cwd: string; sessionId: string };
const owners = new Map<object, readonly PaneIdentity[]>();
const store = createStore();

export function setDockedToolPanes(owner: object, panes: readonly PaneIdentity[]) {
  if (panes.length) owners.set(owner, panes);
  else owners.delete(owner);
  store.notify();
}

const subscribe = store.subscribe;

export function useDockedTools(tools: PaneIdentity) {
  return useSyncExternalStore(
    subscribe,
    () => [...owners.values()].some((panes) => panes.some((pane) => sameToolsSession(pane, tools))),
    () => false,
  );
}
