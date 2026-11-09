/** Matches the composer's `max-h-40`, so the field stops growing where it clips. */
export const COMPOSER_MAX_HEIGHT = 160;

const READING_MIN_HEIGHT = 68;
const READING_MAX_HEIGHT = 132;
const READING_VIEWPORT_SHARE = 0.2;

/**
 * Tallest the compact reading-mode field grows before it scrolls on its own.
 * It follows the window height so a short window keeps most of its height for
 * the transcript, and never drops below two lines, so a short draft is never
 * clipped. The textarea's own scrolling takes over beyond it.
 */
export function readingComposerMaxHeight(viewportHeight: number): number {
  const share = Math.round(viewportHeight * READING_VIEWPORT_SHARE);
  return Math.min(READING_MAX_HEIGHT, Math.max(READING_MIN_HEIGHT, share));
}

type Resizable = {
  style: { height: string };
  closest?: (selector: string) => unknown;
  scrollHeight: number;
  value?: string;
  clientWidth?: number;
  parentElement?: {
    style: { minHeight: string };
    offsetHeight: number;
  } | null;
};

const cappedFields = new WeakMap<Resizable, { value: string; width: number; maxHeight: number }>();

/**
 * The field's height ceiling. Reading mode marks its composer root with
 * `data-composer-reading`, so every resize path of the one mounted textarea
 * (typing, paste, restore, completions) agrees without being told.
 */
export function composerMaxHeight(el: Resizable): number {
  return el.closest?.("[data-composer-reading]")
    ? readingComposerMaxHeight(typeof window === "undefined" ? 800 : window.innerHeight)
    : COMPOSER_MAX_HEIGHT;
}

/** A hidden tab stays mounted with no layout box, so it reports 0 here. */
export function resizeComposer(el: Resizable, maxHeight = composerMaxHeight(el)) {
  const capped = cappedFields.get(el);
  // Appending to an already overflowing draft cannot make it fit. Keep the
  // capped box instead of laying the entire draft out twice (auto -> cap).
  // Deletion, replacement, width changes and explicit height changes remeasure.
  if (
    capped &&
    capped.maxHeight === maxHeight &&
    el.style.height === `${maxHeight}px` &&
    el.value !== undefined &&
    el.value.length > capped.value.length &&
    el.value.startsWith(capped.value) &&
    el.clientWidth === capped.width
  ) {
    capped.value = el.value;
    return;
  }
  cappedFields.delete(el);
  if (el.scrollHeight === 0) return;
  const wrapper = el.parentElement;
  const minHeight = wrapper?.style.minHeight ?? "";
  // Preserve the composer's occupied space during measurement so the browser
  // cannot temporarily clamp the transcript's scroll position.
  if (wrapper) wrapper.style.minHeight = `${wrapper.offsetHeight}px`;
  try {
    el.style.height = "auto";
    const height = el.scrollHeight;
    el.style.height = `${Math.min(height, maxHeight)}px`;
    if (height > maxHeight && el.value !== undefined && el.clientWidth) {
      cappedFields.set(el, { value: el.value, width: el.clientWidth, maxHeight });
    }
  } finally {
    if (wrapper) wrapper.style.minHeight = minHeight;
  }
}
