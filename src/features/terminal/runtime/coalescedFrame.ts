export interface CoalescedFrame {
  /** Queues one run for the next animation frame; further calls before it fires are absorbed. */
  schedule: () => void;
  /** Drops the queued run without running it. */
  cancel: () => void;
}

/**
 * Collapses a burst of xterm render, scroll and resize events into one measurement per frame.
 * `run` reads the buffer and DOM when the frame fires, never from the event that queued it, so
 * the result always reflects the latest cursor instead of a stale one. It only presents state
 * and never writes terminal input.
 */
export function coalescedFrame(run: () => void): CoalescedFrame {
  let frame = 0;
  return {
    schedule() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        run();
      });
    },
    cancel() {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
