import { useSyncExternalStore } from "react";
import { formatDuration } from "../../../../shared/i18n/format";
import { Text } from "../../../../shared/ui/Text";
import { activeElapsedMs } from "../../model/crewActiveView";

/**
 * One shared once-a-second clock for the Active rows' elapsed labels. Only the label leaf
 * subscribes, so a tick re-renders that text and nothing else (not the grouped list). The
 * timer runs only while a labelled row is mounted and the window is visible; a hidden window
 * stops it, and the first visible moment catches the clock up in one notification.
 */
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const noSubscription = () => () => {};
const readNow = () => now;

function tick() {
  now = Date.now();
  listeners.forEach((notify) => notify());
}
function start() {
  timer ??= setInterval(tick, 1000);
}
function stop() {
  clearInterval(timer);
  timer = undefined;
}
function sync() {
  if (document.hidden) {
    stop();
  } else if (listeners.size) {
    tick();
    start();
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", sync);
    if (!document.hidden) {
      now = Date.now();
      start();
    }
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      document.removeEventListener("visibilitychange", sync);
      stop();
    }
  };
}

/** A row's running duration. Renders nothing and subscribes to no timer without a start time. */
export function ActiveElapsed({ startedAt }: { startedAt: number | undefined }) {
  const at = useSyncExternalStore(
    startedAt === undefined ? noSubscription : subscribe,
    readNow,
    readNow,
  );
  const elapsed = activeElapsedMs(startedAt, at);
  if (elapsed === null) return null;
  return (
    <Text tone="inherit" className="shrink-0 tabular-nums">
      {formatDuration(elapsed)}
    </Text>
  );
}
