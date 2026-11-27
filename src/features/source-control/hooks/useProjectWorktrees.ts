import { presentRemoteError } from "../../connections/public/remoteFailure";
import { useMachineAvailability } from "../../connections/public/machineAvailability";
import { CheckoutCache } from "../model/checkoutCache";
import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";
import { isGitWatched, subscribeGitChanged } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import { listWorktrees, type Worktrees } from "../model/worktrees";
import { missingPathNamedIn } from "../model/checkoutSelection";

type Snapshot = { data?: Worktrees; error?: string; loading?: boolean };
type Entry = {
  cwd: string;
  snapshot: Snapshot;
  listeners: ReturnType<typeof createStore<[]>>;
  inFlight?: Promise<boolean>;
  activeLane?: "default" | "background";
  generation: number;
  pendingLane?: "default" | "background";
  stop?: () => void;
};

const EMPTY: Snapshot = {};
const entries = new CheckoutCache<string, Entry>(
  (entry) => entry.listeners.size > 0 || !!entry.inFlight,
  (entry) => entry.snapshot,
);

function entryFor(cwd: string): Entry {
  const key = pathKey(cwd);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      cwd,
      snapshot: EMPTY,
      listeners: createStore(),
      generation: 0,
    };
    entries.set(key, entry);
  }
  return entry;
}

function publish(entry: Entry, snapshot: Snapshot) {
  const previous = entry.snapshot;
  entry.snapshot = snapshot;
  if (previous.data !== snapshot.data || previous.error !== snapshot.error)
    entries.refresh(pathKey(entry.cwd));
  entry.listeners.notify();
}

function load(
  entry: Entry,
  lane: "default" | "background" = "default",
  invalidated = false,
): Promise<boolean> {
  if (entries.get(pathKey(entry.cwd)) !== entry) return Promise.resolve(false);
  if (entry.inFlight && !(lane === "default" && entry.activeLane === "background")) {
    // A Git mutation during a read needs a follow-up; repeated focus/open
    // events can share the request already in progress.
    if (invalidated && entry.pendingLane !== "default") entry.pendingLane = lane;
    return entry.inFlight;
  }
  const generation = ++entry.generation;
  entry.activeLane = lane;
  entry.pendingLane = undefined;
  entry.inFlight = (async () => {
    let loaded = false;
    try {
      const data = await (lane === "background"
        ? listWorktrees(entry.cwd, { background: true })
        : listWorktrees(entry.cwd));
      if (entry.generation !== generation) return false;
      publish(entry, { data, loading: false });
      loaded = true;
    } catch (error) {
      if (entry.generation !== generation) return false;
      // One listed worktree deleted from elsewhere fails the whole listing with a
      // "cannot change to" naming it: keep the list and mark that checkout missing.
      const listed = entry.snapshot.data;
      const vanished = missingPathNamedIn(
        presentRemoteError(error),
        listed?.worktrees.map((tree) => tree.path) ?? [],
      );
      if (listed && vanished) {
        publish(entry, {
          data: {
            ...listed,
            worktrees: listed.worktrees.map((tree) =>
              pathKey(tree.path) === pathKey(vanished) ? { ...tree, missing: true } : tree,
            ),
          },
          loading: false,
        });
        entry.inFlight = undefined;
        entries.prune();
        return true;
      }
      // A background failure must not replace a usable list with a loading or
      // error screen. The caller can still surface the error beside the list.
      publish(entry, { ...entry.snapshot, error: presentRemoteError(error), loading: false });
    }
    entry.inFlight = undefined;
    if (entry.pendingLane) {
      const pendingLane = entry.pendingLane;
      entry.pendingLane = undefined;
      return load(entry, pendingLane);
    }
    entries.prune();
    return loaded;
  })();
  publish(entry, { ...entry.snapshot, loading: true });
  return entry.inFlight;
}

function start(entry: Entry) {
  void load(entry);
  // A watched checkout reports worktree changes itself; focus only catches up
  // on one that arrived while hidden.
  let missed = false;
  const resume = () => {
    if (document.hidden || (!missed && isGitWatched(entry.cwd))) return;
    missed = false;
    void load(entry, "background");
  };
  const unsubscribe = subscribeGitChanged(
    () => {
      if (document.hidden) missed = true;
      else void load(entry, "background", true);
    },
    { cwd: entry.cwd, refsOnly: true },
  );
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
  entry.stop = () => {
    unsubscribe();
    window.removeEventListener("focus", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}

/** Share cached working copies between settings and composers. Revalidation
 * never clears the last successful result, including across unmounts. */
export function useProjectWorktrees(cwd: string, enabled = true) {
  const active = enabled && !!cwd && cwd !== "~";
  // The last worktrees stay shown, but a machine that cannot be asked is not read.
  const readable = useMachineAvailability(cwd).available;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active || !readable) return () => {};
      const entry = entryFor(cwd);
      const unsubscribe = entry.listeners.subscribe(listener);
      if (entry.listeners.size === 1) start(entry);
      return () => {
        unsubscribe();
        if (entry.listeners.size === 0) {
          entry.stop?.();
          entry.stop = undefined;
        }
        entries.prune();
      };
    },
    [active, readable, cwd],
  );
  const getSnapshot = useCallback(() => (active ? entryFor(cwd).snapshot : EMPTY), [active, cwd]);
  const refresh = useCallback(() => {
    return active && readable ? load(entryFor(cwd), "default", true) : Promise.resolve(false);
  }, [active, readable, cwd]);
  return {
    ...useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    refresh,
  };
}
