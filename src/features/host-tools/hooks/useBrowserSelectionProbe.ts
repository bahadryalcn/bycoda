import { useEffect, useRef } from "react";

/** Pause between status reads while the selection is healthy. */
export const SELECTION_PROBE_MS = 5000;
/** Pause before re-reading after a failed read, so a brief outage is noticed quickly. */
const SELECTION_RETRY_MS = 2000;
/** Consecutive failed reads after which the selection is given up as lost. */
export const SELECTION_PROBE_MAX_FAILURES = 3;

/**
 * Keep-alive read for an open element selection. Each read asks the Host for its status; the
 * caller's `probe` applies the answer, so an explicit "no lease / not selecting" status still ends
 * the selection there. This hook only decides when to read and how to treat failures: a rejected
 * read is a transport problem, not an expired lease, so the selection is kept and `onUnstable`
 * reports the failure count. Only `SELECTION_PROBE_MAX_FAILURES` consecutive failures reach
 * `onLost`, after which the loop ends. A read does not run while the page is hidden or another
 * request is pending; becoming visible reads at once.
 */
export function useBrowserSelectionProbe({
  enabled,
  probe,
  idle,
  onUnstable,
  onRecovered,
  onLost,
}: {
  enabled: boolean;
  probe: () => Promise<unknown>;
  /** Whether no other browser request is pending. */
  idle: () => boolean;
  onUnstable: (failures: number) => void;
  onRecovered: () => void;
  onLost: () => void;
}) {
  const latest = useRef({ probe, idle, onUnstable, onRecovered, onLost });
  latest.current = { probe, idle, onUnstable, onRecovered, onLost };
  // Runs the probe loop for as long as the selection is open and the panel is visible.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void attempt(), ms);
    };
    const attempt = async () => {
      clearTimeout(timer);
      if (cancelled || running) return;
      // A hidden page reads again when it becomes visible (see `onVisible`).
      if (document.hidden) return;
      if (!latest.current.idle()) {
        schedule(failures ? SELECTION_RETRY_MS : SELECTION_PROBE_MS);
        return;
      }
      running = true;
      try {
        await latest.current.probe();
        if (cancelled) return;
        if (failures) latest.current.onRecovered();
        failures = 0;
      } catch {
        if (cancelled) return;
        if (++failures >= SELECTION_PROBE_MAX_FAILURES) {
          latest.current.onLost();
          return;
        }
        latest.current.onUnstable(failures);
      } finally {
        running = false;
      }
      if (!cancelled) schedule(failures ? SELECTION_RETRY_MS : SELECTION_PROBE_MS);
    };
    const onVisible = () => {
      if (!document.hidden) void attempt();
    };
    schedule(SELECTION_PROBE_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
}
