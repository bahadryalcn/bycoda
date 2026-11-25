export const NEAR_BOTTOM_PX = 16;
export const WHEEL_HOLD_MS = 150;
/** How long after a key, wheel, pointer or touch a scroll still counts as the reader's. */
export const READER_INPUT_MS = 1000;
/**
 * Painted frames without movement that end an upward motion the reader started. On Linux
 * WebKit every painted frame of an animated wheel scroll moved it (the stalls painted no
 * frames at all); one spare frame covers the frame between the wheel and its first move.
 */
export const READER_MOTION_IDLE_FRAMES = 3;
/** Absolute cap on one upward motion; CI frames stalled for up to 3.3s, locally 4.4s. */
export const READER_MOTION_MAX_MS = 10_000;

export function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

export function scrollClampedToBottom(el: HTMLElement, previousTop: number): boolean {
  const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
  return previousTop > bottom && Math.abs(el.scrollTop - bottom) < 1;
}

export function pinToBottom(el: HTMLElement | null) {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

/** Bottom padding of each transcript's inner column, read once per resize. */
const viewportPadding = new WeakMap<Element, number>();

/** Keep the live turn's min-height in lockstep with the visible transcript. */
export function syncTranscriptViewport(el: HTMLElement | null, refreshPadding = false) {
  if (!el || el.clientHeight <= 0) return;
  const inner = el.firstElementChild as HTMLElement | null;
  let pad = 0;
  if (inner) {
    const cached = viewportPadding.get(inner);
    if (cached === undefined || refreshPadding) {
      pad = Number.parseFloat(getComputedStyle(inner).paddingBottom) || 0;
      viewportPadding.set(inner, pad);
    } else {
      pad = cached;
    }
  }
  const next = `${Math.max(0, el.clientHeight - pad)}px`;
  // Written on the anchored turn, never on the scroller: there the property is
  // inherited by every element of the transcript, so each frame of a panel drag
  // restyled all of it.
  const anchors = el.getElementsByClassName("transcript-turn-anchor");
  for (let index = 0; index < anchors.length; index++) {
    const style = (anchors[index] as HTMLElement).style;
    if (style.getPropertyValue("--transcript-viewport") !== next)
      style.setProperty("--transcript-viewport", next);
  }
}

/**
 * First turn whose bottom edge is below `top`. Turns are laid out in document
 * order, so their bottoms never decrease and a binary search reads O(log n)
 * rects where a linear scan read every turn above the viewport.
 * shortcut: assumes turns do not nest or overlap; upgrade if nested turns appear.
 */
export function firstTurnBelow(
  nodes: ArrayLike<HTMLElement>,
  top: number,
): HTMLElement | undefined {
  let lo = 0;
  let hi = nodes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid].getBoundingClientRect().bottom > top) hi = mid;
    else lo = mid + 1;
  }
  return nodes[lo];
}
