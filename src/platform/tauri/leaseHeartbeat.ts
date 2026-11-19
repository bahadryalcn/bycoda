import { elapsedSince, monotonicNow } from "../../shared/lib/time/timestamps";

const MIN_INTERVAL_MS = 1_000;

/**
 * Runs `send` every `intervalMs` while the caller is mounted, for a lease the native or Host side
 * expires without a heartbeat. The clock is a dedicated worker, because a hidden or minimized
 * WebView throttles main-thread timers (to once a minute) past a 45 s lease. This only keeps this
 * renderer's own lease fresh: it ends with the renderer, and the returned stop function ends it
 * at once, so authority loss and close still release through their own paths and never wait on it.
 * Ticks closer together than half the interval (a backlog after the thread was blocked) are
 * dropped, and without Worker support or after a worker failure a plain interval takes over.
 */
export function startLeaseHeartbeat(send: () => void, intervalMs: number): () => void {
  const every = Math.max(MIN_INTERVAL_MS, intervalMs);
  let stopped = false;
  let worker: Worker | undefined;
  let fallback: ReturnType<typeof setInterval> | undefined;
  let lastSentAt = monotonicNow();
  const tick = () => {
    if (stopped || elapsedSince(lastSentAt) < every / 2) return;
    lastSentAt = monotonicNow();
    send();
  };
  const useInterval = () => {
    worker?.terminate();
    worker = undefined;
    if (!stopped && fallback === undefined) fallback = setInterval(tick, every);
  };
  if (typeof Worker === "undefined") useInterval();
  else {
    try {
      worker = new Worker(new URL("./leaseHeartbeat.worker.ts", import.meta.url), {
        type: "module",
        name: "lease-heartbeat",
      });
      worker.onmessage = tick;
      worker.onerror = useInterval;
      worker.postMessage({ type: "start", ms: every });
    } catch {
      useInterval();
    }
  }
  return () => {
    stopped = true;
    worker?.terminate();
    worker = undefined;
    clearInterval(fallback);
    fallback = undefined;
  };
}
