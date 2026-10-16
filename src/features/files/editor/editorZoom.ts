import { EditorView, ViewPlugin } from "@codemirror/view";

const STORAGE_KEY = "bycoda.codeZoom";
const OFFSET_VAR = "--code-zoom-offset";
/** Settings > Appearance code size when it has not been applied yet. */
export const CODE_SIZE_DEFAULT = 13;
const MIN_SIZE = 8;
const MAX_SIZE = 32;
const listeners = new Set<(offset: number) => void>();
// Only used while storage rejects writes; otherwise storage is authoritative.
let unsaved: number | undefined;

/**
 * Ctrl+wheel zoom for code, in pixels added to the Appearance code size.
 * Editors pick it up from the global `.cm-content` rule; diff views scale by it.
 */
export function codeZoomOffset(): number {
  if (unsaved !== undefined) return unsaved;
  try {
    const offset = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isInteger(offset) && Math.abs(offset) <= MAX_SIZE) return offset;
  } catch {
    // Zoom remains available when storage is blocked.
  }
  return 0;
}

/** Diff views are drawn for the default code size; this is their scale factor. */
export function codeZoomScale(offset = codeZoomOffset()): number {
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, CODE_SIZE_DEFAULT + offset));
  return size / CODE_SIZE_DEFAULT;
}

export function subscribeCodeZoom(listener: (offset: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function baseCodeSize(): number {
  const value = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--appearance-code-size"),
  );
  return Number.isFinite(value) ? value : CODE_SIZE_DEFAULT;
}

function applyOffset(offset: number) {
  if (offset) document.documentElement.style.setProperty(OFFSET_VAR, `${offset}px`);
  else document.documentElement.style.removeProperty(OFFSET_VAR);
}

/**
 * Applies one Ctrl+wheel step (scrolling up zooms in) to every editor and diff
 * view. Returns whether the event is a zoom gesture; the caller cancels it even
 * at a limit so the webview never zooms the page instead.
 */
export function zoomCodeByWheel(event: WheelEvent): boolean {
  if (event.defaultPrevented || !event.ctrlKey || event.deltaY === 0) return false;
  const previous = codeZoomOffset();
  const base = baseCodeSize();
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, base + previous - Math.sign(event.deltaY)));
  const offset = Math.round(size - base);
  if (offset === previous) return true;
  try {
    localStorage.setItem(STORAGE_KEY, String(offset));
    unsaved = undefined;
  } catch {
    // Open editors still synchronize without persistence.
    unsaved = offset;
  }
  applyOffset(offset);
  for (const update of listeners) update(offset);
  return true;
}

/** Ctrl+wheel zoom for file editors, including both read-only and editable diff panes. */
export function editorZoom() {
  return ViewPlugin.fromClass(
    class {
      private readonly unsubscribe: () => void;

      constructor(private readonly view: EditorView) {
        applyOffset(codeZoomOffset());
        // The font changes through CSS, which CodeMirror cannot observe.
        this.unsubscribe = subscribeCodeZoom(() => view.requestMeasure());
        view.dom.addEventListener("wheel", this.onWheel, { passive: false, capture: true });
      }

      private readonly onWheel = (event: WheelEvent) => {
        if (zoomCodeByWheel(event)) event.preventDefault();
      };

      destroy() {
        this.unsubscribe();
        this.view.dom.removeEventListener("wheel", this.onWheel, true);
      }
    },
  );
}
