import type { HarnessEvent } from "../../integrations/harness/core/types";
import {
  captureNativeOutputEvent,
  failNativeOutputEvents,
} from "../../integrations/harness/core/nativeOutputDelivery";

export type ScheduledFlush = { kind: "raf" | "timeout"; id: number };

export function cancelScheduledFlush(handle: ScheduledFlush | null) {
  if (!handle) return;
  if (handle.kind === "raf") cancelAnimationFrame(handle.id);
  else clearTimeout(handle.id);
}

/** Hidden output must keep advancing without driving the whole UI at 60–120Hz. */
export function scheduleHarnessFlush(run: () => void, foreground: boolean): ScheduledFlush {
  if (document.hidden || !foreground) {
    return { kind: "timeout", id: window.setTimeout(run, 100) };
  }
  return { kind: "raf", id: requestAnimationFrame(run) };
}

/**
 * Visible output is applied at most this often. Events are only coalesced into
 * the next flush, never dropped, so a 120/240 Hz display does not re-run the
 * transcript at display rate while deltas arrive. About 30 Hz.
 */
export const FOREGROUND_FLUSH_MS = 30;

/** Keep hidden streams on their own cadence even while a visible chat streams. */
export class HarnessEventQueue {
  private queued = new Map<string, HarnessEvent[]>();
  private foregroundFlush: ScheduledFlush | null = null;
  private backgroundFlush: ScheduledFlush | null = null;
  private lastForegroundRun = -Infinity;

  constructor(
    private readonly isForeground: (sessionId: string) => boolean,
    private readonly apply: (batches: ReadonlyMap<string, HarnessEvent[]>) => void,
  ) {}

  enqueue = (sessionId: string, event: HarnessEvent) => {
    captureNativeOutputEvent(sessionId, event);
    const events = this.queued.get(sessionId);
    if (events) events.push(event);
    else this.queued.set(sessionId, [event]);
    if (
      event.type === "approval.requested" ||
      event.type === "approval.resolved" ||
      event.type === "question.asked" ||
      event.type === "question.updated" ||
      event.type === "question.resolved"
    ) {
      // Deliver the preceding output too, preserving this session's ordering.
      this.flushMatching((id) => id === sessionId);
      return;
    }
    this.schedule(this.visible(sessionId));
  };

  /** Lifecycle boundaries still need every session's latest output. */
  flush = () => this.flushMatching(() => true);

  /** Tab activation catches up its visible panes without flushing hidden work. */
  flushForeground = () => this.flushMatching((id) => this.visible(id));

  cancelScheduled = () => {
    cancelScheduledFlush(this.foregroundFlush);
    cancelScheduledFlush(this.backgroundFlush);
    this.foregroundFlush = null;
    this.backgroundFlush = null;
  };

  private visible(sessionId: string) {
    return !document.hidden && this.isForeground(sessionId);
  }

  private flushMatching(matches: (sessionId: string) => boolean) {
    const batches = new Map<string, HarnessEvent[]>();
    for (const [id, events] of this.queued) {
      if (!matches(id)) continue;
      batches.set(id, events);
      this.queued.delete(id);
    }
    this.schedulePending();
    if (batches.size > 0) {
      try {
        this.apply(batches);
      } catch (error) {
        for (const events of batches.values())
          failNativeOutputEvents(events, "session-application-failed");
        throw error;
      }
    }
  }

  private schedulePending() {
    let foreground = false;
    let background = false;
    for (const id of this.queued.keys()) {
      if (this.visible(id)) foreground = true;
      else background = true;
      if (foreground && background) break;
    }
    if (!foreground) {
      cancelScheduledFlush(this.foregroundFlush);
      this.foregroundFlush = null;
    } else this.schedule(true);
    if (!background) {
      cancelScheduledFlush(this.backgroundFlush);
      this.backgroundFlush = null;
    } else this.schedule(false);
  }

  private schedule(foreground: boolean) {
    if (foreground) {
      if (this.foregroundFlush) return;
      const run = () => {
        this.foregroundFlush = null;
        this.flushForeground();
      };
      if (document.hidden) {
        this.foregroundFlush = scheduleHarnessFlush(run, true);
        return;
      }
      const handle: ScheduledFlush = { kind: "raf", id: 0 };
      const frame = (now: number) => {
        const since = now - this.lastForegroundRun;
        if (since >= 0 && since < FOREGROUND_FLUSH_MS) {
          handle.id = requestAnimationFrame(frame);
          return;
        }
        this.lastForegroundRun = now;
        run();
      };
      handle.id = requestAnimationFrame(frame);
      this.foregroundFlush = handle;
    } else if (!this.backgroundFlush) {
      this.backgroundFlush = scheduleHarnessFlush(() => {
        this.backgroundFlush = null;
        this.flushMatching((id) => !this.visible(id));
      }, false);
    }
  }
}
