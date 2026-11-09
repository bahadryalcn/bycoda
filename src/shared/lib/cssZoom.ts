/** CSS zoom is not inherited in computed styles, but every ancestor scales coordinates. */
export function cumulativeCssZoom(element: Element | null): number {
  const view = element?.ownerDocument.defaultView;
  if (!view) return 1;
  let zoom = 1;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const value = view.getComputedStyle(current).getPropertyValue("zoom").trim();
    const parsed = Number.parseFloat(value);
    const factor = value.endsWith("%") ? parsed / 100 : parsed;
    if (Number.isFinite(factor) && factor > 0) zoom *= factor;
  }
  return zoom;
}
