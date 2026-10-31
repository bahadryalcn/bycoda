import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { resizeComposer } from "../model/composerResize";

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

const READING_FALLBACK_MS = 180;
/** Below this the change is not worth an animation (subpixel and rounding). */
const READING_MIN_DELTA_PX = 2;
const READING_FIELD = ".composer-field";
/** The workspace row; the attention exception keeps it visible, so it never moves. */
const READING_ROW = "[data-composer-secondary]:not([data-composer-attention])";
const ROW_SLIDE = "-0.25rem";

export type ReadingRowMetrics = { height: number; paddingStart: number; paddingEnd: number };

/** A duration or easing token from the shared motion theme (empty when unset). */
function motionToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function motionMs(name: string, fallback: number): number {
  const raw = motionToken(name);
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  if (raw.endsWith("ms")) return value;
  return raw.endsWith("s") ? value * 1000 : fallback;
}

/**
 * Frames for the field's height when the composer enters or leaves reading mode,
 * or null when nothing should animate. The field and the workspace row ease their
 * own layout space, so the box, its controls and the transcript viewport move
 * together instead of snapping, and nothing is clipped from the dock.
 */
export function readingMotionFrames(from: number, to: number): Keyframe[] | null {
  if (!(from > 0) || !(to > 0) || Math.abs(from - to) < READING_MIN_DELTA_PX) return null;
  return [{ height: `${from}px` }, { height: `${to}px` }];
}

/**
 * Frames for the workspace row. It collapses (or opens) in layout while its
 * content fades and slides slightly, so it is neither cut off nor left behind.
 * `full` is the row's open size; null when it was never measured.
 */
export function readingRowFrames(
  full: ReadingRowMetrics | null,
  collapsing: boolean,
): Keyframe[] | null {
  if (!full || !(full.height > 0)) return null;
  const open: Keyframe = {
    height: `${full.height}px`,
    paddingBlockStart: `${full.paddingStart}px`,
    paddingBlockEnd: `${full.paddingEnd}px`,
    opacity: 1,
    transform: "translateY(0)",
    // The resting reading state is hidden; keep it painted while it moves.
    visibility: "visible",
  };
  const closed: Keyframe = {
    height: "0px",
    paddingBlockStart: "0px",
    paddingBlockEnd: "0px",
    opacity: 0,
    transform: `translateY(${ROW_SLIDE})`,
    visibility: "visible",
  };
  return collapsing
    ? [
        { ...open, offset: 0 },
        { opacity: 0, offset: 0.4 },
        { ...closed, offset: 1 },
      ]
    : [
        { ...closed, offset: 0 },
        { opacity: 0, offset: 0.3 },
        { ...open, offset: 1 },
      ];
}

function reanchorPopovers(element: HTMLElement) {
  element.dispatchEvent(new Event("scroll"));
}

function measureRow(row: HTMLElement): ReadingRowMetrics {
  const style = getComputedStyle(row);
  return {
    height: row.offsetHeight,
    paddingStart: Number.parseFloat(style.paddingBlockStart) || 0,
    paddingEnd: Number.parseFloat(style.paddingBlockEnd) || 0,
  };
}

type Snapshot = { field: number; rowFull: ReadingRowMetrics | null };

/** `settled` is false while an animation overrides the row's own size. */
function capture(
  element: HTMLElement,
  rowFull: ReadingRowMetrics | null,
  settled: boolean,
): Snapshot {
  const field = element.querySelector<HTMLElement>(READING_FIELD);
  const row = element.querySelector<HTMLElement>(READING_ROW);
  return {
    field: field?.offsetHeight ?? 0,
    rowFull: row && settled && row.offsetHeight > 0 ? measureRow(row) : rowFull,
  };
}

/**
 * Eases the composer when reading mode toggles: the field's height and the
 * workspace row's height, opacity and offset animate in place. Previous sizes
 * come from a ResizeObserver so typing between toggles is accounted for. Reduced
 * motion, or a menu already open (it stays aligned with its trigger), changes the
 * layout without any transition.
 */
export function useComposerReadingMotion(
  dockRef: RefObject<HTMLElement | null>,
  docked: boolean,
  reading: boolean,
) {
  const snapshot = useRef<Snapshot>({ field: 0, rowFull: null });
  const running = useRef<{ end: () => void } | null>(null);
  const previous = useRef(reading);

  useLayoutEffect(() => {
    const element = dockRef.current;
    if (!docked || !element) return;
    snapshot.current = capture(element, snapshot.current.rowFull, true);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!running.current) snapshot.current = capture(element, snapshot.current.rowFull, true);
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
    // Toggling again mid-motion continues from the sizes currently on screen.
    const before = running.current
      ? capture(element, snapshot.current.rowFull, false)
      : snapshot.current;
    running.current?.end();
    snapshot.current = capture(element, before.rowFull, true);
    // A menu already open stays aligned with its trigger by not easing the swap.
    if (reducedMotion() || document.querySelector("[data-popover-side]")) return;

    const field = element.querySelector<HTMLElement>(READING_FIELD);
    const row = element.querySelector<HTMLElement>(READING_ROW);
    const timing = {
      duration: motionMs("--motion-reorder-duration", READING_FALLBACK_MS),
      easing: motionToken("--motion-ease-out") || EASING,
    };
    const animations: Animation[] = [];
    const fieldFrames = field ? readingMotionFrames(before.field, snapshot.current.field) : null;
    if (field && fieldFrames) {
      // The field's minimum height changes with the mode and would otherwise
      // clamp the first frames of a growing field.
      const frames = fieldFrames.map((frame) => ({ ...frame, minHeight: frame.height }));
      animations.push(field.animate(frames, timing));
    }
    const rowFrames = row ? readingRowFrames(snapshot.current.rowFull, reading) : null;
    if (row && rowFrames) {
      row.style.overflow = "clip";
      animations.push(row.animate(rowFrames, timing));
    }
    if (animations.length === 0) return;

    let open = animations.length;
    const handle = {
      end() {
        if (running.current !== handle) return;
        running.current = null;
        element.removeEventListener("input", handle.end, true);
        for (const animation of animations) animation.cancel();
        if (row) row.style.overflow = "";
        // A measurement taken under the animation's override is not trustworthy.
        if (field?.isConnected) resizeComposer(field);
        snapshot.current = capture(element, snapshot.current.rowFull, true);
        reanchorPopovers(element);
      },
    };
    running.current = handle;
    // Typing measures the field; do that against its real size, not the motion.
    element.addEventListener("input", handle.end, true);
    for (const animation of animations) {
      animation.addEventListener("finish", () => {
        open -= 1;
        if (open === 0) handle.end();
      });
    }
  }, [dockRef, docked, reading]);

  useLayoutEffect(
    () => () => {
      running.current?.end();
    },
    [],
  );
}
