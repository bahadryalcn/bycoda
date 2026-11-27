import { useState } from "react";

/** Reports whether a pointer event is a real move rather than a repeat at the last seen position. */
export type PointerMovement = (event: { clientX: number; clientY: number }) => boolean;

/**
 * Plain factory behind `usePointerMovement`; one guard per list, never per row.
 */
export function createPointerMovement(): PointerMovement {
  let last: { x: number; y: number } | null = null;
  return (event) => {
    const moved = !last || last.x !== event.clientX || last.y !== event.clientY;
    last = { x: event.clientX, y: event.clientY };
    return moved;
  };
}

/**
 * Pointer-movement guard for option lists that highlight under the pointer.
 * Keyboard scrolling slides rows under a resting pointer and Chromium then fires entry and move events
 * at the unchanged coordinates; only a changed position may take the highlight from the keyboard.
 * Call it from the row's `onPointerMove` and set the highlight when it returns true. Share one guard per list.
 * @group choice
 * @use Rows of a custom list that highlight on pointer hover.
 * @avoid `onMouseEnter` highlighting, and PickerList rows, which already apply it.
 */
export function usePointerMovement(): PointerMovement {
  // Stable identity keeps memoised rows from re-rendering; the guard holds the last position itself.
  return useState(createPointerMovement)[0];
}
