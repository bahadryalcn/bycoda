/** A selection's current position, re-read from the live range instead of the rect captured at selection time. */
export type SelectionGeometry = { rect: DOMRect; visible: boolean };

export function firstRangeRect(range: Range): DOMRect | null {
  const rects = range.getClientRects();
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects.item(index);
    if (rect && (rect.width > 0 || rect.height > 0)) return rect;
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

/**
 * Whether `rect` is on screen: inside the viewport and inside every ancestor of `from` that clips
 * its content. A selection scrolled out of view is hidden, not lost.
 */
export function isRectVisible(rect: DOMRect, from: Element | null): boolean {
  const inside = (bounds: { left: number; top: number; right: number; bottom: number }) =>
    rect.right >= bounds.left &&
    rect.left <= bounds.right &&
    rect.bottom >= bounds.top &&
    rect.top <= bounds.bottom;
  if (!inside({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }))
    return false;
  for (let node = from; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const clipsX = style.overflowX !== "visible";
    const clipsY = style.overflowY !== "visible";
    if (!clipsX && !clipsY) continue;
    const bounds = node.getBoundingClientRect();
    if (bounds.width === 0 && bounds.height === 0) continue;
    if (
      !inside({
        left: clipsX ? bounds.left : -Infinity,
        right: clipsX ? bounds.right : Infinity,
        top: clipsY ? bounds.top : -Infinity,
        bottom: clipsY ? bounds.bottom : Infinity,
      })
    )
      return false;
  }
  return true;
}

export function sameRect(a: DOMRect, b: DOMRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
