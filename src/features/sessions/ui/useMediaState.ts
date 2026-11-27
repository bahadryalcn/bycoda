import { useEffect, useState, type RefObject } from "react";
import { claimPlayback, releasePlayback } from "./mediaPlayback";

export type MediaState = {
  playing: boolean;
  duration: number;
  /** Whole seconds, so the time text re-renders once a second, not per frame. */
  second: number;
  muted: boolean;
  volume: number;
};

const INITIAL: MediaState = { playing: false, duration: 0, second: 0, muted: false, volume: 1 };

/**
 * Mirrors a media element's state and claims the single playback slot while it plays. While
 * playing, a frame loop writes progress to `progress`'s `--p` property directly, so the
 * waveform or bar moves without a React render per frame.
 */
export function useMediaState(
  element: HTMLMediaElement | null,
  progress: RefObject<HTMLElement | null>,
): MediaState {
  const [state, setState] = useState(INITIAL);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- subscribes to the media element's events and runs the progress frame loop while it plays.
  useEffect(() => {
    // Subscribes to the element's media events for its lifetime and runs the progress
    // frame loop only while it plays; the cleanup stops both and releases the slot.
    if (!element) return;
    let frame = 0;
    const paint = () => {
      const { currentTime, duration } = element;
      const fraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;
      progress.current?.style.setProperty("--p", String(fraction));
    };
    const sync = () => {
      const duration = Number.isFinite(element.duration) ? element.duration : 0;
      const next: MediaState = {
        playing: !element.paused && !element.ended,
        duration,
        second: Math.floor(element.currentTime),
        muted: element.muted,
        volume: element.volume,
      };
      setState((prev) =>
        prev.playing === next.playing &&
        prev.duration === next.duration &&
        prev.second === next.second &&
        prev.muted === next.muted &&
        prev.volume === next.volume
          ? prev
          : next,
      );
      paint();
    };
    const loop = () => {
      sync();
      frame = element.paused ? 0 : requestAnimationFrame(loop);
    };
    const onPlay = () => {
      claimPlayback(element);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
      sync();
    };
    const onStop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      sync();
    };
    const events = ["loadedmetadata", "durationchange", "timeupdate", "seeked", "volumechange"];
    for (const name of events) element.addEventListener(name, sync);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onStop);
    element.addEventListener("ended", onStop);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      for (const name of events) element.removeEventListener(name, sync);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onStop);
      element.removeEventListener("ended", onStop);
      releasePlayback(element);
    };
  }, [element, progress]);
  return state;
}

export function togglePlayback(element: HTMLMediaElement | null): void {
  if (!element) return;
  if (element.paused || element.ended) void element.play().catch(() => undefined);
  else element.pause();
}

export function seekMedia(element: HTMLMediaElement | null, seconds: number): void {
  if (element) element.currentTime = seconds;
}

/** Playback speed, kept as the default too so a reload of the same source keeps it. */
export function setPlaybackSpeed(element: HTMLMediaElement | null, rate: number): void {
  if (!element) return;
  element.playbackRate = rate;
  element.defaultPlaybackRate = rate;
}

export function toggleMuted(element: HTMLMediaElement | null): void {
  if (element) element.muted = !element.muted;
}

/** Volume 0 reads as muted, so the mute button and the bar agree. */
export function setMediaVolume(element: HTMLMediaElement | null, volume: number): void {
  if (!element) return;
  element.volume = volume;
  element.muted = volume === 0;
}
