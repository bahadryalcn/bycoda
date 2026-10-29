import { useSyncExternalStore } from "react";
import {
  sanitizeServerTerminalRestore,
  type ServerTerminalRestore,
  type ServerTerminalRestoreTab,
} from "./serverTerminalRestore";

/** Result of the latest workspace-snapshot write that carries the saved SSH tabs. */
export type ServerTerminalRestoreSaveStatus = "idle" | "saving" | "failed";

type RestoreState = {
  owner: boolean;
  initialized: boolean;
  loadFailed: boolean;
  saveStatus: ServerTerminalRestoreSaveStatus;
  saveError?: string;
  /** True once the snapshot writer registered a retry handler. */
  canRetrySave: boolean;
  restore?: ServerTerminalRestore;
  pending: readonly string[];
};

function saveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.trim().slice(0, 200);
}

/** Window-local projection of the existing workspace snapshot. No storage or PTY. */
export function createServerTerminalRestoreState() {
  let state: RestoreState = {
    owner: false,
    initialized: false,
    loadFailed: false,
    saveStatus: "idle",
    canRetrySave: false,
    pending: [],
  };
  let inFlightSaves = 0;
  let retryHandler: (() => void | Promise<void>) | undefined;
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
    // Save contract: the snapshot writer reports each real write. The latest
    // result wins, so a later success clears an earlier failure.
    saveStarted: () => {
      inFlightSaves += 1;
      publish({ ...state, saveStatus: "saving", saveError: undefined });
    },
    saveSucceeded: () => {
      inFlightSaves = Math.max(0, inFlightSaves - 1);
      publish({
        ...state,
        saveStatus: inFlightSaves > 0 ? "saving" : "idle",
        saveError: undefined,
      });
    },
    saveFailed: (error: unknown) => {
      inFlightSaves = Math.max(0, inFlightSaves - 1);
      publish({ ...state, saveStatus: "failed", saveError: saveErrorMessage(error) });
    },
    /** The writer registers how to request another write; `undefined` unregisters. */
    setSaveRetry: (handler: (() => void | Promise<void>) | undefined) => {
      retryHandler = handler;
      publish({ ...state, canRetrySave: handler !== undefined });
    },
    retrySave: async () => {
      if (!retryHandler || state.saveStatus === "saving") return;
      try {
        await retryHandler();
      } catch (error) {
        publish({ ...state, saveStatus: "failed", saveError: saveErrorMessage(error) });
      }
    },
    initialize: (value: unknown) => {
      const restore = sanitizeServerTerminalRestore(value);
      // Unknown/corrupt saved data is not consent to remove it on the next save.
      if (value != null && !restore) {
        publish({ ...state, owner: true, initialized: false, loadFailed: true });
        return;
      }
      publish({
        ...state,
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
