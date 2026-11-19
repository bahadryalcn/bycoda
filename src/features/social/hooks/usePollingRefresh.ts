import { useCallback, useEffect, useRef } from "react";
import {
  createRefreshScheduler,
  HIDDEN_REFRESH_MS,
  type RefreshScheduler,
} from "../../automations/model/refreshScheduler";

/** Longest wait between reads after repeated failures; a Host that stays down is not hammered. */
const MAX_BACKOFF_MS = 5 * 60_000;

export type PollingRefreshOptions = {
  /** False while the screen is retained but hidden: polling stops and a read still running is dropped. */
  active: boolean;
  /** Identity of what is read (the client or the account). A new value restarts polling at once. */
  scope: unknown;
  intervalMs: number;
  /**
   * Reads once and publishes only while `isCurrent()` holds. Throw when the read failed, so the next
   * poll waits longer; a successful read returns to the normal cadence.
   */
  load: (isCurrent: () => boolean) => Promise<void>;
};

/**
 * Polls a Social read through the shared refresh scheduler: normal cadence while the window is
 * visible, a slower one while hidden, an immediate read when shown again, and exponential backoff
 * after failures. Returns an explicit refresh that runs now, or right after a read in flight, and
 * resets the backoff once it succeeds.
 */
export function usePollingRefresh({
  active,
  scope,
  intervalMs,
  load,
}: PollingRefreshOptions): () => Promise<void> {
  const loadRef = useRef(load);
  const schedulerRef = useRef<RefreshScheduler | null>(null);
  // Commits the latest read before the poll effect below starts its first run.
  useEffect(() => {
    loadRef.current = load;
  });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the Host poll attached only while the screen is active and restarts it for a new scope.
  useEffect(() => {
    if (!active) return;
    const scheduler = createRefreshScheduler({
      run: (isCurrent) => loadRef.current(isCurrent),
      intervalMs,
      hiddenIntervalMs: HIDDEN_REFRESH_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
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
  }, [active, intervalMs, scope]);

  return useCallback(() => schedulerRef.current?.refresh() ?? Promise.resolve(), []);
}
