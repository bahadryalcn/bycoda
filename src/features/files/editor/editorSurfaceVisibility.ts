/** Retained editors keep their state while the visible document owns input. */
export function editorSurfaceActive(element: HTMLElement): boolean {
  if (element.closest('[data-file-editor-source-active="false"], [data-editor-shown="false"], [hidden], [inert]')) {
    return false;
  }
  if (!element.parentElement) return false;
  for (let owner: HTMLElement | null = element.parentElement; owner; owner = owner.parentElement) {
    const style = getComputedStyle(owner);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.pointerEvents === "none") {
      return false;
    }
  }
  return true;
}

/** Theme and retained-pane switches need a repaint without rebuilding the editor. */
export function observeEditorSurface(element: HTMLElement, onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  for (let owner = element.parentElement; owner; owner = owner.parentElement) {
    observer.observe(owner, {
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "inert", "data-file-editor-source-active", "data-editor-shown"],
    });
  }
  return () => observer.disconnect();
}
