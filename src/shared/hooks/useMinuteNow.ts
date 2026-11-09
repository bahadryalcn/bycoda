import { useSyncExternalStore } from "react";

/**
 * Wall clock floored to the minute, shared by every subscriber through one 60 s
 * interval. Use it for labels that only need minute precision so their rows do
 * not re-render every second.
 */
const listeners = new Set<() => void>();
let minute = Math.floor(Date.now() / 60_000) * 60_000;
let timer: ReturnType<typeof setInterval> | undefined;
const read = () => minute;
const inactive = () => 0;
const ignore = () => () => {};
const floorMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
function tick() {
  minute = floorMinute();
  listeners.forEach((notify) => notify());
}
// A hidden window shows nothing time-relative, so its timer is stopped; the
// first visible moment catches the clock up in one notification.
function sync() {
  if (document.hidden) {
    clearInterval(timer);
    timer = undefined;
  } else if (!timer) {
    tick();
    timer = setInterval(tick, 60_000);
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    minute = floorMinute();
    document.addEventListener("visibilitychange", sync);
    if (!document.hidden) timer = setInterval(tick, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      document.removeEventListener("visibilitychange", sync);
      clearInterval(timer);
      timer = undefined;
    }
  };
}
export function useMinuteNow(enabled = true) {
  return useSyncExternalStore(enabled ? subscribe : ignore, enabled ? read : inactive, inactive);
}
