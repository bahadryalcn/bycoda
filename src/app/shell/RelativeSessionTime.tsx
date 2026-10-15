import { useSyncExternalStore } from "react";
import { formatRelative } from "../../features/sessions/model/recentSessions";
import { useLocale } from "../../shared/i18n";

const listeners = new Set<() => void>();
let minute = Math.floor(Date.now() / 60_000) * 60_000;
let timer: ReturnType<typeof setInterval> | undefined;
const read = () => minute;
const inactive = () => 0;
const ignore = () => () => {};
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    minute = Math.floor(Date.now() / 60_000) * 60_000;
    timer = setInterval(() => {
      minute = Math.floor(Date.now() / 60_000) * 60_000;
      listeners.forEach((notify) => notify());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
export function useMinuteNow(enabled = true) {
  return useSyncExternalStore(enabled ? subscribe : ignore, enabled ? read : inactive, inactive);
}
export function RelativeSessionTime({ at }: { at: number }) {
  useLocale();
  const now = useMinuteNow();
  return <span>{formatRelative(at, now)}</span>;
}
