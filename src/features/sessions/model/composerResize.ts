/** Matches the composer's `max-h-40`, so the field stops growing where it clips. */
export const COMPOSER_MAX_HEIGHT = 160;

type Resizable = {
  style: { height: string };
  scrollHeight: number;
  value?: string;
  clientWidth?: number;
  parentElement?: {
    style: { minHeight: string };
    offsetHeight: number;
  } | null;
};

const cappedFields = new WeakMap<Resizable, { value: string; width: number; maxHeight: number }>();

/** A hidden tab stays mounted with no layout box, so it reports 0 here. */
export function resizeComposer(el: Resizable, maxHeight = COMPOSER_MAX_HEIGHT) {
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
