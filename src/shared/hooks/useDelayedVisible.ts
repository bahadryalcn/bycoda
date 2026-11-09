import { useEffect, useRef, useState } from "react";
import { elapsedSince, monotonicNow } from "../lib/time/timestamps";

/** A passive loader stays hidden this long, so a load that finishes sooner never shows one. */
export const LOADING_DELAY_MS = 500;
/** Once a passive loader is shown it stays at least this long, so it never blinks. */
export const LOADING_MIN_VISIBLE_MS = 300;

export type DelayedVisibleOptions = { delay?: number; minVisible?: number };

/**
 * Turns "work is running" into "show the loader": false for the first `delay` ms of `active`,
 * then true until the work ends and the loader has been visible for `minVisible` ms. Use it for
 * passive loading (entry, switch, background refresh); a control's own pending state after a
 * click responds at once and does not use it.
 */
export function useDelayedVisible(
  active: boolean,
  { delay = LOADING_DELAY_MS, minVisible = LOADING_MIN_VISIBLE_MS }: DelayedVisibleOptions = {},
): boolean {
  const [shown, setShown] = useState(active && delay <= 0);
  const shownAt = useRef<number | null>(shown ? monotonicNow() : null);
  useEffect(() => {
    if (active) {
      if (shown) return;
      const timer = setTimeout(() => {
        shownAt.current = monotonicNow();
        setShown(true);
      }, delay);
      return () => clearTimeout(timer);
    }
    if (!shown) return;
    const remaining = Math.max(
      0,
      minVisible - (shownAt.current === null ? minVisible : elapsedSince(shownAt.current)),
    );
    const timer = setTimeout(() => {
      shownAt.current = null;
      setShown(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, [active, shown, delay, minVisible]);
  return shown;
}
