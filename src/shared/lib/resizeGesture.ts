/**
 * A live resize: a `Sash` drag or the OS window being resized. Pane sizes change every frame
 * while one is live, so work that is expensive per size change (PTY resize, transcript
 * re-measure, canvas redraw) should wait for the end instead of running sixty times a second.
 *
 * `beginResizeGesture` marks one, `resizeGestureActive` asks, `onResizeGestureEnd` and
 * `deferDuringResize` run work once it is over. Window resizes are tracked here; nothing else
 * needs to report them.
 */
import { LAYER } from "./layers";

/** A window resize counts as over once no `resize` event arrived for this long. */
const WINDOW_SETTLE_MS = 140;

let holds = 0;
const listeners = new Set<() => void>();

export function resizeGestureActive(): boolean {
  return holds > 0;
}

/** Runs `listener` every time the last live resize ends. Returns the unsubscribe. */
export function onResizeGestureEnd(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function release() {
  holds -= 1;
  if (holds > 0) return;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (error) {
      // One failing consumer must not leave the others at their mid-drag size.
      console.error("[resize] settle listener failed", error);
    }
  }
}

/**
 * Marks a resize as live until the returned function is called (calling it twice is safe).
 * With `cursor`, a transparent full-window shield shows that cursor for the whole drag: one
 * element, instead of an inherited cursor on `<html>` that restyles the whole document.
 */
export function beginResizeGesture(cursor?: "col-resize" | "row-resize"): () => void {
  holds += 1;
  let shield: HTMLElement | null = null;
  if (cursor && typeof document !== "undefined") {
    shield = document.createElement("div");
    shield.dataset.resizeShield = "";
    shield.setAttribute("aria-hidden", "true");
    shield.style.cssText = `position:fixed;inset:0;z-index:${LAYER.drag};cursor:${cursor};`;
    document.body.append(shield);
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    shield?.remove();
    release();
  };
}

export type DeferredResizeWork = {
  /** Run now, or once when the live resize ends (repeated calls collapse into one run). */
  (): void;
  /** Drop a pending run, e.g. on unmount. */
  cancel(): void;
};

/** Wraps size-driven work so a live resize runs it once at the end instead of every frame. */
export function deferDuringResize(run: () => void): DeferredResizeWork {
  let unsubscribe: (() => void) | null = null;
  const cancel = () => {
    unsubscribe?.();
    unsubscribe = null;
  };
  const schedule = () => {
    if (!resizeGestureActive()) {
      run();
      return;
    }
    if (unsubscribe) return;
    unsubscribe = onResizeGestureEnd(() => {
      cancel();
      run();
    });
  };
  return Object.assign(schedule, { cancel });
}

if (typeof window !== "undefined") {
  let endWindowResize: (() => void) | null = null;
  let settle: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    endWindowResize ??= beginResizeGesture();
    clearTimeout(settle);
    settle = setTimeout(() => {
      endWindowResize?.();
      endWindowResize = null;
    }, WINDOW_SETTLE_MS);
  });
}
