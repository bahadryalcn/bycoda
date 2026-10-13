import { useLayoutEffect, useReducer, useRef } from "react";
import { createStore } from "zustand/vanilla";
import type { Session } from "./session";
import { sameBlocksIgnoringStreamingText } from "./stableBlocks";

/**
 * Every session of this window. It lives outside `Workspace` so that a
 * streamed token re-renders the pane that shows it instead of the whole shell.
 */
const store = createStore<{ sessions: Session[] }>(() => ({ sessions: [] }));

export function getSessions(): Session[] {
  return store.getState().sessions;
}

/** Same call shape as the React state setter it replaces; applies immediately. */
export function setSessions(update: SessionsUpdate): void {
  // An updater that itself sets sessions runs after the outer one has landed,
  // as a queued React update would, instead of being overwritten by it.
  if (applying) {
    nested.push(update);
    return;
  }
  applying = true;
  try {
    apply(update);
    while (nested.length > 0) apply(nested.shift()!);
  } finally {
    applying = false;
    nested.length = 0;
  }
}

type SessionsUpdate = Session[] | ((previous: Session[]) => Session[]);
let applying = false;
const nested: SessionsUpdate[] = [];
const sessionIndexes = new WeakMap<readonly Session[], Map<string, Session>>();

function apply(update: SessionsUpdate): void {
  const previous = store.getState().sessions;
  const next = typeof update === "function" ? update(previous) : update;
  if (Object.is(next, previous)) return;
  store.setState({ sessions: next });
}

/** Boot and tests: replaces the sessions and the shell's view of them. */
export function resetSessionsStore(initial: Session[]): void {
  store.setState({ sessions: initial });
  setShell(initial);
}

/** Subscribe to one session; re-renders only when that object's identity changes. */
export function selectSessionById(
  sessions: readonly Session[],
  id: string | undefined,
): Session | undefined {
  if (id === undefined) return undefined;
  let index = sessionIndexes.get(sessions);
  if (!index) {
    index = new Map();
    // Preserve find's first-match semantics, even for malformed duplicate IDs.
    for (const session of sessions) if (!index.has(session.id)) index.set(session.id, session);
    sessionIndexes.set(sessions, index);
  }
  return index.get(id);
}

/**
 * Re-renders through ordinary React state rather than `useSyncExternalStore`:
 * a store change then batches with the other `setState` calls made in the same
 * tick (tabs, focus, history), exactly as it did when sessions were component
 * state. A sync-lane store update would render sessions one step ahead of them.
 */
function useStoreValue<T>(subscribe: (listener: () => void) => () => void, read: () => T): T {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const value = read();
  const latest = useRef({ read, value });
  latest.current = { read, value };
  useLayoutEffect(() => {
    const check = () => {
      if (!Object.is(latest.current.read(), latest.current.value)) rerender();
    };
    // A change between this render and the subscription would be missed.
    check();
    return subscribe(check);
  }, [subscribe]);
  return value;
}

export function useSession(id: string | undefined): Session | undefined {
  return useStoreValue(store.subscribe, () => selectSessionById(store.getState().sessions, id));
}

/**
 * True when `next` differs from `shell` only by the streamed text of the last
 * block of some sessions: same length, and every session is the same object or
 * differs solely in a `blocks` array that passes
 * `sameBlocksIgnoringStreamingText`.
 */
export function isTextOnlyChange(shell: readonly Session[], next: readonly Session[]): boolean {
  if (shell === next) return true;
  if (shell.length !== next.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    const a = shell[index];
    const b = next[index];
    if (a === b) continue;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.delete("blocks");
    for (const key of keys) {
      if (!Object.is(a[key as keyof Session], b[key as keyof Session])) {
        return false;
      }
    }
    if (!sameBlocksIgnoringStreamingText(a.blocks, b.blocks)) return false;
  }
  return true;
}

// The shell view: the last array handed to `Workspace`. It is compared against
// the store (not against the previous store value) so a non-text change after
// several text frames is detected relative to what the shell last saw, and the
// array it then adopts holds all the accumulated text.
let shell: Session[] = store.getState().sessions;
const shellListeners = new Set<() => void>();

function setShell(next: Session[]): void {
  if (shell === next) return;
  shell = next;
  for (const listener of [...shellListeners]) listener();
}

store.subscribe((state) => {
  if (!isTextOnlyChange(shell, state.sessions)) setShell(state.sessions);
});

function subscribeShell(listener: () => void): () => void {
  shellListeners.add(listener);
  return () => {
    shellListeners.delete(listener);
  };
}

/** The array `useShellSessions` currently returns (also for tests). */
export function getShellSessions(): Session[] {
  return shell;
}
const getShell = getShellSessions;

/** What `Workspace` renders from: unchanged across text-only frames. */
export function useShellSessions(): Session[] {
  return useStoreValue(subscribeShell, getShell);
}

/**
 * Drop-in for the old `sessionsRef`: always reads the store's current sessions
 * (never the shell's lagging copy), and a write goes straight to the store.
 */
export const sessionsRef: { current: Session[] } = {
  get current() {
    return getSessions();
  },
  set current(value: Session[]) {
    setSessions(value);
  },
};

/** Every session with its live streamed text; re-renders on each store change. */
export function useLiveSessions(): Session[] {
  return useStoreValue(store.subscribe, getSessions);
}
