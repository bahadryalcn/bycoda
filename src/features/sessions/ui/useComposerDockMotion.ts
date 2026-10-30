import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

// A submit only counts as the launch if the composer docks shortly after it.
const LAUNCH_WINDOW_MS = 1500;
const DURATION_MS = 480;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Slides the composer from the centered empty-session slot down to the dock
 * when the first message is sent, instead of letting it jump there.
 */
export function useComposerDockMotion(docked: boolean) {
  const centeredRef = useRef<HTMLDivElement>(null);
  const dockedRef = useRef<HTMLDivElement>(null);
  const launch = useRef<{ top: number; centerX: number; at: number } | null>(null);

  const captureLaunch = useCallback(() => {
    const rect = centeredRef.current?.getBoundingClientRect();
    launch.current = rect
      ? {
          top: rect.top,
          centerX: rect.left + rect.width / 2,
          at: performance.now(),
        }
      : null;
  }, []);

  useLayoutEffect(() => {
    if (!docked) return;
    const from = launch.current;
    launch.current = null;
    const element = dockedRef.current;
    if (!from || !element || reducedMotion()) return;
    if (performance.now() - from.at > LAUNCH_WINDOW_MS) return;
    const to = element.getBoundingClientRect();
    // Align centers so the composer drops straight down.
    const dx = from.centerX - (to.left + to.width / 2);
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const animation = element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
      { duration: DURATION_MS, easing: EASING },
    );
    return () => animation.cancel();
  }, [docked]);

  return { centeredRef, dockedRef, captureLaunch };
}

const READING_DURATION_MS = 180;
/** Below this the change is not worth an animation (subpixel and rounding). */
const READING_MIN_DELTA_PX = 2;

/**
 * Frames for the dock's height when the composer enters or leaves reading mode,
 * or null when nothing should animate. The content already sits in its final
 * layout; only the space it occupies eases, so the transcript viewport grows or
 * shrinks gradually instead of snapping, and the text never reflows mid-motion.
 */
export function readingMotionFrames(from: number, to: number): Keyframe[] | null {
  if (!(from > 0) || !(to > 0) || Math.abs(from - to) < READING_MIN_DELTA_PX) return null;
  return [{ height: `${from}px` }, { height: `${to}px` }];
}

function reanchorPopovers(element: HTMLElement) {
  element.dispatchEvent(new Event("scroll"));
}

/**
 * Eases the docked composer's occupied height when reading mode toggles. The
 * previous height comes from a ResizeObserver so typing between toggles is
 * accounted for. Reduced motion changes the layout without any transition.
 */
export function useComposerReadingMotion(
  dockRef: RefObject<HTMLElement | null>,
  docked: boolean,
  reading: boolean,
) {
  const lastHeight = useRef(0);
  const running = useRef<Animation | null>(null);
  const previous = useRef(reading);

  useLayoutEffect(() => {
    const element = dockRef.current;
    if (!docked || !element) return;
    lastHeight.current = element.offsetHeight;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!running.current) lastHeight.current = element.offsetHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [dockRef, docked]);

  useLayoutEffect(() => {
    if (previous.current === reading) return;
    previous.current = reading;
    const element = dockRef.current;
    if (!docked || !element) return;
    // Anchored popovers re-read their trigger on scroll; the swap moves it.
    reanchorPopovers(element);
    if (reducedMotion()) return;
    const frames = readingMotionFrames(lastHeight.current, element.offsetHeight);
    // A menu already open stays aligned with its trigger by not easing the swap.
    if (!frames || document.querySelector("[data-popover-side]")) return;
    running.current?.cancel();
    element.style.overflowY = "clip";
    const animation = element.animate(frames, { duration: READING_DURATION_MS, easing: EASING });
    running.current = animation;
    const settle = () => {
      if (running.current !== animation) return;
      running.current = null;
      element.style.overflowY = "";
      lastHeight.current = element.offsetHeight;
      reanchorPopovers(element);
    };
    animation.addEventListener("finish", settle);
    animation.addEventListener("cancel", settle);
  }, [dockRef, docked, reading]);

  useLayoutEffect(
    () => () => {
      running.current?.cancel();
    },
    [],
  );
}
