import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Window } from "./useTranscriptPaging";

/**
 * A tail window follows the newest turn only while the reader follows the
 * bottom. When a newer turn arrives and the reader is reading above it, the
 * window freezes on the turns it last showed so the new turn cannot push them
 * out. The follow state is a ref owned by the scroll hook, read here during
 * render on purpose: the window must change in the same render as the new
 * turn. The read is kept in this small hook so the paging hook can compile.
 */
export function useReleasedTail(
  window: Window,
  setWindow: Dispatch<SetStateAction<Window>>,
  lastId: string | undefined,
  stickToBottomRef: RefObject<boolean>,
  previousRef: RefObject<{ firstId?: string; lastId?: string; count: number } | null>,
): Window {
  const previous = previousRef.current;
  if (window.tail && !stickToBottomRef.current && previous?.lastId && previous.lastId !== lastId) {
    const released = { firstId: previous.firstId, offset: 0, count: previous.count, tail: false };
    setWindow(released);
    return released;
  }
  return window;
}
