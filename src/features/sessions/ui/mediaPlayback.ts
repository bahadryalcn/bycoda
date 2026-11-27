/** The one media element that is playing in the transcript; starting another pauses it. */
let active: HTMLMediaElement | null = null;

/** Call when `element` starts playing: any other playing element is paused. */
export function claimPlayback(element: HTMLMediaElement): void {
  if (active && active !== element && !active.paused) active.pause();
  active = element;
}

/** Call when `element` is paused, ended or removed so a stale reference is dropped. */
export function releasePlayback(element: HTMLMediaElement): void {
  if (active === element) active = null;
}

export function resetPlaybackForTests(): void {
  active = null;
}

/**
 * The value a key moves a scrub control to, or undefined when the key is not a seek key.
 * Arrows move one `step`, PageUp/PageDown ten, Home and End jump to the ends.
 */
export function scrubKeyValue(
  key: string,
  value: number,
  max: number,
  step: number,
): number | undefined {
  const clamp = (next: number) => Math.min(max, Math.max(0, next));
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clamp(value + step);
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(value - step);
    case "PageUp":
      return clamp(value + step * 10);
    case "PageDown":
      return clamp(value - step * 10);
    case "Home":
      return 0;
    case "End":
      return max;
    default:
      return undefined;
  }
}

/**
 * Playback position as `m:ss` (or `h:mm:ss`). Digits and colons only, the same in every
 * language, so it does not go through the locale formatters.
 */
export function playbackText(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
