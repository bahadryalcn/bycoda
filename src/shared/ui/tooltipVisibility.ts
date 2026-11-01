/** Layout is read on interaction, never by installing an observer for every list row. */
export function inspectTooltipAnchor(anchor: HTMLElement): {
  text: string;
  clipped: boolean;
} {
  // A shortcut group may be queried directly while an enclosing responsive span is hidden.
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (
      parent.hidden ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0" ||
      style.clipPath === "inset(50%)"
    )
      return { text: "", clipped: false };
  }
  const text: string[] = [];
  let clipped = false;
  const visit = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    if (
      element.hidden ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0" ||
      // Screen-reader copies must not count as either visible text or overflow.
      style.clipPath === "inset(50%)" ||
      (style.position === "absolute" && element.clientWidth <= 1 && element.clientHeight <= 1)
    )
      return;
    const clipsX =
      /hidden|clip|auto|scroll/.test(style.overflowX || style.overflow) ||
      style.textOverflow === "ellipsis";
    const clipsY =
      /hidden|clip|auto|scroll/.test(style.overflowY || style.overflow) ||
      Number.parseInt(style.webkitLineClamp) > 0;
    if (
      element.textContent?.trim() &&
      ((clipsX && element.scrollWidth > element.clientWidth + 1) ||
        (clipsY && element.scrollHeight > element.clientHeight + 1))
    )
      clipped = true;
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text.push(node.textContent ?? "");
      else if (node instanceof HTMLElement) visit(node);
    }
  };
  visit(anchor);
  return { text: text.join(" "), clipped };
}

const compact = (value: string) => value.normalize("NFC").replace(/\s+/g, "").trim();

/** Missing labels include responsive icon-only controls; different labels add information. */
export function needsOverflowTooltip(
  anchor: HTMLElement,
  label: unknown,
  shortcut?: { raw: string; spoken: string; keys: string },
): boolean {
  const visible = inspectTooltipAnchor(anchor);
  if (visible.clipped) return true;
  const shown = compact(visible.text);
  if (label != null && (typeof label !== "string" || !shown.includes(compact(label)))) return true;
  if (!shortcut) return false;
  const matchesKeys = (text: string) => {
    const keys = compact(text).replace(/\+/g, "");
    return (
      keys !== "" &&
      (keys === compact(shortcut.raw).replace(/\+/g, "") ||
        keys === compact(shortcut.keys).replace(/\+/g, ""))
    );
  };
  if (
    Array.from(anchor.querySelectorAll<HTMLElement>("[data-tooltip-shortcut]")).some((element) =>
      matchesKeys(inspectTooltipAnchor(element).text),
    )
  )
    return false;
  // ShortcutKeys exposes the platform-aware spoken combination on its visible group.
  return !Array.from(anchor.querySelectorAll<HTMLElement>('[role="img"][aria-label]')).some(
    (element) =>
      element.getAttribute("aria-label") === shortcut.spoken &&
      compact(inspectTooltipAnchor(element).text) !== "",
  );
}
