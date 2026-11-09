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

const READING_FALLBACK_MS = 120;
const READING_EASING = "ease-out";
const READING_BOX = "[data-composer-box]";

/** Frames for the writing box when reading mode toggles: a short settle in place. */
export const READING_SETTLE_FRAMES: Keyframe[] = [
  { opacity: 0.6, transform: "translateY(0.25rem)" },
  { opacity: 1, transform: "translateY(0)" },
];

function motionMs(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  if (raw.endsWith("ms")) return value;
  return raw.endsWith("s") ? value * 1000 : fallback;
}

function reanchorPopovers(element: HTMLElement) {
  element.dispatchEvent(new Event("scroll"));
}

/**
 * When reading mode toggles, the composer's new size applies at once and the
 * writing box settles with a short fade and lift. Only opacity and transform
 * animate: easing the height re-laid out the whole transcript on every frame,
 * which stuttered. Reduced motion, or a menu already open (it stays aligned with
 * its trigger), changes the layout without any motion.
 */
export function useComposerReadingMotion(
  dockRef: RefObject<HTMLElement | null>,
  docked: boolean,
  reading: boolean,
) {
  const previous = useRef(reading);

  useLayoutEffect(() => {
    if (previous.current === reading) return;
    previous.current = reading;
    const element = dockRef.current;
    if (!docked || !element) return;
    // Anchored popovers re-read their trigger on scroll; the swap moves it.
    reanchorPopovers(element);
    if (reducedMotion() || document.querySelector("[data-popover-side]")) return;
    const box = element.querySelector<HTMLElement>(READING_BOX);
    if (!box) return;
    const animation = box.animate(READING_SETTLE_FRAMES, {
      duration: motionMs("--motion-duration-fast", READING_FALLBACK_MS),
      easing: READING_EASING,
    });
    return () => animation.cancel();
  }, [dockRef, docked, reading]);
}
