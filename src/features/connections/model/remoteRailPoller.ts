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
  load: (target: T) => Promise<HostSessionSummary[] | undefined>;
  onResult: (target: T, list: HostSessionSummary[]) => void;
  concurrency?: number;
  random?: () => number;
}): () => void {
  const limit = options.concurrency ?? RAIL_POLL_CONCURRENCY;
  let stopped = false;
  let inFlight = 0;
  const waiting: (() => void)[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const acquire = (): Promise<void> =>
    inFlight < limit
      ? (inFlight++, Promise.resolve())
      : new Promise((resolve) => waiting.push(resolve));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  };

  const poll = async (target: T, failures: number) => {
    await acquire();
    let list: HostSessionSummary[] | undefined;
    try {
      if (!stopped) {
        const next = await options.load(target);
        list = Array.isArray(next) ? next : undefined;
      }
    } catch {
      list = undefined;
    } finally {
      release();
    }
    if (stopped) return;
    if (list) options.onResult(target, list);
    const delay = list
      ? list.some((session) => session.status === "running")
        ? 4_000
        : 5_000
      : withBackoffJitter(remoteBackoffDelay(failures + 1), options.random);
    const timer = setTimeout(() => {
      timers.delete(timer);
      void poll(target, list ? 0 : Math.min(4, failures + 1));
    }, delay);
    timers.add(timer);
  };

  for (const target of options.targets) void poll(target, 0);
  return () => {
    stopped = true;
    waiting.length = 0;
    timers.forEach(clearTimeout);
    timers.clear();
  };
}
