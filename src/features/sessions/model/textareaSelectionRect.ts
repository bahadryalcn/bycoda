/** Textareas do not expose their selection as a DOM Range. Measure a hidden
 * mirror using the same typography, wrapping, padding and scroll offsets. */
export function textareaSelectionRect(
  element: HTMLTextAreaElement,
  start: number,
  end: number,
): DOMRect | null {
  if (start === end) return null;
  const bounds = element.getBoundingClientRect();
  const styles = getComputedStyle(element);
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  for (const property of [
    "box-sizing",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-variant",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-indent",
    "text-align",
    "text-transform",
    "direction",
    "writing-mode",
    "tab-size",
    "white-space",
    "overflow-wrap",
    "word-break",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
  ])
    mirror.style.setProperty(property, styles.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    left: "0px",
    top: "0px",
    boxSizing: "border-box",
    width: `${element.clientWidth + parseFloat(styles.borderLeftWidth || "0") + parseFloat(styles.borderRightWidth || "0")}px`,
    height: "auto",
    margin: "0",
    borderStyle: "solid",
    borderColor: "transparent",
  });
  mirror.textContent = element.value + "\u200b";
  document.body.append(mirror);
  try {
    const range = document.createRange();
    range.setStart(mirror.firstChild!, start);
    range.setEnd(mirror.firstChild!, end);
    // Anchor the first visible selected line, including a scrolled textarea.
    const rects = range.getClientRects();
    const mirrorBounds = mirror.getBoundingClientRect();
    const scale = bounds.width / Math.max(1, element.offsetWidth);
    const mirrorScale = mirrorBounds.width / Math.max(1, parseFloat(mirror.style.width));
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects.item(index);
      const mappedLeft = rect
        ? bounds.left + ((rect.left - mirrorBounds.left) / mirrorScale - element.scrollLeft) * scale
        : 0;
      const mappedTop = rect
        ? bounds.top + ((rect.top - mirrorBounds.top) / mirrorScale - element.scrollTop) * scale
        : 0;
      const mappedRight = rect ? mappedLeft + (rect.width / mirrorScale) * scale : 0;
      const mappedBottom = rect ? mappedTop + (rect.height / mirrorScale) * scale : 0;
      if (
        !rect ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        mappedBottom <= bounds.top ||
        mappedTop >= bounds.bottom
      )
        continue;
      const left = Math.max(bounds.left, mappedLeft);
      const right = Math.min(bounds.right, mappedRight);
      const top = Math.max(bounds.top, mappedTop);
      const bottom = Math.min(bounds.bottom, mappedBottom);
      if (right > left) return new DOMRect(left, top, right - left, bottom - top);
    }
    return null;
  } finally {
    mirror.remove();
  }
}
