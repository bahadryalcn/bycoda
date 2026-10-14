import {
  gitDiffFiles,
  gitDiffIndex,
  notifyGitChanged,
  subscribeGitChanged,
  type GitChangeScope,
  type GitDiffIndex,
} from "../../../platform/tauri/fs";

/**
 * One in-flight `git status` and one fresh result per checkout, shared by the
 * Changes panel, the file-tree decorations and the all-changes diff, which all
 * react to the same change event.
 */

/** How long a finished result still answers a request that names no age. */
export const GIT_INDEX_FRESH_MS = 300;

type Result = { value: GitDiffIndex; full: boolean; at: number };
type Flight = {
  promise: Promise<GitDiffIndex>;
  full: boolean;
  gen: number;
  startedAt: number;
};
type Entry = { gen: number; result: Result | null; flight: Flight | null };

const entries = new Map<string, Entry>();

function entryFor(cwd: string): Entry {
  let entry = entries.get(cwd);
  if (!entry) {
    entry = { gen: 0, result: null, flight: null };
    entries.set(cwd, entry);
  }
  return entry;
}

export type GitIndexRequest = {
  /** Needs the branch/upstream sync fields, not just the file list. */
  full?: boolean;
  /** Oldest acceptable moment for a finished result or a started request. */
  since?: number;
};

/**
 * A full index also answers a files-only request. A request is served by a
 * result that finished at or after `since`, else joins a request that started
 * at or after it, else starts a new one.
 */
export function fetchGitIndex(
  cwd: string,
  { full = false, since }: GitIndexRequest = {},
): Promise<GitDiffIndex> {
  const entry = entryFor(cwd);
  const floor = since ?? Date.now() - GIT_INDEX_FRESH_MS;
  const { result, flight } = entry;
  if (result && result.at >= floor && (result.full || !full)) {
    return Promise.resolve(result.value);
  }
  if (flight && flight.gen === entry.gen && flight.startedAt >= floor && (flight.full || !full)) {
    return flight.promise;
  }
  const gen = entry.gen;
  const startedAt = Date.now();
  const started: Flight = {
    promise: (full ? gitDiffIndex(cwd) : gitDiffFiles(cwd))
      .then((value) => {
        const known = entry.result;
        // A mutation since the request began makes the answer unfit to keep,
        // and a full result that finished meanwhile is worth more.
        if (entry.gen === gen && !(known?.full && !full && known.at > startedAt)) {
          entry.result = { value, full, at: Date.now() };
        }
        return value;
      })
      .finally(() => {
        if (entry.flight === started) entry.flight = null;
      }),
    full,
    gen,
    startedAt,
  };
  entry.flight = started;
  return started.promise;
}

/** Forget every result and stop new requests from joining a running one. */
export function invalidateGitIndex() {
  for (const entry of entries.values()) {
    entry.gen += 1;
    entry.result = null;
    entry.flight = null;
  }
}

/** For tests. */
export function resetGitIndexStore() {
  entries.clear();
}

/**
 * What a git-changed event says about itself, readable by its listeners while
 * the event is being delivered.
 * - `observed`: the announcer just read this state through the store, so the
 *   shared result is current and must not be dropped.
 * - `paths`: the only files whose contents may differ from what listeners last
 *   loaded. Absent means anything may have changed.
 */
export type GitChangeHint = {
  observed?: boolean;
  paths?: readonly string[];
};

let delivering: GitChangeHint | null = null;

export function notifyGitChangedWith(cwd: string, scope: GitChangeScope, hint: GitChangeHint) {
  const previous = delivering;
  delivering = hint;
  try {
    notifyGitChanged(cwd, scope);
  } finally {
    delivering = previous;
  }
}

/** Call synchronously from a git-changed listener. */
export function currentGitChangeHint(): GitChangeHint | null {
  return delivering;
}

// Registered when the module loads, ahead of every consumer's own listener, so
// a mutation drops the shared result before anyone asks for a fresh one.
if (typeof window !== "undefined") {
  try {
    subscribeGitChanged(() => {
      if (!delivering?.observed) invalidateGitIndex();
    });
  } catch {
    // A partial fs mock in a test.
  }
}
