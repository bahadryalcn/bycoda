import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

/** Focus that moves between the composer and its menus is not a departure. */
export const ENGAGEMENT_LEAVE_DELAY_MS = 60;
/**
 * Focus parked in an overlay or another window can return to the page without
 * the composer receiving an event (the overlay unmounts, focus falls to the
 * body). The departure is checked again at this interval until it resolves.
 */
export const ENGAGEMENT_RECHECK_MS = 250;

/**
 * Surfaces a composer opens into other parts of the document: menus, pickers,
 * suggestion lists and dialogs. Focus inside one of them still belongs to the
 * composer that was in use when it opened.
 */
const OVERLAY_SELECTOR =
  "[data-popover-side], [data-popover-flow], [role='menu'], [role='listbox'], [role='dialog']";

export function isOverlayElement(element: Element | null): boolean {
  return !!element?.closest?.(OVERLAY_SELECTOR);
}

export type EngagementHost = {
  /** Focus is inside the composer, or inside an overlay it can have opened. */
  holdsFocus(): boolean;
  /** Focus is inside the composer itself (not one of the overlays). */
  focusInComposer?(): boolean;
  /** False while another window (a native popup, another app) has focus. */
  windowFocused(): boolean;
  timers: {
    set(callback: () => void, delay: number): unknown;
    clear(handle: unknown): void;
  };
};

/**
 * Tracks whether the writer is using the composer. Engaged means: focus is in
 * it, or the pointer has pressed something in it. Leaving needs focus to be
 * elsewhere for a moment, never while a pointer press or IME composition is in
 * progress, and never while another window holds focus.
 *
 * Pointer focus is applied only when the press completes (at the click, before
 * its handlers run, or on release). Changing the layout between press and
 * release would move the pressed control away from under the pointer.
 */
export function createEngagement(
  host: EngagementHost,
  onChange: (engaged: boolean, sync: boolean) => void,
) {
  let engaged = false;
  let pressed = false;
  let composing = false;
  let pendingPress = false;
  let leaveBlocked = false;
  let dragDepth = 0;
  let leaveTimer: unknown;
  let releaseTimer: unknown;

  const set = (next: boolean, sync = false) => {
    if (engaged === next) return;
    engaged = next;
    onChange(next, sync);
  };
  const cancelLeave = () => {
    if (leaveTimer !== undefined) host.timers.clear(leaveTimer);
    leaveTimer = undefined;
    leaveBlocked = false;
  };
  const check = () => {
    leaveTimer = undefined;
    if (!engaged) return;
    if (pressed || composing || dragDepth > 0) {
      leaveBlocked = pressed || composing;
      return;
    }
    if (host.holdsFocus() || !host.windowFocused()) {
      if (!host.focusInComposer?.()) leaveTimer = host.timers.set(check, ENGAGEMENT_RECHECK_MS);
      return;
    }
    set(false);
  };
  const scheduleLeave = () => {
    if (!engaged) return;
    if (leaveTimer !== undefined) host.timers.clear(leaveTimer);
    leaveTimer = host.timers.set(check, ENGAGEMENT_LEAVE_DELAY_MS);
  };
  const resumeLeave = () => {
    if (!leaveBlocked) return;
    leaveBlocked = false;
    scheduleLeave();
  };

  return {
    get engaged() {
      return engaged;
    },
    focusIn() {
      cancelLeave();
      if (pressed) pendingPress = true;
      else set(true);
    },
    /** `inside`: focus moved to another element of the composer itself. */
    focusOut(inside: boolean) {
      if (!inside) scheduleLeave();
    },
    pointerDown() {
      pressed = true;
      cancelLeave();
    },
    pointerUp() {
      pressed = false;
      // The click follows the release in the same task; the timer only applies
      // a press that never became one (released elsewhere, no click).
      if (releaseTimer !== undefined) host.timers.clear(releaseTimer);
      releaseTimer = host.timers.set(() => {
        releaseTimer = undefined;
        if (pendingPress) set(true);
        pendingPress = false;
        resumeLeave();
      }, 0);
    },
    /** Capture phase of a click inside the composer, before its handlers run. */
    click() {
      pendingPress = false;
      cancelLeave();
      set(true, true);
    },
    /** A drag entered the composer: show the full drop target while it lasts. */
    dragEnter() {
      dragDepth += 1;
      cancelLeave();
      set(true);
    },
    /** Enter/leave pairs per element; the drag has left when they balance. */
    dragLeave() {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) scheduleLeave();
    },
    /** Dropped: leave like a focus departure (focus inside keeps it engaged). */
    drop() {
      dragDepth = 0;
      scheduleLeave();
    },
    compositionStart() {
      composing = true;
    },
    compositionEnd() {
      composing = false;
      resumeLeave();
    },
    dispose() {
      if (leaveTimer !== undefined) host.timers.clear(leaveTimer);
      if (releaseTimer !== undefined) host.timers.clear(releaseTimer);
    },
  };
}

/**
 * Engagement of the composer mounted inside `dockRef`. The returned handlers go
 * on that element: React delivers focus, pointer, click and composition events
 * from portalled descendants (menus, pickers) to it as well, so the whole
 * interaction area counts without a second listener per popup.
 */
export function useComposerEngagement(dockRef: RefObject<HTMLElement | null>) {
  const [engaged, setEngaged] = useState(false);
  const [controller] = useState(() =>
    createEngagement(
      {
        focusInComposer() {
          const active = document.activeElement;
          return !!active && !!dockRef.current?.contains(active);
        },
        holdsFocus() {
          const active = document.activeElement;
          const dock = dockRef.current;
          return (
            !!active &&
            active !== document.body &&
            ((!!dock && dock.contains(active)) || isOverlayElement(active))
          );
        },
        windowFocused: () => document.hasFocus(),
        timers: {
          set: (callback, delay) => window.setTimeout(callback, delay),
          clear: (handle) => window.clearTimeout(handle as number),
        },
      },
      (next, sync) => {
        if (sync) flushSync(() => setEngaged(next));
        else setEngaged(next);
      },
    ),
  );
  const release = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      release.current?.();
      controller.dispose();
    },
    [controller],
  );

  return {
    engaged,
    handlers: {
      onFocusCapture: () => controller.focusIn(),
      onBlurCapture: (event: FocusEvent<HTMLElement>) => {
        const next = event.relatedTarget;
        controller.focusOut(
          next instanceof Node && !!dockRef.current && dockRef.current.contains(next),
        );
      },
      onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 && event.pointerType === "mouse") return;
        controller.pointerDown();
        release.current?.();
        const end = () => {
          release.current?.();
          controller.pointerUp();
        };
        window.addEventListener("pointerup", end, true);
        window.addEventListener("pointercancel", end, true);
        release.current = () => {
          window.removeEventListener("pointerup", end, true);
          window.removeEventListener("pointercancel", end, true);
          release.current = null;
        };
      },
      onClickCapture: () => controller.click(),
      onDragEnterCapture: () => controller.dragEnter(),
      onDragLeaveCapture: () => controller.dragLeave(),
      onDropCapture: () => controller.drop(),
      onCompositionStartCapture: () => controller.compositionStart(),
      onCompositionEndCapture: () => controller.compositionEnd(),
    },
  };
}
