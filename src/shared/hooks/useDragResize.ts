import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { SashEndInfo } from "../ui/Sash";

type Options = {
  axis?: "horizontal" | "vertical";
  min: number;
  direction?: "left" | "right";
  max: () => number;
  defaultWidth: number;
  initial: number;
  onCommit?: (width: number) => void;
  /**
   * Pointer drags released with the unclamped width below `collapseBelow` call `onCollapse`
   * instead of committing; the pane keeps its pre-drag width. Keyboard resizing only clamps.
   */
  collapseBelow?: number;
  onCollapse?: () => void;
};

function clampTo(value: number, min: number, max: number) {
  const upper = Math.max(0, max);
  return Math.min(upper, Math.max(Math.min(min, upper), Math.round(value)));
}

/**
 * Drag a pane's width by writing the DOM directly so React re-renders can't fight the cursor.
 *
 * Wire the handle with the shared `Sash`: `<Sash {...sashProps} label={t("Resize sidebar")} />`.
 * The Sash owns the pointer capture, rAF throttling, Escape and blur cancel, arrow keys (10 px,
 * Shift 50 px), Enter and double-click reset and `role="separator"`; `sashProps` maps its
 * start/resize/end/reset callbacks and value/min/max onto this hook, which adds Home/End.
 * Nothing re-renders the owner while the drag is live; the committed width renders once.
 *
 * `getWidth()` reads the live pane width (also mid-drag), `setWidth(value)` clamps and commits
 * (`{ commit: false }` only moves the pane, for live previews).
 *
 * @example
 * const resize = useDragResize({ min: 180, max: () => 480, defaultWidth: 244, initial: width, onCommit: setWidth });
 * <aside ref={resize.setPaneRef}>�</aside>
 * <Sash {...resize.sashProps} label={t("Resize sidebar")} />
 */
export function useDragResize({
  axis = "horizontal",
  direction = "right",
  min,
  max,
  defaultWidth,
  initial,
  onCommit,
  collapseBelow,
  onCollapse,
}: Options) {
  const minRef = useRef(min);
  minRef.current = min;
  const maxRef = useRef(max);
  maxRef.current = max;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const collapseBelowRef = useRef(collapseBelow);
  collapseBelowRef.current = collapseBelow;
  const onCollapseRef = useRef(onCollapse);
  onCollapseRef.current = onCollapse;
  const defaultRef = useRef(defaultWidth);
  defaultRef.current = defaultWidth;
  // A temporary viewport constraint must not overwrite the owner's pane size.
  const preferredWidthRef = useRef(initial);

  const clamp = useCallback((value: number) => {
    return clampTo(value, minRef.current, maxRef.current());
  }, []);

  const [width, setWidth] = useState(() => clamp(initial));
  const [bounds, setBounds] = useState(() => ({
    min: Math.min(min, Math.max(0, max())),
    max: Math.max(0, max()),
  }));
  const paneRef = useRef<HTMLElement | null>(null);
  const widthRef = useRef(width);

  const apply = (next: number) => {
    widthRef.current = next;
    const pane = paneRef.current;
    if (pane) pane.style[axis === "vertical" ? "height" : "width"] = `${next}px`;
  };

  const setPaneRef = useCallback(
    (el: HTMLElement | null) => {
      paneRef.current = el;
      if (el) el.style[axis === "vertical" ? "height" : "width"] = `${widthRef.current}px`;
    },
    [axis],
  );

  const commit = (next: number) => {
    const value = clamp(next);
    preferredWidthRef.current = value;
    apply(value);
    setWidth(value);
    onCommitRef.current?.(value);
  };

  // Shared `Sash` wiring: the Sash reports signed deltas; this hook owns the width.
  const sashStart = useRef<number | null>(null);
  const sign = direction === "left" ? -1 : 1;
  const onResizeStart = () => {
    sashStart.current = widthRef.current;
  };
  const onResize = (delta: number) => {
    const base = sashStart.current ?? widthRef.current;
    apply(clamp(base + delta * sign));
  };
  const onResizeEnd = (delta: number, info: SashEndInfo) => {
    const base = sashStart.current;
    sashStart.current = null;
    if (info.cancelled) {
      if (base !== null) apply(base);
      return;
    }
    const threshold = collapseBelowRef.current;
    if (!info.keyboard && base !== null && threshold !== undefined && onCollapseRef.current) {
      if (base + delta * sign < threshold) {
        apply(base);
        onCollapseRef.current();
        return;
      }
    }
    commit(widthRef.current);
  };

  const previousAxis = useRef(axis);
  useEffect(() => {
    if (previousAxis.current === axis) return;
    const pane = paneRef.current;
    if (pane) pane.style[axis === "vertical" ? "width" : "height"] = "";
    previousAxis.current = axis;
    commit(defaultRef.current);
  }, [axis]);

  useEffect(() => {
    const resize = () => {
      // The pane's parent resizes with every drag frame. While a drag is live, keep its
      // width; snapping back to the saved width here made the pane flicker between the
      // old and new size until release.
      const dragging = sashStart.current !== null;
      const next = clamp(dragging ? widthRef.current : preferredWidthRef.current);
      if (next !== widthRef.current) {
        apply(next);
        setWidth(next);
      }
      const upper = Math.max(0, maxRef.current());
      setBounds((previous) =>
        previous.min === Math.min(minRef.current, upper) && previous.max === upper
          ? previous
          : { min: Math.min(minRef.current, upper), max: upper },
      );
    };
    const observer = new ResizeObserver(resize);
    if (paneRef.current?.parentElement) observer.observe(paneRef.current.parentElement);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [clamp, min, axis]);

  const reset = () => commit(defaultRef.current);
  const getWidth = () => widthRef.current;
  const setWidthTo = (value: number, options?: { commit?: boolean }) => {
    if (options?.commit === false) apply(clamp(value));
    else commit(value);
  };
  // Sash handles the arrows and Enter; Home and End (collapse / maximise) stay here.
  const onSashKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    commit(event.key === "Home" ? 0 : maxRef.current());
  };

  return {
    width,
    setPaneRef,
    min: bounds.min,
    max: bounds.max,
    getWidth,
    setWidth: setWidthTo,
    reset,
    /** Spread on `<Sash>` (add `label`). */
    sashProps: {
      orientation: axis === "vertical" ? ("horizontal" as const) : ("vertical" as const),
      value: width,
      min: bounds.min,
      max: bounds.max,
      step: 10,
      largeStep: 50,
      onResizeStart,
      onResize,
      onResizeEnd,
      onReset: reset,
      onKeyDown: onSashKeyDown,
    },
  };
}
