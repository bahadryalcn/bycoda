import { observeResize } from "../../../shared/lib/observeResize";

/** Follow the native child's DOM slot. The intersection root hugs its last rectangle so a
 * position-only layout shift or compositor transform wakes us even when its size stays fixed. */
export function observeLocalBrowserBounds(slot: HTMLElement, report: (rect: DOMRect) => void) {
  let rect: DOMRect | undefined;
  let position: IntersectionObserver | undefined;
  let frame = 0;
  let stopped = false;
  let resolution: MediaQueryList | undefined;
  const root = document.documentElement;
  const viewport = window.visualViewport;

  function moved(next: DOMRectReadOnly) {
    return (
      !rect ||
      rect.left !== next.left ||
      rect.top !== next.top ||
      rect.width !== next.width ||
      rect.height !== next.height
    );
  }
  function watchPosition(stable: DOMRectReadOnly, threshold = 1) {
    if (typeof IntersectionObserver === "undefined" || !stable.width || !stable.height) return;
    const margins = [
      -Math.floor(stable.top),
      -Math.floor(root.clientWidth - stable.right),
      -Math.floor(root.clientHeight - stable.bottom),
      -Math.floor(stable.left),
    ];
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (stopped || observer !== position || !entry) return;
        if (moved(entry.boundingClientRect)) schedule();
        else if (entry.intersectionRatio > 0 && entry.intersectionRatio < threshold) {
          // An ancestor can clip a stationary slot. Watch its actual intersection.
          observer.disconnect();
          watchPosition(stable, entry.intersectionRatio);
        }
      },
      { rootMargin: margins.map((n) => `${n}px`).join(" "), threshold: [0, threshold] },
    );
    position = observer;
    observer.observe(slot);
  }
  function measure() {
    frame = 0;
    if (stopped) return;
    const next = slot.getBoundingClientRect();
    report(next);
    if (moved(next)) {
      rect = next;
      position?.disconnect();
      position = undefined;
      // While actually moving, follow the next frame. Once stable, sleep until notified.
      schedule();
    } else if (!position) watchPosition(next);
  }
  function schedule() {
    if (!stopped && !frame) frame = requestAnimationFrame(measure);
  }
  function viewportChanged() {
    position?.disconnect();
    position = undefined;
    schedule();
  }
  function watchResolution() {
    resolution?.removeEventListener("change", watchResolution);
    resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    resolution.addEventListener("change", watchResolution);
    viewportChanged();
  }
  const stopResize = observeResize(slot, schedule);
  // Intersection root margins use whole CSS pixels. Inline motion and a final CSS
  // keyframe can move the native rectangle by a physical pixel inside that margin.
  const attributes = new MutationObserver(schedule);
  for (let node: HTMLElement | null = slot; node; node = node.parentElement)
    attributes.observe(node, { attributes: true, attributeFilter: ["class", "style", "hidden"] });
  function motionBoundary(event: Event) {
    if (event.target instanceof Element && event.target.contains(slot)) schedule();
  }
  const motionEvents = [
    "transitionstart",
    "transitionend",
    "transitioncancel",
    "animationstart",
    "animationend",
    "animationcancel",
  ];
  for (const type of motionEvents) document.addEventListener(type, motionBoundary, true);
  // A clipped slot can re-enter in a completely different place, outside its last tight root.
  const visibility =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver(schedule, { threshold: [0, 1e-7] });
  visibility?.observe(slot);
  window.addEventListener("resize", viewportChanged);
  window.addEventListener("scroll", schedule, true);
  viewport?.addEventListener("resize", viewportChanged);
  viewport?.addEventListener("scroll", schedule);
  watchResolution();
  // Deliver initial bounds now, including on tab or overlay dismissal.
  cancelAnimationFrame(frame);
  measure();
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    position?.disconnect();
    visibility?.disconnect();
    attributes.disconnect();
    for (const type of motionEvents) document.removeEventListener(type, motionBoundary, true);
    stopResize();
    resolution?.removeEventListener("change", watchResolution);
    window.removeEventListener("resize", viewportChanged);
    window.removeEventListener("scroll", schedule, true);
    viewport?.removeEventListener("resize", viewportChanged);
    viewport?.removeEventListener("scroll", schedule);
  };
}
