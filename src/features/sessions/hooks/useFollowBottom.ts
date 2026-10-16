import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { nestedScrollAbsorbsWheel } from "../model/transcriptActivity";

type ScrollTarget = HTMLElement | null | RefObject<HTMLElement | null>;
const element = (target: ScrollTarget) => (target && "current" in target ? target.current : target);

/** Shared following lifecycle with explicit reader-interaction policies. */
export function useFollowBottom(
  target: ScrollTarget,
  enabled: boolean,
  content: unknown,
  threshold: number,
  directional = false,
  secondary?: unknown,
) {
  const following = useRef(true);
  const lastTop = useRef(0);
  const wasEnabled = useRef(false);
  useLayoutEffect(() => {
    if (!enabled) {
      wasEnabled.current = false;
      return;
    }
    if (!wasEnabled.current) {
      following.current = true;
      wasEnabled.current = true;
    }
    const el = element(target);
    if (el && following.current) {
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    }
  }, [target, enabled, content, secondary]);
  useEffect(() => {
    const el = element(target);
    if (!el || !enabled) return;
    const pin = () => {
      if (following.current) {
        el.scrollTop = el.scrollHeight;
        lastTop.current = el.scrollTop;
      }
    };
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
      if (!directional) following.current = near;
      else {
        const movement = el.scrollTop - lastTop.current;
        const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
        const clamped = lastTop.current > bottom && Math.abs(el.scrollTop - bottom) < 1;
        if (movement !== 0 && !clamped) following.current = movement > 0 && near;
      }
      lastTop.current = el.scrollTop;
    };
    const onWheel = (event: WheelEvent) => {
      if (!nestedScrollAbsorbsWheel(el, event.deltaY)) return;
      if (event.deltaY < 0) following.current = false;
      event.stopPropagation();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    if (directional) el.addEventListener("wheel", onWheel, { passive: true });
    const observer = new ResizeObserver(pin);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    if (directional) pin();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (directional) el.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, [target, enabled, threshold, directional]);
  return following;
}
