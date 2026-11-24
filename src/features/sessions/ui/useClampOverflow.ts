import { useLayoutEffect, useRef, useState, type RefObject } from "react";
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
  const measured = useRef<{ element: HTMLElement; content?: string; layoutKey?: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled || expanded) {
      measured.current = null;
      return;
    }
    const measure = () => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    // React reconnects layout effects when a warm tab becomes visible. Keep its last
    // result until the observer's first delivery checks the new layout.
    const last = measured.current;
    if (
      last?.element !== el ||
      last.content !== content ||
      last.layoutKey !== layoutKey ||
      typeof ResizeObserver === "undefined"
    ) {
      measure();
      measured.current = { element: el, content, layoutKey };
    }
    return observeResize(el, measure);
  }, [ref, enabled, expanded, content, layoutKey]);
  return enabled && overflows;
}
