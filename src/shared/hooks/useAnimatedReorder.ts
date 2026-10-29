import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import { t } from "../i18n/technical";
import { announceDrag, setGrabbing, suppressTextSelection } from "../lib/drag";
import { reorderMotion } from "../lib/motion";
import { moveItem } from "../lib/reorder";

export type ReorderExternalDrop<T extends string> = {
  /** Return true while the pointer is over an external drop target. */
  onMove: (id: T, event: globalThis.PointerEvent) => boolean;
  /** Return true when the external target consumed the drop. */
  onDrop: (id: T, event: globalThis.PointerEvent) => boolean;
  onEnd?: (id: T) => void;
};

/** Allow WebKit's queued button-less moves to precede their pointerup. */
const LOST_POINTERUP_GRACE = 150;

/** What a screen reader says for an item: its accessible name, else its visible text. */
function itemLabel(node: HTMLElement | undefined) {
  const text = (node?.getAttribute("aria-label") ?? node?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 60 ? `${text.slice(0, 59)}…` : text || t("Item");
}

function describePosition(label: string, index: number, count: number, message: string) {
  return t(message, { p0: label, p1: index + 1, p2: count });
}

/**
 * Moving a focused item reorders the DOM, which drops focus. Give it back once the new order has
 * been committed, but only when focus was inside the item that moved.
 */
function restoreFocusAfterMove(item: HTMLElement | undefined) {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !item?.contains(focused)) return;
  window.requestAnimationFrame(() => {
    if (focused.isConnected && document.activeElement !== focused) focused.focus();
  });
}

/** Alt + the axis arrows move the focused item one place; this is the non-drag way to reorder. */
function keyboardMoveDelta(
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
  axis: "x" | "y",
): -1 | 1 | 0 {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  const rtl = axis === "x" && document.documentElement.dir === "rtl";
  const backward = axis === "x" ? (rtl ? "ArrowRight" : "ArrowLeft") : "ArrowUp";
  const forward = axis === "x" ? (rtl ? "ArrowLeft" : "ArrowRight") : "ArrowDown";
  return event.key === backward ? -1 : event.key === forward ? 1 : 0;
}

/**
 * Direct manipulation for a row or column of equal-sized items.
 *
 * `foldOnDrag` is for blocks that differ in size (a header with a body): once
 * a drag starts, `draggingId` is rendered synchronously, so the caller can fold
 * every block to one size, and the items are measured again before they move.
 */
export function useAnimatedReorder<T extends string>(
  ids: T[],
  onReorder: (ids: T[], movedId: T) => void,
  axis: "x" | "y" = "x",
  externalDrop?: ReorderExternalDrop<T>,
  {
    foldOnDrag = false,
    onEnd,
    label,
  }: {
    foldOnDrag?: boolean;
    onEnd?: () => void;
    /** Spoken name of an item; defaults to its aria-label or text. */
    label?: (id: T) => string;
  } = {},
) {
  const nodes = useRef(new Map<T, HTMLElement>());
  const [draggingId, setDraggingId] = useState<T | null>(null);
  const latest = useRef({ ids, onReorder, externalDrop, onEnd, label });
  useLayoutEffect(() => {
    latest.current = { ids, onReorder, externalDrop, onEnd, label };
  }, [ids, onReorder, externalDrop, onEnd, label]);
  const cleanup = useRef<(() => void) | null>(null);
  const finishSettling = useRef<(() => void) | null>(null);
  const suppressClickUntil = useRef(0);
  const orderKey = ids.join("\0");

  useLayoutEffect(() => () => cleanup.current?.(), [orderKey]);

  const setItemRef = useCallback((id: T, node: HTMLElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const spokenName = useCallback(
    (id: T) => latest.current.label?.(id) || itemLabel(nodes.current.get(id)),
    [],
  );

  /** The keyboard and menu path: move one item by `delta` places with the same announcements. */
  const moveBy = useCallback(
    (id: T, delta: -1 | 1) => {
      // A pointer drag owns the list until it settles.
      if (cleanup.current) return false;
      const items = latest.current.ids;
      const from = items.indexOf(id);
      const to = from + delta;
      if (from < 0) return false;
      const name = spokenName(id);
      if (to < 0 || to >= items.length) {
        announceDrag(
          describePosition(name, from, items.length, "{p0} stays at position {p1} of {p2}"),
        );
        return false;
      }
      restoreFocusAfterMove(nodes.current.get(id));
      latest.current.onReorder(moveItem(items, from, to), id);
      announceDrag(describePosition(name, to, items.length, "Moved {p0} to position {p1} of {p2}"));
      return true;
    },
    [spokenName],
  );

  /** Wire to the item's `onKeyDown`; returns true when the key was a move and has been handled. */
  const onItemKeyDown = useCallback(
    (
      id: T,
      event: Pick<
        KeyboardEvent,
        "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "defaultPrevented"
      > & { isComposing?: boolean; preventDefault(): void; stopPropagation(): void },
    ) => {
      if (event.defaultPrevented || event.isComposing) return false;
      const delta = keyboardMoveDelta(event, axis);
      if (!delta) return false;
      event.preventDefault();
      event.stopPropagation();
      moveBy(id, delta);
      return true;
    },
    [axis, moveBy],
  );

  const onItemPointerDown = useCallback(
    (id: T, event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      finishSettling.current?.();
      if (cleanup.current) return;
      // A new press is a click candidate, even immediately after a previous drag.
      suppressClickUntil.current = 0;
      const items = latest.current.ids;
      const from = items.indexOf(id);
      if (from < 0 || (items.length < 2 && !latest.current.externalDrop)) return;
      const elements = items.map((item) => nodes.current.get(item));
      if (elements.some((element) => !element)) return;
      const tabs = elements as HTMLElement[];
      // Measure once: animated positions must not affect the drop calculation.
      const measure = () =>
        tabs.map((element) => {
          const rect = element.getBoundingClientRect();
          const start = axis === "x" ? rect.left : rect.top;
          const size = axis === "x" ? rect.width : rect.height;
          return { start, size, end: start + size };
        });
      let rects = measure();
      const transform = (offset: number) =>
        axis === "x" ? `translate3d(${offset}px, 0, 0)` : `translate3d(0, ${offset}px, 0)`;
      const coordinate = axis === "x" ? "clientX" : "clientY";
      const handle = tabs[from];
      const scrollProperty = axis === "x" ? "scrollLeft" : "scrollTop";
      const scrollParents: { element: HTMLElement; start: number }[] = [];
      for (let element = handle.parentElement; element; element = element.parentElement) {
        scrollParents.push({ element, start: element[scrollProperty] });
      }
      const pointerId = event.pointerId;
      let startPosition = event[coordinate];
      const startX = event.clientX;
      const startY = event.clientY;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const { duration: motionDuration, easing } = reorderMotion();
      const duration = reducedMotion ? 0 : motionDuration;
      const transition = `transform ${duration}ms ${easing}`;
      let restoreSelection: (() => void) | undefined;
      let active = false;
      let settling = false;
      let destination = from;
      let frame = 0;
      let pointerPosition = startPosition;
      let overExternalTarget = false;
      let finishTimer: ReturnType<typeof setTimeout> | undefined;
      let lostPointerUpTimer: ReturnType<typeof setTimeout> | undefined;
      let externalEnded = false;

      function endExternalDrop() {
        if (externalEnded) return;
        externalEnded = true;
        try {
          latest.current.externalDrop?.onEnd?.(id);
        } finally {
          latest.current.onEnd?.();
        }
      }

      function releasePointer() {
        for (const element of tabs) delete element.dataset.reordering;
        delete handle.dataset.dragging;
        if (restoreSelection) {
          restoreSelection();
          restoreSelection = undefined;
          setGrabbing(false);
        }
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      }

      function reset() {
        window.removeEventListener("pointerdown", onNextPointerDown, true);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", onCancel);
        window.removeEventListener("scroll", onScroll, true);
        window.clearTimeout(finishTimer);
        window.clearTimeout(lostPointerUpTimer);
        window.cancelAnimationFrame(frame);
        for (const element of tabs) {
          element.style.removeProperty("transition");
          element.style.removeProperty("transform");
          delete element.dataset.settling;
        }
        releasePointer();
        if (active) suppressClickUntil.current = performance.now() + 400;
        endExternalDrop();
        cleanup.current = null;
        finishSettling.current = null;
        setDraggingId(null);
      }

      function preview(to: number) {
        const reordered = moveItem(items, from, to);
        for (let index = 0; index < tabs.length; index++) {
          if (index === from) continue;
          const slot = reordered.indexOf(items[index]);
          tabs[index].style.transform = transform(rects[slot].start - rects[index].start);
        }
      }

      function paint(moveHandle = true) {
        frame = 0;
        // Scroll moves the original slots without changing their layout order.
        const scrollOffset = scrollParents.reduce(
          (offset, { element, start }) => offset + element[scrollProperty] - start,
          0,
        );
        const offset = Math.max(
          rects[0].start - rects[from].start,
          Math.min(
            pointerPosition - startPosition + scrollOffset,
            rects[rects.length - 1].end - rects[from].end,
          ),
        );
        if (moveHandle) {
          handle.style.transform = transform(offset);
        }
        const center = rects[from].start + rects[from].size / 2 + offset;
        const next = rects.reduce((nearest, rect, index) => {
          const distance = Math.abs(center - rect.start - rect.size / 2);
          const previous = rects[nearest];
          return distance < Math.abs(center - previous.start - previous.size / 2) ? index : nearest;
        }, from);
        if (next !== destination) {
          destination = next;
          preview(next);
          announceDrag(
            describePosition(spokenName(id), next, items.length, "{p0}, position {p1} of {p2}"),
          );
        }
      }

      function onScroll() {
        if (active && !settling && !overExternalTarget && !frame)
          frame = window.requestAnimationFrame(() => paint());
      }

      function onMove(ev: globalThis.PointerEvent) {
        if (ev.pointerId !== pointerId || settling) return;
        // WebKit can stamp moves queued before pointerup with buttons === 0.
        // Keep processing their positions while waiting briefly for pointerup.
        // Start one deadline: further button-less moves must not postpone cancel.
        if (ev.type === "pointermove" && ev.pointerType === "mouse" && ev.buttons === 0) {
          if (lostPointerUpTimer === undefined)
            lostPointerUpTimer = setTimeout(() => stop(false), LOST_POINTERUP_GRACE);
        } else if (ev.type === "pointermove") {
          window.clearTimeout(lostPointerUpTimer);
          lostPointerUpTimer = undefined;
        }
        pointerPosition = ev[coordinate];
        if (!active) {
          const distance = latest.current.externalDrop
            ? Math.hypot(ev.clientX - startX, ev.clientY - startY)
            : Math.abs(pointerPosition - startPosition);
          if (distance < 5) return;
          active = true;
          if (foldOnDrag) {
            // Folding moves the blocks: measure again, and keep the grabbed
            // point under the pointer.
            const grab = startPosition - rects[from].start;
            flushSync(() => setDraggingId(id));
            rects = measure();
            startPosition = rects[from].start + grab;
            for (const parent of scrollParents) {
              parent.start = parent.element[scrollProperty];
            }
          } else setDraggingId(id);
          handle.setPointerCapture(pointerId);
          restoreSelection = suppressTextSelection();
          setGrabbing(true);
          for (const element of tabs) {
            element.style.transition = transition;
            element.dataset.reordering = "true";
          }
          handle.style.transition = "none";
          handle.dataset.dragging = "true";
          announceDrag(
            describePosition(
              spokenName(id),
              from,
              items.length,
              "Picked up {p0}, position {p1} of {p2}. Escape cancels.",
            ),
          );
        }
        overExternalTarget = latest.current.externalDrop?.onMove(id, ev) ?? false;
        if (overExternalTarget) {
          window.cancelAnimationFrame(frame);
          frame = 0;
          preview(from);
          return;
        }
        // Keep the newest position when several input events arrive in one frame.
        if (!frame) frame = window.requestAnimationFrame(() => paint());
      }

      function stop(commit: boolean, event?: globalThis.PointerEvent) {
        if (settling) return;
        window.clearTimeout(lostPointerUpTimer);
        lostPointerUpTimer = undefined;
        if (!active) {
          reset();
          return;
        }
        if (commit && event && latest.current.externalDrop?.onDrop(id, event)) {
          reset();
          return;
        }
        settling = true;
        window.cancelAnimationFrame(frame);
        if (!commit) {
          endExternalDrop();
          announceDrag(
            describePosition(
              spokenName(id),
              from,
              items.length,
              "Move cancelled. {p0} stays at position {p1} of {p2}.",
            ),
          );
        }
        if (commit) paint(false);
        handle.dataset.settling = "true";
        releasePointer();
        suppressClickUntil.current = performance.now() + duration + 400;
        const to = commit ? destination : from;
        preview(to);
        handle.style.transition = transition;
        handle.style.transform = transform(rects[to].start - rects[from].start);
        const finish = () => {
          if (commit && to !== from) restoreFocusAfterMove(handle);
          // Clear the preview and commit the order before the next browser paint.
          flushSync(() => {
            reset();
            if (commit && to !== from) latest.current.onReorder(moveItem(items, from, to), id);
          });
          if (commit)
            announceDrag(
              describePosition(
                spokenName(id),
                to,
                items.length,
                to === from
                  ? "{p0} stays at position {p1} of {p2}"
                  : "Moved {p0} to position {p1} of {p2}",
              ),
            );
        };
        finishSettling.current = finish;
        if (duration === 0) finish();
        else {
          // Commit before a new press can change the list, including close buttons.
          window.addEventListener("pointerdown", onNextPointerDown, true);
          finishTimer = setTimeout(finish, duration);
        }
      }

      function onNextPointerDown() {
        finishSettling.current?.();
      }

      function onUp(ev: globalThis.PointerEvent) {
        if (ev.pointerId !== pointerId) return;
        onMove(ev);
        stop(true, ev);
      }
      function onCancel() {
        stop(false);
      }
      function onKey(ev: KeyboardEvent) {
        if (ev.key === "Escape") {
          ev.preventDefault();
          stop(false);
        }
      }

      cleanup.current = reset;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
      window.addEventListener("blur", onCancel);
      window.addEventListener("scroll", onScroll, true);
      return true;
    },
    [axis, foldOnDrag, spokenName],
  );

  const consumeClick = useCallback(() => performance.now() < suppressClickUntil.current, []);
  return { draggingId, setItemRef, onItemPointerDown, onItemKeyDown, moveBy, consumeClick };
}
