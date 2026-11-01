import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { suppressTextSelection } from "../lib/drag";
import type { SashEndInfo } from "../ui/Sash";

type Options = {
  axis?: "horizontal" | "vertical";
  min: number;
  direction?: "left" | "right";
  max: () => number;
  defaultWidth: number;
  initial: number;
  onCommit?: (width: number) => void;
};

function clampTo(value: number, min: number, max: number) {
  const upper = Math.max(0, max);
  return Math.min(upper, Math.max(Math.min(min, upper), Math.round(value)));
}

/**
 * Drag a pane's width by writing the DOM directly so React re-renders can't fight the cursor.
 *
 * Two ways to wire a handle, both with the same clamping, commit and keyboard steps (10 px,
 * Shift 50 px, Home/End, Enter and double-click reset):
 * - legacy: spread `separatorProps` and `onPointerDown`/`onDoubleClick` on your own element;
 * - shared `Sash` (preferred): `<Sash {...sashProps} label={t("Resize sidebar")} />`. The Sash
 *   owns the pointer capture, rAF throttling, Escape and blur cancel and `role="separator"`;
 *   `sashProps` maps its start/resize/end/reset callbacks and value/min/max onto this hook.
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
}: Options) {
  const minRef = useRef(min);
  minRef.current = min;
  const maxRef = useRef(max);
  maxRef.current = max;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const defaultRef = useRef(defaultWidth);
  defaultRef.current = defaultWidth;
  // A temporary viewport constraint must not overwrite the owner's pane size.
  const preferredWidthRef = useRef(initial);

  const clamp = useCallback((value: number) => {
    return clampTo(value, minRef.current, maxRef.current());
  }, []);

  const [width, setWidth] = useState(() => clamp(initial));
  const [dragging, setDragging] = useState(false);
  const paneRef = useRef<HTMLElement | null>(null);
  const widthRef = useRef(width);
  const stopDrag = useRef<(() => void) | null>(null);

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

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = axis === "vertical" ? event.clientY : event.clientX;
    const startW = widthRef.current;
    handle.setPointerCapture(pointerId);
    setDragging(true);
    const restoreSelection = suppressTextSelection();
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = axis === "vertical" ? "row-resize" : "col-resize";
    document.documentElement.classList.add("is-resizing");

    let cancelled = false;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      cancelled = true;
      stop();
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const coordinate = axis === "vertical" ? ev.clientY : ev.clientX;
      apply(clamp(startW + (coordinate - startX) * (direction === "left" ? -1 : 1)));
    };

    const stop = () => {
      if (stopDrag.current !== stop) return;
      stopDrag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
      restoreSelection();
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("is-resizing");
      setDragging(false);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      // Escape restores the width held when the drag began and commits nothing.
      if (cancelled) apply(startW);
      else commit(widthRef.current);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
    };

    stopDrag.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
  };

  // Shared `Sash` wiring: the Sash reports signed deltas; this hook owns the width.
  const sashStart = useRef<number | null>(null);
  const sign = direction === "left" ? -1 : 1;
  const onResizeStart = () => {
    sashStart.current = widthRef.current;
    setDragging(true);
    document.documentElement.classList.add("is-resizing");
  };
  const onResize = (delta: number) => {
    const base = sashStart.current ?? widthRef.current;
    apply(clamp(base + delta * sign));
  };
  const onResizeEnd = (_delta: number, info: SashEndInfo) => {
    const base = sashStart.current;
    sashStart.current = null;
    document.documentElement.classList.remove("is-resizing");
    setDragging(false);
    if (info.cancelled) {
      if (base !== null) apply(base);
      return;
    }
    commit(widthRef.current);
  };
  useEffect(
    () => () => {
      if (sashStart.current !== null) document.documentElement.classList.remove("is-resizing");
    },
    [],
  );

  useEffect(() => () => stopDrag.current?.(), []);

  const previousAxis = useRef(axis);
  useEffect(() => {
    if (previousAxis.current === axis) return;
    stopDrag.current?.();
    const pane = paneRef.current;
    if (pane) pane.style[axis === "vertical" ? "width" : "height"] = "";
    previousAxis.current = axis;
    commit(defaultRef.current);
  }, [axis]);

  useEffect(() => {
    const resize = () => {
      const next = clamp(stopDrag.current ? widthRef.current : preferredWidthRef.current);
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

  const [bounds, setBounds] = useState(() => ({
    min: Math.min(min, Math.max(0, max())),
    max: Math.max(0, max()),
  }));
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 50 : 10;
    let next: number;
    if (event.key === (axis === "vertical" ? "ArrowDown" : "ArrowRight"))
      next = widthRef.current + (direction === "left" ? -step : step);
    else if (event.key === (axis === "vertical" ? "ArrowUp" : "ArrowLeft"))
      next = widthRef.current + (direction === "left" ? step : -step);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = maxRef.current();
    else if (event.key === "Enter") next = defaultRef.current;
    else return;
    event.preventDefault();
    commit(next);
  };

  const onDoubleClick = () => {
    commit(defaultRef.current);
  };

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
    dragging,
    setPaneRef,
    onPointerDown,
    onDoubleClick,
    onKeyDown,
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
    separatorProps: {
      role: "separator" as const,
      tabIndex: 0,
      "aria-orientation": axis === "vertical" ? ("horizontal" as const) : ("vertical" as const),
      "aria-valuemin": bounds.min,
      "aria-valuemax": bounds.max,
      "aria-valuenow": width,
      onKeyDown,
    },
  };
}
