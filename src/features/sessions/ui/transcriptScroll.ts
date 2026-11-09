export const NEAR_BOTTOM_PX = 16;
export const WHEEL_HOLD_MS = 150;
/** How long after a key, wheel, pointer or touch a scroll still counts as the reader's. */
export const READER_INPUT_MS = 1000;

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
  if (el.style.getPropertyValue("--transcript-viewport") === next) return;
  el.style.setProperty("--transcript-viewport", next);
}

/**
 * A scroll event that moved up while following the end, with no reader input
 * behind it, is a replayed offset rather than the reader leaving. WebKit replays
 * an offset the transcript passed through earlier: one it followed, or one a
 * downward wheel animation crossed on its way to the end (those were never
 * followed, so only the recent downward gesture identifies them).
 */
export function isStaleFollowReplay(input: {
  following: boolean;
  scrolledUp: boolean;
  held: boolean;
  now: number;
  /** Until when a key, wheel up or released gesture still counts as the reader's. */
  inputUntil: number;
  /** Until when a downward wheel gesture is still settling toward the end. */
  downUntil: number;
  top: number;
  followedTops: readonly { top: number; at: number }[];
}): boolean {
  if (!input.following || !input.scrolledUp || input.held || input.now <= input.inputUntil)
    return false;
  if (input.now < input.downUntil) return true;
  const latest = input.followedTops[input.followedTops.length - 1];
  return (
    !!latest &&
    input.now - latest.at < READER_INPUT_MS &&
    input.followedTops.some((entry) => entry.top <= input.top + 1)
  );
}
