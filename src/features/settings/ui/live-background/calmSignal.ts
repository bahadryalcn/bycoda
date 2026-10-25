import type { LiveSignal } from "./types";

export const CLOSED_SIGNAL: LiveSignal = { presence: 0 };

/** A bounded activity envelope, independent of provider chunk size and token rate.
 * It reaches rest before the canvas's two-second idle gate stops painting. */
export function createLiveSignalDriver() {
  let progress = 0;
  let energy = 0;
  let previousText = -1;
  let previousActivity = -1;
  const increase = (current: number, previous: number) =>
    current < 0 || !Number.isFinite(current) ? 0 : Math.max(0, current - Math.max(0, previous));
  return {
    update(
      _time: number,
      delta: number,
      textLength: number,
      activityLength = textLength,
    ): LiveSignal {
      const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
      const busy = textLength >= 0 || activityLength >= 0;
      progress = Math.max(0, Math.min(1, progress + (busy ? dt / 0.45 : -dt / 1.2)));
      if (dt > 0) {
        const growth = Math.max(
          increase(textLength, previousText),
          increase(activityLength, previousActivity),
        );
        const target = growth > 0 ? Math.min(1, 0.2 + Math.log1p(growth) / 8) : 0;
        energy += (target - energy) * (1 - Math.exp(-dt / (target > energy ? 0.18 : 0.5)));
        previousText = textLength;
        previousActivity = activityLength;
      }
      if (energy < 0.001 || progress === 0) energy = 0;
      const presence = progress * progress * (3 - 2 * progress);
      return energy > 0 ? { presence, energy } : { presence };
    },
  };
}
