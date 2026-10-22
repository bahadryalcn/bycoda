import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// One mouse-wheel notch (~100px) is about one 1.22x step; a trackpad pinch
// sends many small deltas and so zooms smoothly instead of in jumps.
const WHEEL_SENSITIVITY = 0.002;
const MAX_WHEEL_DELTA = 240;
const LINE_PIXELS = 16;
const PAGE_PIXELS = 400;

/** Zoom levels for the session, per viewer kind; a reopened file keeps its zoom. */
const remembered = new Map<string, number | "fit">();

export function recalledZoom(kind: string): number | "fit" | undefined {
  return remembered.get(kind);
}

export function rememberZoom(kind: string, zoom: number | "fit") {
  remembered.set(kind, zoom);
}

export function clampZoom(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A wheel with Ctrl or Cmd held. Trackpad pinch arrives the same way: WebKit
 * and WebView2 report it as a wheel event with `ctrlKey` set.
 */
export function isZoomWheel(event: { ctrlKey: boolean; metaKey: boolean }) {
  return event.ctrlKey || event.metaKey;
}

/** Multiplicative zoom step for one wheel event; scrolling up zooms in. */
export function wheelZoomFactor(event: { deltaY: number; deltaMode: number }): number {
  const unit = event.deltaMode === 1 ? LINE_PIXELS : event.deltaMode === 2 ? PAGE_PIXELS : 1;
  const delta = clampZoom(event.deltaY * unit, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA);
  return Math.exp(-delta * WHEEL_SENSITIVITY);
}

/**
 * The scroll offset that keeps the content point under `pointer` (measured from
 * the viewport edge) in place when everything is scaled by `ratio`.
 */
export function anchoredScroll(scroll: number, pointer: number, ratio: number): number {
  return (scroll + pointer) * ratio - pointer;
}

export function formatZoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/**
 * Calls `onZoom(factor, clientX, clientY)` for Ctrl/Cmd+wheel over `ref`, at
 * most once per animation frame with the factors of that frame multiplied
 * together. The listener is attached natively and non-passive: React's
 * `onWheel` is passive, so it could not stop the page or the webview zooming.
 * A plain wheel is left alone and scrolls as usual.
 */
export function useWheelZoom(
  ref: RefObject<HTMLElement | null>,
  onZoom: (factor: number, clientX: number, clientY: number) => void,
  active = true,
) {
  const latest = useRef(onZoom);
  useEffect(() => {
    latest.current = onZoom;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    let factor = 1;
    let x = 0;
    let y = 0;
    let frame = 0;
    const flush = () => {
      frame = 0;
      const pending = factor;
      factor = 1;
      if (pending !== 1) latest.current(pending, x, y);
    };
    const onWheel = (event: WheelEvent) => {
      if (!isZoomWheel(event)) return;
      event.preventDefault();
      // Keep the app-wide UI zoom and any outer handler out of it.
      event.stopPropagation();
      factor *= wheelZoomFactor(event);
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = window.requestAnimationFrame(flush);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, active]);
}

/**
 * A zoom factor for a scroll container, changed by Ctrl/Cmd+wheel and anchored
 * at the pointer. The caller applies `zoom` to its own layout; the scroll
 * correction runs in a layout effect so it lands before the new layout paints.
 */
export function useAnchoredZoom(
  ref: RefObject<HTMLElement | null>,
  kind: string,
  { min, max, active = true }: { min: number; max: number; active?: boolean },
) {
  const [zoom, setZoom] = useState(() => {
    const saved = recalledZoom(kind);
    return typeof saved === "number" ? clampZoom(saved, min, max) : 1;
  });
  const zoomRef = useRef(zoom);
  const anchor = useRef<{ ratio: number; x: number; y: number } | null>(null);

  const zoomTo = useCallback(
    (next: number, x: number, y: number) => {
      const prev = zoomRef.current;
      if (next === prev) return;
      // Two changes can land in one commit; their ratios compose.
      anchor.current = { ratio: (anchor.current?.ratio ?? 1) * (next / prev), x, y };
      zoomRef.current = next;
      rememberZoom(kind, next);
      setZoom(next);
    },
    [kind],
  );

  useWheelZoom(
    ref,
    (factor, clientX, clientY) => {
      const element = ref.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      zoomTo(
        clampZoom(zoomRef.current * factor, min, max),
        clientX - rect.left,
        clientY - rect.top,
      );
    },
    active,
  );

  useLayoutEffect(() => {
    const element = ref.current;
    const pending = anchor.current;
    anchor.current = null;
    if (!element || !pending) return;
    element.scrollLeft = anchoredScroll(element.scrollLeft, pending.x, pending.ratio);
    element.scrollTop = anchoredScroll(element.scrollTop, pending.y, pending.ratio);
  }, [zoom, ref]);

  /** Back to 100%, keeping the middle of the view where it is. */
  const reset = useCallback(() => {
    const element = ref.current;
    zoomTo(1, (element?.clientWidth ?? 0) / 2, (element?.clientHeight ?? 0) / 2);
  }, [ref, zoomTo]);

  return { zoom, reset };
}
