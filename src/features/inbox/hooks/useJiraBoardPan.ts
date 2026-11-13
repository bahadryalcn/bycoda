import { useRef, type PointerEvent, type MouseEvent } from "react";

type Pan = {
  pointer: number;
  x: number;
  y: number;
  horizontal: HTMLElement;
  vertical: HTMLElement;
  left: number;
  top: number;
};

/** Middle drag follows each axis's scroll owner, leaving primary drag and touch untouched. */
export function useJiraBoardPan() {
  const pan = useRef<Pan | null>(null);
  const stop = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointer !== event.pointerId) return;
    pan.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 1 || event.pointerType === "touch") return;
      event.preventDefault();
      const root = event.currentTarget;
      let horizontal: HTMLElement | undefined;
      let vertical: HTMLElement | undefined;
      for (let node = event.target as Element | null; node; node = node.parentElement) {
        if (node instanceof HTMLElement) {
          if (!horizontal && node.scrollWidth > node.clientWidth) horizontal = node;
          if (!vertical && node.scrollHeight > node.clientHeight) vertical = node;
        }
        if (node === root) break;
      }
      horizontal ??= root;
      vertical ??= root;
      pan.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        horizontal,
        vertical,
        left: horizontal.scrollLeft,
        top: vertical.scrollTop,
      };
      root.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const active = pan.current;
      if (!active || active.pointer !== event.pointerId) return;
      active.horizontal.scrollLeft = active.left - (event.clientX - active.x);
      active.vertical.scrollTop = active.top - (event.clientY - active.y);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: () => {
      pan.current = null;
    },
    onAuxClick: (event: MouseEvent<HTMLDivElement>) => {
      if (event.button === 1) event.preventDefault();
    },
  };
}
