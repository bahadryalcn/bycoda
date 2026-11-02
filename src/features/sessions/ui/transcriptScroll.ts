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
