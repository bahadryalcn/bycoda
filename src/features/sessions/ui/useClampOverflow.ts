import { useLayoutEffect, useState, type RefObject } from "react";
import { observeResize } from "../../../shared/lib/observeResize";

/**
 * Whether a line-clamped element has more text than it shows, so a "Show more"
 * control only appears when it would reveal something. Measured before paint and
 * again whenever the element resizes. While `expanded` the clamp is off and the
 * last measurement stands, so the collapse control stays available.
 *
 * `enabled` is false when there is nothing to clamp; the result is then false
 * without a measurement. A clamped element keeps its height when its text
 * changes, so `content` re-runs the measurement, and `layoutKey` does the same
 * for inputs that change the layout without resizing it (visibility, preview).
 */
export function useClampOverflow(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  expanded: boolean,
  content?: string,
  layoutKey?: number,
): boolean {
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const measure = () => {
      if (!expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    return observeResize(el, measure);
  }, [ref, enabled, expanded, content, layoutKey]);
  return enabled && overflows;
}
