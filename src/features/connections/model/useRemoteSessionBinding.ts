import { useSyncExternalStore } from "react";
import {
  REMOTE_PENDING_WORKTREE_CHANGE,
  REMOTE_TAB_BINDING_CHANGE,
  remotePendingWorktreesRaw,
  remoteTabBindingsRaw,
} from "./connections";

/** What the remote tab bindings and pending worktrees say right now. */
export type RemoteSessionBindings = {
  /** The host session a tab shows; none for a new session. Same answer as `remoteSessionFor`. */
  sessionFor: (shellId: string) => string | undefined;
  /** The worktree a new remote tab will use. Same answer as `remotePendingWorktree`. */
  pendingWorktree: (shellId: string) => string | undefined;
};

function parseRecord(raw: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringAt(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

let cached:
  | { tabs: string | null; worktrees: string | null; bindings: RemoteSessionBindings }
  | undefined;

/** Referentially stable while neither stored value changes, so it is a valid snapshot. */
function bindingsSnapshot(): RemoteSessionBindings {
  const tabs = remoteTabBindingsRaw();
  const worktrees = remotePendingWorktreesRaw();
  if (cached && cached.tabs === tabs && cached.worktrees === worktrees) return cached.bindings;
  const tabRecord = parseRecord(tabs);
  const worktreeRecord = parseRecord(worktrees);
  const bindings: RemoteSessionBindings = {
    sessionFor: (shellId) => stringAt(tabRecord, shellId),
    pendingWorktree: (shellId) => stringAt(worktreeRecord, shellId),
  };
  cached = { tabs, worktrees, bindings };
  return bindings;
}

const EMPTY: RemoteSessionBindings = {
  sessionFor: () => undefined,
  pendingWorktree: () => undefined,
};

function subscribe(onChange: () => void) {
  window.addEventListener(REMOTE_TAB_BINDING_CHANGE, onChange);
  window.addEventListener(REMOTE_PENDING_WORKTREE_CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(REMOTE_TAB_BINDING_CHANGE, onChange);
    window.removeEventListener(REMOTE_PENDING_WORKTREE_CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The remote tab bindings and pending worktrees. Both live in localStorage, which React
 * Compiler cannot see change, so they are read through a subscription to the binding and
 * worktree change events (and cross-window `storage`). The lookups are one object per stored
 * value, so it only changes identity when a binding or worktree changes.
 */
export function useRemoteSessionBindings(): RemoteSessionBindings {
  return useSyncExternalStore(subscribe, bindingsSnapshot, () => EMPTY);
}
