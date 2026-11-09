import { useEffect, useState } from "react";

/**
 * Whether content should stay mounted: while `open`, and for `delayMs` after
 * it closes so a closing transition can play before its subscriptions are
 * released. Reduced motion releases it immediately. `release` drops it early, for
 * example when the closing transition reports that it ended.
 */
export function useRetainedWhileClosing(open: boolean, delayMs: number) {
  const [retained, setRetained] = useState(open);
  // Opening retains the content at once, so the next close has something to keep.
  if (open && !retained) setRetained(true);
  useEffect(() => {
    if (open) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setRetained(false);
      return;
    }
    const timer = window.setTimeout(() => setRetained(false), delayMs);
    return () => window.clearTimeout(timer);
  }, [open, delayMs]);
  const release = () => setRetained(false);
  return [open || retained, release] as const;
}
