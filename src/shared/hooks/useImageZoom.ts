import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { isZoomWheel, wheelZoomFactor } from "../../features/files/ui/documentZoom";
import { claimTrackpadMagnify } from "../../platform/tauri/trackpadZoom";

export type ImageTransform = { scale: number; x: number; y: number };
const FIT: ImageTransform = { scale: 1, x: 0, y: 0 };
export function zoomImageAt(current: ImageTransform, factor: number, x: number, y: number): ImageTransform {
  const scale = Math.max(0.1, Math.min(16, current.scale * factor));
  const ratio = scale / current.scale;
  return { scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio };
}

/** Gestures are owned by the focused/hovered image viewport, never the document. */
export function useImageZoom(ref: RefObject<HTMLElement | null>, source: string, active = true) {
  const [value, setValue] = useState(FIT);
  const current = useRef(value);
  const drag = useRef<{ id: number; x: number; y: number; origin: ImageTransform; moved: boolean } | null>(null);
  const consumed = useRef(false);
  const update = useCallback((next: ImageTransform) => { current.current = next; setValue(next); }, []);
  const reset = useCallback(() => {
    if (drag.current && ref.current?.hasPointerCapture?.(drag.current.id)) ref.current.releasePointerCapture(drag.current.id);
    drag.current = null; update(FIT);
  }, [ref, update]);
  useEffect(reset, [source, reset]);
  const zoom = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const element = ref.current;
    const box = element?.getBoundingClientRect();
    if (!box) return;
    // CSS/application zoom can scale the viewport independently of the image.
    const unit = element?.offsetWidth ? box.width / element.offsetWidth : 1;
    update(zoomImageAt(current.current, factor,
      clientX === undefined ? 0 : (clientX - box.left - box.width / 2) / unit,
      clientY === undefined ? 0 : (clientY - box.top - box.height / 2) / unit));
  }, [ref, update]);
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    let gestureScale = 1;
    let releasePinch: (() => void) | undefined;
    let pointer: { x: number; y: number } | undefined;
    const claim = () => { if (!releasePinch) releasePinch = claimTrackpadMagnify(delta => zoom(1 + delta, pointer?.x, pointer?.y)); };
    const release = () => { releasePinch?.(); releasePinch = undefined; };
    const restoreClaim = () => { if (element.contains(document.activeElement) && element.getClientRects().length) claim(); };
    const visibility = () => { if (document.hidden) release(); else restoreClaim(); };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      if (!element.getClientRects().length) release();
    });
    observer?.observe(element);
    const move = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
    const wheel = (event: WheelEvent) => {
      if (!isZoomWheel(event)) {
        if (current.current.scale > 1) {
          event.preventDefault(); event.stopPropagation();
          update({ ...current.current, x: current.current.x - event.deltaX, y: current.current.y - event.deltaY });
        }
        return;
      }
      event.preventDefault(); event.stopPropagation();
      zoom(wheelZoomFactor(event), event.clientX, event.clientY);
    };
    const gesture = (event: Event) => {
      const pinch = event as Event & { scale: number; clientX?: number; clientY?: number };
      event.preventDefault(); event.stopPropagation();
      if (event.type === "gesturestart") gestureScale = 1;
      if (Number.isFinite(pinch.scale) && pinch.scale > 0) {
        zoom(pinch.scale / gestureScale, pinch.clientX, pinch.clientY);
        gestureScale = pinch.scale;
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]")) return;
      const handled = ["+", "=", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
      if (!handled || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "0") reset();
      else if (event.key === "+" || event.key === "=") zoom(1.5);
      else if (event.key === "-") zoom(1 / 1.5);
      else update({ ...current.current,
        x: current.current.x + (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0),
        y: current.current.y + (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0) });
    };
    const cancel = () => {
      if (drag.current && element.hasPointerCapture?.(drag.current.id)) element.releasePointerCapture(drag.current.id);
      drag.current = null;
      release();
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", gesture, { passive: false });
    element.addEventListener("gesturechange", gesture, { passive: false });
    element.addEventListener("keydown", key);
    element.addEventListener("pointerenter", claim);
    element.addEventListener("pointerleave", release);
    element.addEventListener("pointermove", move);
    element.addEventListener("focusin", claim);
    element.addEventListener("focusout", release);
    if (element.contains(document.activeElement)) claim();
    window.addEventListener("blur", cancel);
    window.addEventListener("focus", restoreClaim);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancel();
      observer?.disconnect();
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", gesture);
      element.removeEventListener("gesturechange", gesture);
      element.removeEventListener("keydown", key);
      element.removeEventListener("pointerenter", claim);
      element.removeEventListener("pointerleave", release);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("focusin", claim);
      element.removeEventListener("focusout", release);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("focus", restoreClaim);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [ref, active, zoom, reset, update]);
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!active || event.button !== 0 || current.current.scale <= 1) return;
    event.currentTarget.focus({ preventScroll: true });
    consumed.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: current.current, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) { onPointerUp(event); return; }
    const x = event.clientX - start.x, y = event.clientY - start.y;
    start.moved ||= Math.hypot(x, y) > 3;
    if (!start.moved) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    consumed.current = start.moved;
    const unit = event.currentTarget.offsetWidth ? event.currentTarget.getBoundingClientRect().width / event.currentTarget.offsetWidth : 1;
    update({ ...start.origin, x: start.origin.x + x / unit, y: start.origin.y + y / unit });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  return { value, zoom, reset, update,
    consumeClick: () => { const result = consumed.current; consumed.current = false; return result; },
    bindings: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
      onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault(); event.stopPropagation();
        if (current.current.scale > 1) reset(); else zoom(2, event.clientX, event.clientY);
      } },
    style: { transform: `translate3d(${value.x}px, ${value.y}px, 0) scale(${value.scale})`, transformOrigin: "center", cursor: value.scale > 1 ? "grab" : "zoom-in" } satisfies CSSProperties,
  };
}
