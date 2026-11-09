import { loadAppearancePreferences } from "./appearancePreferences";
import { applyUiScale, loadUiScale, saveUiScale, zoomInUiScale, zoomOutUiScale } from "./uiScale";

// One mouse-wheel notch is ~100px; a touchpad sends many small deltas that add up to it.
const STEP_PIXELS = 100;
const LINE_PIXELS = 16;
const PAGE_PIXELS = 400;

/**
 * Turns Ctrl+wheel deltas into whole UI-scale steps: +1 zooms in, -1 zooms out.
 * A reversed direction drops the partial delta collected the other way.
 */
export function createWheelStepper() {
  let pending = 0;
  return (event: Pick<WheelEvent, "deltaY" | "deltaMode">): number => {
    const unit = event.deltaMode === 1 ? LINE_PIXELS : event.deltaMode === 2 ? PAGE_PIXELS : 1;
    const delta = -event.deltaY * unit;
    if (!delta) return 0;
    if (Math.sign(delta) !== Math.sign(pending)) pending = 0;
    pending += delta;
    if (Math.abs(pending) < STEP_PIXELS) return 0;
    const step = Math.sign(pending);
    pending %= STEP_PIXELS;
    return step;
  };
}

/**
 * App-wide Ctrl+wheel zoom, listening on the window in the bubble phase so it runs
 * last. Code editors, diffs, Markdown previews, documents, images and terminals
 * zoom their own content and cancel the event; a cancelled event is left to them.
 */
export function installUiScaleWheel(target: Window = window): () => void {
  const step = createWheelStepper();
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey || event.defaultPrevented) return;
    if (!loadAppearancePreferences().wheelZoom) return;
    event.preventDefault();
    const direction = step(event);
    if (!direction) return;
    const current = loadUiScale();
    const next = direction > 0 ? zoomInUiScale(current) : zoomOutUiScale(current);
    if (next !== current) applyUiScale(saveUiScale(next)).catch(console.warn);
  };
  target.addEventListener("wheel", onWheel, { passive: false });
  return () => target.removeEventListener("wheel", onWheel);
}
