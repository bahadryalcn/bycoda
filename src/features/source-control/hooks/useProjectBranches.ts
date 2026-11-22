import { CheckoutCache } from "../model/checkoutCache";
import { errorText } from "../../../shared/lib/errors";
import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";
import {
  gitBranches,
  isGitWatched,
  subscribeGitChanged,
  type GitBranches,
} from "../../../platform/tauri/fs";
import { reportRemoteLoad, subscribeRemoteRecovered } from "../../connections/public/remoteHealth";
import { useMachineAvailability } from "../../connections/public/machineAvailability";
import { isRemoteProjectPath } from "../../projects/public/recents";

export type ProjectBranchesState = {
  branches: GitBranches | null;
  /** First lookup for this cwd has finished, repo or not. */
  settled: boolean;
  /** The branch could not be read (machine unreachable or the request failed), as opposed to a
   * successful read that found no repository. `branches` is then the last known value, if any. */
  unreachable: boolean;
};

const PENDING: ProjectBranchesState = { branches: null, settled: false, unreachable: false };

type Entry = {
  cwd: string;
  state: ProjectBranchesState;
  listeners: ReturnType<typeof createStore<[]>>;
  inFlight: boolean;
  pending: boolean;
  /** A change arrived while the window was hidden. */
  missed: boolean;
  unsubscribeGit: (() => void) | null;
  unsubscribeRecovery: (() => void) | null;
  onResume: (() => void) | null;
};

const entries = new CheckoutCache<string, Entry>(
  (entry) => entry.listeners.size > 0 || !!entry.inFlight,
  (entry) => entry.state,
);

function branchesEqual(a: GitBranches | null, b: GitBranches | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.current !== b.current ||
    a.detached !== b.detached ||
    a.branches.length !== b.branches.length
  ) {
    return false;
  }
  return a.branches.every((branch, index) => {
    const other = b.branches[index];
    return (
      other != null &&
      branch.name === other.name &&
      branch.current === other.current &&
      branch.remote === other.remote
    );
  });
}

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    cwd,
    state: PENDING,
    listeners: createStore(),
    inFlight: false,
    pending: false,
    missed: false,
    unsubscribeGit: null,
    unsubscribeRecovery: null,
    onResume: null,
  };
  entries.set(cwd, entry);
  return entry;
}

function publish(entry: Entry, branches: GitBranches | null) {
  // `settled` still has to flip on a lookup that found nothing, so an
  // unchanged `null` is only a no-op once the first one has landed.
  if (
    entry.state.settled &&
    !entry.state.unreachable &&
    branchesEqual(entry.state.branches, branches)
  ) {
    return;
  }
  entry.state = { branches, settled: true, unreachable: false };
  entries.refresh(entry.cwd);
  entry.listeners.notify();
}

/** A failed read keeps the last known branches and marks them unverified. */
function publishUnreachable(entry: Entry) {
  if (entry.state.unreachable) return;
  entry.state = { branches: entry.state.branches, settled: true, unreachable: true };
  entries.refresh(entry.cwd);
  entry.listeners.notify();
}

/** Carry an already loaded snapshot into a separate picker webview before
 * mounting its controls. Subscribing still revalidates against Git. */
export function seedProjectBranches(cwd: string, branches: GitBranches) {
  if (cwd && cwd !== "~") publish(entryFor(cwd), branches);
}

async function load(entry: Entry, force = false) {
  if (entries.get(entry.cwd) !== entry) return;
  if (entry.inFlight) {
    entry.pending ||= force;
    return;
  }
  if (!force && document.hidden) return;
  entry.inFlight = true;
  try {
    publish(entry, await gitBranches(entry.cwd));
    if (isRemoteProjectPath(entry.cwd)) reportRemoteLoad(entry.cwd, "branches");
  } catch (error) {
    if (!isRemoteProjectPath(entry.cwd)) return publish(entry, null);
    reportRemoteLoad(entry.cwd, "branches", error);
    // The Host answered that the folder is not a repository: that is a definite "no repository".
    if (/not a git repository/i.test(errorText(error))) return publish(entry, null);
    // Otherwise the remote project keeps the branches it last had; the lookup still counts
    // as settled so callers stop waiting, but it is not "no repository".
    publishUnreachable(entry);
  } finally {
    entry.inFlight = false;
    if (entry.pending) {
      entry.pending = false;
      void load(entry, true);
    }
    entries.prune();
  }
}

function start(entry: Entry) {
  if (entry.onResume) return;
  void load(entry, true);
  // A watched checkout reports its own branch changes; focus only catches up
  // on one that arrived while hidden.
  entry.onResume = () => {
    if (document.hidden || (!entry.missed && isGitWatched(entry.cwd))) return;
    entry.missed = false;
    void load(entry, true);
  };
  window.addEventListener("focus", entry.onResume);
  document.addEventListener("visibilitychange", entry.onResume);
  // A machine that answers again replaces a last-known branch without user action.
  entry.unsubscribeRecovery = subscribeRemoteRecovered(() => {
    if (entry.state.unreachable) void load(entry, true);
  });
  entry.unsubscribeGit = subscribeGitChanged(
    () => {
      if (document.hidden) entry.missed = true;
      else void load(entry, true);
    },
    { cwd: entry.cwd, refsOnly: true },
  );
}

function stop(entry: Entry) {
  if (entry.onResume) {
    window.removeEventListener("focus", entry.onResume);
    document.removeEventListener("visibilitychange", entry.onResume);
  }
  entry.unsubscribeGit?.();
  entry.unsubscribeRecovery?.();
  entry.unsubscribeRecovery = null;
  entry.onResume = null;
  entry.unsubscribeGit = null;
}

/** Branch list plus whether git has answered yet, for callers that must not
 *  confuse "still looking" with "not a repo". */
export function useProjectBranchesState(cwd: string, enabled: boolean): ProjectBranchesState {
  const active = enabled && Boolean(cwd) && cwd !== "~";
  // The last branches stay shown, but a machine that cannot be asked is not read.
  const readable = useMachineAvailability(cwd).available;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active || !readable) return () => undefined;
      const entry = entryFor(cwd);
      const unsubscribe = entry.listeners.subscribe(listener);
      if (entry.listeners.size === 1) start(entry);
      return () => {
        unsubscribe();
        if (entry.listeners.size === 0) stop(entry);
        entries.prune();
      };
    },
    [active, readable, cwd],
  );
  const getSnapshot = useCallback(() => {
    return active ? entryFor(cwd).state : PENDING;
  }, [active, cwd]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!active || readable) return state;
  // An unreadable machine is never "still loading" or "no repo": report the cached branch.
  return { branches: state.branches, settled: true, unreachable: true };
}

export function useProjectBranches(cwd: string, enabled: boolean): GitBranches | null {
  return useProjectBranchesState(cwd, enabled).branches;
}
