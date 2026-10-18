import { useSyncExternalStore } from "react";
import {
  sanitizeServerTerminalRestore,
  type ServerTerminalRestore,
  type ServerTerminalRestoreTab,
} from "./serverTerminalRestore";

type RestoreState = {
  owner: boolean;
  initialized: boolean;
  loadFailed: boolean;
  restore?: ServerTerminalRestore;
  pending: readonly string[];
};

/** Window-local projection of the existing workspace snapshot. No storage or PTY. */
export function createServerTerminalRestoreState() {
  let state: RestoreState = {
    owner: false,
    initialized: false,
    loadFailed: false,
    pending: [],
  };
  const listeners = new Set<() => void>();
  const publish = (next: RestoreState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const update = (value: ServerTerminalRestore | undefined, pending = state.pending) => {
    if (!state.initialized) return;
    const restore = sanitizeServerTerminalRestore(value);
    if (value !== undefined && !restore) return;
    publish({
      ...state,
      restore,
      pending: pending.filter((id) => restore?.tabs.some((tab) => tab.tabId === id)),
    });
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    beginLoad: () => publish({ ...state, owner: true, loadFailed: false }),
    loadFailed: () => publish({ ...state, loadFailed: true }),
    initialize: (value: unknown) => {
      const restore = sanitizeServerTerminalRestore(value);
      // Unknown/corrupt saved data is not consent to remove it on the next save.
      if (value != null && !restore) {
        publish({ ...state, owner: true, initialized: false, loadFailed: true });
        return;
      }
      publish({
        owner: true,
        initialized: true,
        loadFailed: false,
        restore,
        pending: restore?.tabs.map((tab) => tab.tabId) ?? [],
      });
    },
    setEnabled: (enabled: boolean, tabs: readonly ServerTerminalRestoreTab[] = []) => {
      update(enabled ? { version: 1, enabled: true, tabs: tabs.slice(0, 32) } : undefined, []);
    },
    add: (tab: ServerTerminalRestoreTab, replacingPendingId?: string) => {
      const tabs = state.restore?.tabs.filter(
        (item) => item.tabId !== replacingPendingId || !state.pending.includes(item.tabId),
      );
      if (
        !state.restore ||
        !tabs ||
        tabs.length >= 32 ||
        state.restore.tabs.some((item) => item.tabId === tab.tabId)
      )
        return;
      update({ ...state.restore, tabs: [...tabs, tab], activeTabId: tab.tabId });
    },
    activate: (tabId: string) => {
      if (!state.restore?.tabs.some((tab) => tab.tabId === tabId)) return;
      update({ ...state.restore, activeTabId: tabId });
    },
    remove: (tabId: string) => {
      if (!state.restore) return;
      const { activeTabId, ...restore } = state.restore;
      update({
        ...restore,
        tabs: restore.tabs.filter((tab) => tab.tabId !== tabId),
        ...(activeTabId && activeTabId !== tabId ? { activeTabId } : {}),
      });
    },
  };
}

export const serverTerminalRestoreState = createServerTerminalRestoreState();
export const useServerTerminalRestoreState = () =>
  useSyncExternalStore(
    serverTerminalRestoreState.subscribe,
    serverTerminalRestoreState.getSnapshot,
  );
