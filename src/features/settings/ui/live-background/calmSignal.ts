import type { LiveSignal } from "./types";

export const CLOSED_SIGNAL: LiveSignal = { presence: 0 };

/** Once a scene appears it stays this long (seconds), even through tool waits or after the
 * reply ends, so it never flickers with each chunk. Each appearance picks its own length. */
export const SHOW_SECONDS = [10, 15] as const;
/** After fading out, a scene rests this long before new output may bring it back. */
export const REST_SECONDS = [8, 16] as const;
const RISE_SECONDS = 0.45;
export const FADE_SECONDS = 1.2;
/** Output this recent counts as speaking: mouths move only while text keeps arriving. */
const VOICE_SECONDS = 0.8;

/** Deterministic 0..1 value per appearance, so show and rest lengths vary without Math.random. */
function spread(index: number, salt: number): number {
  let h = Math.imul(index + 0x9e3779b9, 374761393) ^ Math.imul(salt + 0x85ebca6b, 668265263);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const span = ([min, max]: readonly [number, number], index: number, salt: number) =>
  min + (max - min) * spread(index, salt);

const ease = (value: number, target: number, dt: number, up: number, down: number) => {
  const next = value + (target - value) * (1 - Math.exp(-dt / (target > value ? up : down)));
  return next < 0.001 ? 0 : next;
};

/**
 * A bounded activity envelope, independent of provider chunk size and token rate.
 *
 * Presence follows an appear/hold/rest rhythm: the first output of a turn brings the scene in,
 * it stays for SHOW_SECONDS, fades out, rests for REST_SECONDS and returns with the next output
 * of the same turn. A new turn may bring it back at once. `energy` follows new output and
 * `speaking` says whether output is arriving right now.
 *
 * `now` is a wall clock in seconds. The canvas stops painting between bursts, so the rhythm
 * needs real elapsed time; without it the driver counts the deltas it is given.
 */
export function createLiveSignalDriver() {
  let progress = 0;
  let energy = 0;
  let speaking = 0;
  let previousText = -1;
  let previousActivity = -1;
  let clock = 0;
  let showing = false;
  let showUntil = 0;
  let restUntil = -Infinity;
  let lastOutput = -Infinity;
  let appearances = 0;
  // A drop in length means a new turn; it counts as fresh output.
  const increase = (current: number, previous: number) =>
    current < 0 || !Number.isFinite(current)
      ? 0
      : current < previous
        ? Math.max(1, current)
        : current - Math.max(0, previous);
  return {
    update(
      _time: number,
      delta: number,
      textLength: number,
      activityLength = textLength,
      now?: number,
    ): LiveSignal {
      const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
      clock = now !== undefined && Number.isFinite(now) ? now : clock + dt;
      if (dt > 0) {
        const active = textLength >= 0 || activityLength >= 0;
        const started =
          active &&
          ((previousText < 0 && previousActivity < 0) ||
            (activityLength >= 0 && activityLength < previousActivity));
        // A new turn may appear at once instead of waiting out the previous turn's rest.
        if (started) restUntil = -Infinity;
        const growth = Math.max(
          increase(textLength, previousText),
          increase(activityLength, previousActivity),
        );
        if (growth > 0 || started) lastOutput = clock;
        if (showing && clock >= showUntil) {
          showing = false;
          restUntil = showUntil + FADE_SECONDS + span(REST_SECONDS, appearances, 2);
          appearances++;
        }
        if (!showing && active && (growth > 0 || started) && clock >= restUntil) {
          showing = true;
          showUntil = clock + span(SHOW_SECONDS, appearances, 1);
        }
        progress = Math.max(
          0,
          Math.min(1, progress + (showing ? dt / RISE_SECONDS : -dt / FADE_SECONDS)),
        );
        const target = growth > 0 ? Math.min(1, 0.2 + Math.log1p(growth) / 8) : 0;
        energy = ease(energy, target, dt, 0.18, 0.5);
        speaking = ease(
          speaking,
          active && clock - lastOutput < VOICE_SECONDS ? 1 : 0,
          dt,
          0.12,
          0.3,
        );
        previousText = textLength;
        previousActivity = activityLength;
      }
      if (progress === 0) {
        energy = 0;
        speaking = 0;
        return { presence: 0 };
      }
      const presence = progress * progress * (3 - 2 * progress);
      return energy > 0 ? { presence, energy, speaking } : { presence, speaking };
    },
    /** True while a scene is visible or fading: the canvas must keep painting. */
    awake(): boolean {
      return showing || progress > 0;
    },
  };
}
