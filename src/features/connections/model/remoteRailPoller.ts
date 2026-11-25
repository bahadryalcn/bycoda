import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import { withTimeout } from "../../../shared/lib/withTimeout";
import {
  foregroundPollingDelay,
  foregroundPollsVisible,
  subscribeForegroundPolling,
} from "../../../shared/lib/foregroundPolling";
import type { HostSessionSummary } from "./protocol";
import { remoteBackoffDelay, withBackoffJitter } from "./remotePollingPolicy";

/** At most this many session-list requests of one rail are in flight. */
export const RAIL_POLL_CONCURRENCY = 4;

/** A focus or visibility wake skips a target whose read settled this recently, the same
 * window `remoteReconnect` uses, so switching windows cannot repeat forced reads (and the
 * SSH dials they start). Only the network returning bypasses it. */
export const RAIL_WAKE_RECHECK_MS = 15_000;

/** A load that has not settled by then counts as a failure, so a stuck read cannot hold its slot. */
export const RAIL_LOAD_TIMEOUT_MS = 30_000;

export interface SlotLimiter {
  acquire: () => Promise<void>;
  release: () => void;
  /** Starts `task` once a slot is free and frees the slot when it settles.
   * Resolves undefined without starting it when `cancelled()` holds by then. */
  run: <T>(task: () => Promise<T>, cancelled?: () => boolean) => Promise<T | undefined>;
  /** Lets every queued waiter proceed, so a stopped owner leaves nothing pending. */
  drain: () => void;
}

/** Waiters are served first come, first served, so callers queue in priority order. */
export function createSlotLimiter(limit: number = RAIL_POLL_CONCURRENCY): SlotLimiter {
  let inFlight = 0;
  const waiting: (() => void)[] = [];
  const acquire = (): Promise<void> =>
    inFlight < limit
      ? (inFlight++, Promise.resolve())
      : new Promise((resolve) => waiting.push(resolve));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  };
  return {
    acquire,
    release,
    run: async (task, cancelled) => {
      await acquire();
      try {
        return cancelled?.() ? undefined : await task();
      } finally {
        release();
      }
    },
    drain: () => {
      for (const next of waiting.splice(0)) next();
    },
  };
}

/** Polls each target on its own schedule: a result is handed over as soon as
 * it arrives, and a failing target backs off by its own failure count, so a
 * reachable machine neither delays nor speeds up an unreachable one. Returns
 * a function that stops it. */
export function startRailPoller<T>(options: {
  targets: readonly T[];
  load: (target: T, force?: boolean) => Promise<HostSessionSummary[] | undefined>;
  onResult: (target: T, list: HostSessionSummary[]) => void;
  onError?: (target: T, reason: unknown) => void;
  foregroundMs?: number;
  concurrency?: number;
  loadTimeoutMs?: number;
  random?: () => number;
  refreshEvent?: string;
}): () => void {
  const limit = options.concurrency ?? RAIL_POLL_CONCURRENCY;
  let stopped = false;
  const { acquire, release, drain } = createSlotLimiter(limit);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  type TargetState = {
    target: T;
    failures: number;
    running: boolean;
    wakePending: boolean;
    force: boolean;
    /** When the last read settled, on the monotonic clock. */
    settledAt?: number;
    list?: HostSessionSummary[];
    timer?: ReturnType<typeof setTimeout>;
  };
  const states: TargetState[] = options.targets.map((target) => ({
    target,
    failures: 0,
    running: false,
    wakePending: false,
    force: false,
  }));
  const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
  const active = () => online() && foregroundPollsVisible();
  const delayFor = (state: TargetState) => {
    const running = state.list?.some((session) => session.status === "running");
    const foreground = foregroundPollingDelay(
      options.foregroundMs ?? (running ? 4_000 : 5_000),
      running,
    );
    return state.failures
      ? Math.max(foreground, withBackoffJitter(remoteBackoffDelay(state.failures), options.random))
      : foreground;
  };
  const clear = (state: TargetState) => {
    if (state.timer !== undefined) {
      clearTimeout(state.timer);
      timers.delete(state.timer);
      state.timer = undefined;
    }
  };
  const schedule = (state: TargetState, delay: number) => {
    if (stopped) return;
    clear(state);
    if (!active()) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      state.timer = undefined;
      void poll(state);
    }, delay);
    state.timer = timer;
    timers.add(timer);
  };

  const poll = async (state: TargetState) => {
    if (stopped || state.running) return;
    state.running = true;
    await acquire();
    let list: HostSessionSummary[] | undefined;
    let cause: unknown;
    let attempted = false;
    try {
      if (!stopped && active()) {
        attempted = true;
        const force = state.force;
        state.force = false;
        const pending = force ? options.load(state.target, true) : options.load(state.target);
        const next = await withTimeout(
          pending,
          options.loadTimeoutMs ?? RAIL_LOAD_TIMEOUT_MS,
          "Session list",
        );
        list = Array.isArray(next) ? next : undefined;
      }
    } catch (error) {
      cause = error;
      list = undefined;
    } finally {
      release();
    }
    state.running = false;
    if (stopped) return;
    if (attempted) {
      state.settledAt = monotonicNow();
      if (list) {
        state.list = list;
        state.failures = 0;
        options.onResult(state.target, list);
      } else {
        state.failures = Math.min(4, state.failures + 1);
        options.onError?.(state.target, cause ?? new Error("Session list unavailable"));
      }
    }
    const immediate = state.wakePending && active();
    state.wakePending = false;
    schedule(state, immediate ? 0 : delayFor(state));
  };

  const wake = (force: boolean) => {
    for (const state of states) {
      if (active() && !force) {
        // A focus or visibility change is not new evidence about a machine: a read in
        // flight or settled just now already answers it, and a failing target keeps its
        // backoff instead of redialing on every window switch.
        if (state.running) continue;
        const spent = state.settledAt === undefined ? undefined : elapsedSince(state.settledAt);
        if (state.failures > 0 || (spent !== undefined && spent < RAIL_WAKE_RECHECK_MS)) {
          continue;
        }
      }
      clear(state);
      state.force = active();
      if (state.running) state.wakePending = state.force;
      else if (state.force) schedule(state, 0);
    }
  };
  let wasVisible = foregroundPollsVisible();
  const stopWatching = subscribeForegroundPolling((resumed) => {
    const visible = foregroundPollsVisible();
    if (resumed) wake(!wasVisible);
    else
      for (const state of states) {
        if (!active()) clear(state);
        else if (!state.running) {
          const spent = state.settledAt === undefined ? 0 : elapsedSince(state.settledAt);
          schedule(state, Math.max(0, delayFor(state) - spent));
        }
      }
    wasVisible = visible;
  });
  const onNetwork = (event: Event) => wake(event.type === "online");
  const onRefresh = () => wake(true);
  if (typeof window !== "undefined") {
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
    if (options.refreshEvent) window.addEventListener(options.refreshEvent, onRefresh);
  }
  if (active()) for (const state of states) void poll(state);
  return () => {
    stopped = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
      if (options.refreshEvent) window.removeEventListener(options.refreshEvent, onRefresh);
    }
    stopWatching();
    // Let queued polls run to their `stopped` check instead of leaving them pending.
    drain();
    timers.forEach(clearTimeout);
    timers.clear();
  };
}
