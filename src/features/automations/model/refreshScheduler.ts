import { useCallback, useEffect, useRef } from "react";

/** Polling for a view whose data the host does not push. Refreshes never
 * overlap: the next one is planned after the previous finishes, and a refresh
 * asked for while one runs waits for it and runs once more afterwards. */
export type RefreshSchedulerOptions = {
  /** Does one refresh. `isCurrent` turns false once a newer refresh was asked
   * for or the scheduler stopped; a stale refresh must not publish its result. */
  run: (isCurrent: () => boolean) => Promise<void>;
  intervalMs: number;
  /** Slower cadence while the page is hidden. */
  hiddenIntervalMs: number;
  isHidden?: () => boolean;
};

export type RefreshScheduler = {
  start(): void;
  stop(): void;
  /** Refreshes now, or right after the one in flight. Resolves when a refresh
   * that began after this call has finished. */
  refresh(): Promise<void>;
  /** The page was shown or hidden. */
  visibilityChanged(): void;
};

export const HIDDEN_REFRESH_MS = 60_000;

export function createRefreshScheduler(options: RefreshSchedulerOptions): RefreshScheduler {
  const isHidden = options.isHidden ?? (() => typeof document !== "undefined" && document.hidden);
  let generation = 0;
  let stopped = true;
  let running: Promise<void> | null = null;
  let trailing: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const plan = () => {
    clearTimer();
    if (stopped) return;
    timer = setTimeout(
      () => void scheduler.refresh(),
      isHidden() ? options.hiddenIntervalMs : options.intervalMs,
    );
  };
  const runOnce = (): Promise<void> => {
    clearTimer();
    const mine = ++generation;
    const current = () => !stopped && generation === mine;
    // eslint-disable-next-line prefer-const -- read inside its own initializer
    let pending!: Promise<void>;
    pending = (async () => {
      try {
        // Lets `pending` be assigned even if `run` throws at once.
        await Promise.resolve();
        await options.run(current);
      } catch {
        // A refresh that fails is tried again on the next turn.
      } finally {
        if (running === pending) running = null;
        if (!trailing) plan();
      }
    })();
    running = pending;
    return pending;
  };

  const scheduler: RefreshScheduler = {
    start() {
      stopped = false;
      void runOnce();
    },
    stop() {
      stopped = true;
      generation++;
      clearTimer();
    },
    refresh() {
      if (stopped) return Promise.resolve();
      if (!running) return runOnce();
      // What the running refresh read may predate the change that asked for
      // this one, so its result is dropped.
      generation++;
      trailing ??= running.then(() => {
        trailing = null;
        return stopped ? undefined : runOnce();
      });
      return trailing;
    },
    visibilityChanged() {
      if (stopped) return;
      if (isHidden()) {
        if (!running) plan();
      } else if (!running) void runOnce();
    },
  };
  return scheduler;
}

/** Runs `run` now and then every `intervalMs` while mounted (slower while the
 * page is hidden, and at once when it is shown again). Returns a function that
 * refreshes on demand without overlapping the scheduled ones. */
export function useRefreshLoop(
  run: (isCurrent: () => boolean) => Promise<void>,
  intervalMs: number,
  hiddenIntervalMs: number = HIDDEN_REFRESH_MS,
): () => Promise<void> {
  const runRef = useRef(run);
  runRef.current = run;
  const schedulerRef = useRef<RefreshScheduler | null>(null);
  useEffect(() => {
    const scheduler = createRefreshScheduler({
      run: (isCurrent) => runRef.current(isCurrent),
      intervalMs,
      hiddenIntervalMs,
    });
    schedulerRef.current = scheduler;
    const onVisibility = () => scheduler.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    scheduler.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      scheduler.stop();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [intervalMs, hiddenIntervalMs]);
  return useCallback(() => schedulerRef.current?.refresh() ?? Promise.resolve(), []);
}
