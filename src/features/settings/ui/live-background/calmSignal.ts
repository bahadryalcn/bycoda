import type { LiveSignal } from "./types";

export const CLOSED_SIGNAL: LiveSignal = { presence: 0 };

/** A bounded activity envelope, independent of provider chunk size and token rate.
 * It reaches rest before the canvas's two-second idle gate stops painting. */
export function createLiveSignalDriver() {
  let progress = 0;
  return {
    update(
      _time: number,
      delta: number,
      textLength: number,
      activityLength = textLength,
    ): LiveSignal {
      const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
      const busy = textLength >= 0 || activityLength >= 0;
      progress = Math.max(0, Math.min(1, progress + (busy ? dt / 1.4 : -dt / 1.6)));
      return { presence: progress * progress * (3 - 2 * progress) };
    },
  };
}
