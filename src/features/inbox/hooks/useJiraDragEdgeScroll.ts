import { useEffect, useState } from "react";

/** Band (px) inside a scroll container's edge where a held drag scrolls it. */
const EDGE = 40;
/** Largest scroll step (px) per frame, reached at the very edge. */
const MAX_STEP = 16;

export type DragPoint = { clientX: number; clientY: number };
type Follow = (zone: HTMLElement | null, at: DragPoint) => void;

/** Scroll step for one axis: zero away from the edges, faster the deeper the pointer sits in the band. */
function edgeStep(position: number, start: number, end: number): number {
  if (position < start + EDGE)
    return -Math.min(MAX_STEP, Math.ceil(((start + EDGE - position) / EDGE) * MAX_STEP));
  if (position > end - EDGE)
    return Math.min(MAX_STEP, Math.ceil(((position - end + EDGE) / EDGE) * MAX_STEP));
  return 0;
}

function scrollAxis(element: HTMLElement, axis: "scrollTop" | "scrollLeft", step: number) {
  const before = element[axis];
  element[axis] += step;
  return element[axis] !== before;
}

/**
 * Drag target tracking and edge auto-scroll share one frame loop. Each frame reads the drop zone
 * under the last pointer position, reports it, and scrolls the column/row toward a held edge.
 * The loop continues only while a scroll moved, so a held pointer keeps scrolling without new
 * pointer events and stops at the scroll limit, when it leaves the edge, or on stop().
 */
export function createDragEdgeScroll() {
  let frame: number | null = null;
  let drag: { point: DragPoint; origin: HTMLElement; follow: Follow } | null = null;

  const tick = () => {
    frame = null;
    if (!drag) return;
    const { point, origin, follow } = drag;
    const zone =
      document
        .elementFromPoint(point.clientX, point.clientY)
        ?.closest<HTMLElement>("[data-jira-drop]") ?? null;
    follow(zone, point);
    let moved = false;
    const column = zone?.closest<HTMLElement>(".jira-board-column, .jira-board-planning");
    if (column) {
      const rect = column.getBoundingClientRect();
      const step = edgeStep(point.clientY, rect.top, rect.bottom);
      if (step !== 0 && scrollAxis(column, "scrollTop", step)) moved = true;
    }
    const row = origin.closest<HTMLElement>(".jira-board-columns");
    if (row) {
      const rect = row.getBoundingClientRect();
      const step = edgeStep(point.clientX, rect.left, rect.right);
      if (step !== 0 && scrollAxis(row, "scrollLeft", step)) moved = true;
    }
    if (moved) frame = requestAnimationFrame(tick);
  };

  return {
    /** Records the latest pointer position and starts a frame unless one is already pending. */
    track(point: DragPoint, origin: HTMLElement, follow: Follow) {
      drag = { point, origin, follow };
      frame ??= requestAnimationFrame(tick);
    },
    /** Ends the drag's loop: drop, cancel, a reset of the board, or unmount. */
    stop() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      drag = null;
    },
  };
}

/** Stable per-view controller; its pending frame is cancelled when the view unmounts. */
export function useJiraDragEdgeScroll() {
  const [scroll] = useState(createDragEdgeScroll);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Cancel the pending drag scroll animation frame when the view unmounts.
  useEffect(() => () => scroll.stop(), [scroll]);
  return scroll;
}
