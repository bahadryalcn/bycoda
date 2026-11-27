/** A pointer position as a fraction of the preview, 0 to 1 on both axes. */
export interface TouchPoint {
  x: number;
  y: number;
}
export type TouchPhase = "down" | "move" | "up" | "cancel";

export interface TouchSession {
  /** Latest position; only the newest one is sent while another request is in flight. */
  move(point: TouchPoint): void;
  /** Finishes the gesture. The first call wins; later calls and moves are ignored. */
  end(phase: "up" | "cancel", point?: TouchPoint): void;
  /** True once the gesture ended or failed, so nothing more can be added. */
  readonly closed: boolean;
  /** Settles after the last request, never rejects. True when the Host accepted down and up. */
  readonly done: Promise<boolean>;
}

export interface TouchSessionOptions {
  start: TouchPoint;
  /** Earlier queued input; this gesture starts after it settles. */
  after: Promise<unknown>;
  /** Checked just before `down`. False sends nothing for this gesture. */
  gate: () => boolean | Promise<boolean>;
  send: (phase: TouchPhase, point: TouchPoint) => Promise<void>;
  /** Called once for the first rejected request, with the phase that failed. */
  onFailure: (cause: unknown, phase: TouchPhase) => void;
}

/**
 * One live touch: `down` at once, at most one `move` in flight with newer ones merged, then an
 * ordered `up` or `cancel`. After a rejected request the Host may still hold the touch, so one
 * best-effort `cancel` follows and the gesture is never replayed another way.
 */
export function createTouchSession(options: TouchSessionOptions): TouchSession {
  let last = options.start;
  let latest: TouchPoint | undefined;
  const state: { ending?: { phase: "up" | "cancel"; point: TouchPoint } } = {};
  let failed = false;
  let wake: (() => void) | undefined;
  const signal = () => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };
  const endingPhase = () => state.ending?.phase;
  const run = async (): Promise<boolean> => {
    await options.after.catch(() => {});
    // A cancel before `down` leaves the Host untouched.
    if (endingPhase() === "cancel" || !(await options.gate()) || endingPhase() === "cancel")
      return false;
    const request = async (phase: TouchPhase, point: TouchPoint) => {
      try {
        await options.send(phase, point);
        return true;
      } catch (cause) {
        failed = true;
        options.onFailure(cause, phase);
        await options.send("cancel", point).catch(() => {});
        return false;
      }
    };
    if (!(await request("down", options.start))) return false;
    for (;;) {
      const pending = state.ending;
      if (pending) {
        const { phase, point } = pending;
        if (phase === "cancel") {
          await options.send("cancel", point).catch(() => {});
          return false;
        }
        return request("up", point);
      }
      if (latest) {
        const point = latest;
        latest = undefined;
        if (!(await request("move", point))) return false;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  };
  const done = run().finally(() => {
    failed = true;
    wake = undefined;
  });
  return {
    move(point) {
      if (state.ending || failed) return;
      last = point;
      latest = point;
      signal();
    },
    end(phase, point) {
      if (state.ending || failed) return;
      state.ending = { phase, point: point ?? last };
      signal();
    },
    get closed() {
      return !!state.ending || failed;
    },
    done,
  };
}
