import type { HostSessionSummary } from "./protocol";
import { remoteBackoffDelay, withBackoffJitter } from "./remotePollingPolicy";

/** At most this many session-list requests of one rail are in flight. */
export const RAIL_POLL_CONCURRENCY = 4;

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
  random?: () => number;
}): () => void {
  const limit = options.concurrency ?? RAIL_POLL_CONCURRENCY;
  let stopped = false;
  let inFlight = 0;
  const waiting: (() => void)[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  type TargetState = {
    target: T;
    failures: number;
    running: boolean;
    wakePending: boolean;
    force: boolean;
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
  const hidden = () => typeof document !== "undefined" && document.hidden;
  const delayFor = (state: TargetState) => {
    const foreground =
      options.foregroundMs ??
      (state.list?.some((session) => session.status === "running") ? 4_000 : 5_000);
    const normal = !online() ? 60_000 : hidden() ? 30_000 : foreground;
    return state.failures
      ? Math.max(normal, withBackoffJitter(remoteBackoffDelay(state.failures), options.random))
      : normal;
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
    const timer = setTimeout(() => {
      timers.delete(timer);
      state.timer = undefined;
      void poll(state);
    }, delay);
    state.timer = timer;
    timers.add(timer);
  };

  const acquire = (): Promise<void> =>
    inFlight < limit
      ? (inFlight++, Promise.resolve())
      : new Promise((resolve) => waiting.push(resolve));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  };

  const poll = async (state: TargetState) => {
    if (stopped || state.running) return;
    state.running = true;
    await acquire();
    let list: HostSessionSummary[] | undefined;
    let cause: unknown;
    let attempted = false;
    try {
      if (!stopped && online()) {
        attempted = true;
        const force = state.force;
        state.force = false;
        const next = await (force ? options.load(state.target, true) : options.load(state.target));
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
      if (list) {
        state.list = list;
        state.failures = 0;
        options.onResult(state.target, list);
      } else {
        state.failures = Math.min(4, state.failures + 1);
        options.onError?.(state.target, cause ?? new Error("Session list unavailable"));
      }
    }
    const immediate = state.wakePending && online() && !hidden();
    state.wakePending = false;
    schedule(state, immediate ? 0 : delayFor(state));
  };

  const wake = () => {
    const active = online() && !hidden();
    for (const state of states) {
      clear(state);
      state.force = active;
      if (state.running) state.wakePending = active;
      else schedule(state, active ? 0 : delayFor(state));
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    document.addEventListener("visibilitychange", wake);
  }
  for (const state of states) void poll(state);
  return () => {
    stopped = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
      document.removeEventListener("visibilitychange", wake);
    }
    waiting.length = 0;
    timers.forEach(clearTimeout);
    timers.clear();
  };
}
