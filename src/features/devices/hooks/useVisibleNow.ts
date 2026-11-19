import { useEffect, useState } from "react";

/**
 * Wall-clock time refreshed every `intervalMs` while `active`. The timer stops while the document
 * is hidden and refreshes once when it becomes visible again. Only the component that calls this
 * re-renders on a tick, so call it from a small display leaf, never from a large panel.
 */
export function useVisibleNow(active: boolean, intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  // Subscribes to the interval timer and page visibility, both outside React state; torn down on deactivation.
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, intervalMs]);
  return now;
}
