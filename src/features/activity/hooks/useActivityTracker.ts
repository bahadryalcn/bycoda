import { useEffect } from "react";
import { monotonicNow } from "../../../shared/lib/time/timestamps";
import { activityClient } from "../model/activityClient";
import { saveOutbox, takeOutbox } from "../model/activityOutbox";
import { ActivityTracker, TICK_MS } from "../model/activityTracker";

const FLUSH_MS = 60_000;
const INPUT_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"] as const;

const foreground = () => document.visibilityState === "visible" && document.hasFocus();

/**
 * Mount once in the app shell. Records active minutes for this window (foreground plus input
 * in the last five minutes) and sends them to this computer's Host once a minute. Nothing but
 * minute maps leaves the window. `machineId` is the local Host; without one nothing is tracked.
 */
export function useActivityTracker(machineId: string | undefined): void {
  // Subscribes to window input and timers for one Host; a new Host or unmount runs a last flush
  // and keeps whatever that flush could not deliver in the outbox for the same Host.
  useEffect(() => {
    if (!machineId) return;
    const client = activityClient(machineId);
    const tracker = new ActivityTracker();
    let flushing = false;
    let disposed = false;
    const onInput = () => tracker.noteInput(monotonicNow());
    const tick = () =>
      tracker.tick({ wall: Date.now(), mono: monotonicNow() }, { foreground: foreground() });
    const flush = async () => {
      if (flushing || !tracker.hasPending()) return;
      flushing = true;
      const reports = tracker.drain();
      try {
        for (const [index, report] of reports.entries()) {
          try {
            await client.record(report);
          } catch {
            tracker.restore(reports.slice(index));
            break;
          }
        }
      } finally {
        flushing = false;
      }
      // The effect may have been cleaned up while this send was in flight (its own final flush
      // returned early): nothing will retry on this tracker, so hand the rest to the outbox.
      if (disposed) saveOutbox(machineId, tracker.drain());
    };
    // Minutes a previous run for this Host could not deliver.
    tracker.restore(takeOutbox(machineId));
    flush().catch(() => undefined);
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        tick();
        flush().catch(() => undefined);
      }
    };
    for (const name of INPUT_EVENTS) window.addEventListener(name, onInput, { passive: true });
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onHidden);
    const tickTimer = setInterval(tick, TICK_MS);
    const flushTimer = setInterval(() => flush().catch(() => undefined), FLUSH_MS);
    return () => {
      for (const name of INPUT_EVENTS) window.removeEventListener(name, onInput);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onHidden);
      clearInterval(tickTimer);
      clearInterval(flushTimer);
      disposed = true;
      tick();
      // A failed final send ends in the outbox (see `flush`); a send already in flight does the same.
      flush().catch(() => undefined);
    };
  }, [machineId]);
}
