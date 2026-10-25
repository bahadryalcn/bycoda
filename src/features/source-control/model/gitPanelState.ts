import { useCallback, useSyncExternalStore } from "react";
import { pathKey } from "../../../shared/lib/paths";

export type AmendTarget = { branch: string | null; head: string | null };

type PanelState = {
  busy: string | null;
  pending: string | null;
  status: string | null;
  message: string;
  generating: boolean;
  stashAction: "create" | `entry:${string}` | null;
  amendTarget: AmendTarget | null;
  feedback: GitOperationFeedback | null;
};

export type GitOperationFeedback = {
  kind: "error" | "warning" | "success" | "info";
  title: string;
  detail?: string;
  retry?: () => Promise<void>;
  url?: string;
};

function createEntry() {
  return {
    state: {
      busy: null,
      pending: null,
      status: null,
      message: "",
      generating: false,
      stashAction: null,
      amendTarget: null,
      feedback: null,
    } as PanelState,
    listeners: new Set<() => void>(),
    generateAbort: { current: null as AbortController | null },
    backgroundFetch: null as Promise<unknown> | null,
    fileActions: {
      current: { tail: Promise.resolve(), size: 0, paths: [] as string[] },
    },
  };
}

// Work and drafts belong to the checkout, not the lifetime of its visible panel.
// Controllers and queues stay in memory; restarting the app never restores a
// loading flag for a process that is no longer running.
const entries = new Map<string, ReturnType<typeof createEntry>>();

export function gitPanelRuntime(cwd: string) {
  cwd = pathKey(cwd);
  let entry = entries.get(cwd);
  if (!entry) {
    entry = createEntry();
    entries.set(cwd, entry);
  }
  return entry;
}

export function setGitFeedback(cwd: string, feedback: GitOperationFeedback | null) {
  const entry = gitPanelRuntime(cwd);
  entry.state = { ...entry.state, feedback };
  entry.listeners.forEach((listener) => listener());
}

/** A remote-ref refresh does not own the local index/commit UI lease. */
export function withGitBackgroundFetch<T>(cwd: string, work: () => Promise<T>): Promise<T> {
  const entry = gitPanelRuntime(cwd);
  if (entry.backgroundFetch) return entry.backgroundFetch as Promise<T>;
  const pending = Promise.resolve()
    .then(work)
    .finally(() => {
      if (entry.backgroundFetch === pending) entry.backgroundFetch = null;
    });
  entry.backgroundFetch = pending;
  return pending;
}

/** Synchronous checkout-wide lease, also used by graph, stash and diff actions. */
export async function withGitOperation<T>(
  cwd: string,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const entry = gitPanelRuntime(cwd);
  if (entry.state.busy)
    throw new Error("Another Git operation is running. Wait for it to finish and retry.");
  entry.state = { ...entry.state, busy: label, pending: label, feedback: null };
  entry.listeners.forEach((listener) => listener());
  try {
    return await work();
  } finally {
    entry.state = { ...entry.state, busy: null, pending: null };
    entry.listeners.forEach((listener) => listener());
  }
}

export function useGitPanelState<K extends keyof PanelState>(cwd: string, key: K) {
  const entry = gitPanelRuntime(cwd);
  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [entry],
  );
  const snapshot = useCallback(() => entry.state[key], [entry, key]);
  const value = useSyncExternalStore(subscribe, snapshot);
  // Async continuations retain the entry they started with, even if the same
  // component has since switched to another checkout.
  const setValue = useCallback(
    (next: PanelState[K]) => {
      if (Object.is(entry.state[key], next)) return;
      entry.state = { ...entry.state, [key]: next };
      entry.listeners.forEach((listener) => listener());
    },
    [entry, key],
  );
  return [value, setValue] as const;
}

export function resetGitPanelState() {
  for (const entry of entries.values()) entry.generateAbort.current?.abort();
  entries.clear();
}
