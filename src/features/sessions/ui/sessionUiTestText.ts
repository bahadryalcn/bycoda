/** Current accessible text, excluding labels retained only for an exit animation. */
export function visibleSessionTestText(element: Element | null | undefined): string {
  if (!element) return "";
  const clone = element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return clone.textContent ?? "";
}
