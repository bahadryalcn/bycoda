import { onResizeGestureEnd, resizeGestureActive } from "../../../shared/lib/resizeGesture";

/**
 * Walking every ancestor with `getComputedStyle` costs 20-30 style reads, and a live pane drag
 * asks once per frame per mounted editor. During a resize gesture the answer is remembered; the
 * observer below drops it when an ancestor's visibility could have changed, and the gesture end
 * drops everything (CSS that no attribute change reports, such as a media query, settles then).
 */
let gestureEpoch = 0;
const cached = new WeakMap<HTMLElement, { epoch: number; active: boolean }>();
if (typeof window !== "undefined") onResizeGestureEnd(() => void (gestureEpoch += 1));

/** Retained editors keep their state while the visible document owns input. */
export function editorSurfaceActive(element: HTMLElement): boolean {
  const live = resizeGestureActive();
  if (live) {
    const hit = cached.get(element);
    if (hit?.epoch === gestureEpoch) return hit.active;
  }
  const active = computeActive(element);
  if (live) cached.set(element, { epoch: gestureEpoch, active });
  return active;
}

function computeActive(element: HTMLElement): boolean {
  if (
    element.closest(
      '[data-file-editor-source-active="false"], [data-editor-shown="false"], [hidden], [inert]',
    )
  ) {
    return false;
  }
  if (!element.parentElement) return false;
  for (let owner: HTMLElement | null = element.parentElement; owner; owner = owner.parentElement) {
    const style = getComputedStyle(owner);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.pointerEvents === "none"
    ) {
      return false;
    }
  }
  return true;
}

/** The inline declarations that can hide a pane (panes hide with `display: none` in `style`). */
function visibilityKey(owner: HTMLElement): string {
  const { display, visibility, pointerEvents } = owner.style;
  return `${display}|${visibility}|${pointerEvents}`;
}

/**
 * Theme and retained-pane switches need a repaint without rebuilding the editor. A pane drag
 * rewrites `style.width` on an ancestor every frame; only a `style` change that touches
 * display, visibility or pointer-events is reported.
 */
export function observeEditorSurface(element: HTMLElement, onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const inlineKeys = new Map<Element, string>();
  const observer = new MutationObserver((records) => {
    let relevant = false;
    for (const record of records) {
      if (record.attributeName !== "style") {
        relevant = true;
        continue;
      }
      const owner = record.target as HTMLElement;
      const key = visibilityKey(owner);
      if (inlineKeys.get(owner) === key) continue;
      inlineKeys.set(owner, key);
      relevant = true;
    }
    if (!relevant) return;
    cached.delete(element);
    onChange();
  });
  for (let owner = element.parentElement; owner; owner = owner.parentElement) {
    inlineKeys.set(owner, visibilityKey(owner));
    observer.observe(owner, {
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "inert",
        "data-file-editor-source-active",
        "data-editor-shown",
      ],
    });
  }
  return () => observer.disconnect();
}
