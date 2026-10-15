import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { suppressTextSelection } from "../lib/drag";

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

/** Drag a pane's width by writing the DOM directly so React re-renders can't fight the cursor. */
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
      restoreSelection();
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("is-resizing");
      setDragging(false);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      commit(widthRef.current);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
    };

    stopDrag.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

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
      const next = clamp(widthRef.current);
      if (next !== widthRef.current) commit(next);
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

  return {
    width,
    dragging,
    setPaneRef,
    onPointerDown,
    onDoubleClick,
    onKeyDown,
    min: bounds.min,
    max: bounds.max,
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
