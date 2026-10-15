import { Compartment, Prec } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

const STORAGE_KEY = "bycoda.editorFontSize";
export const EDITOR_FONT_SIZE_DEFAULT = 13;
const MIN_SIZE = 8;
const MAX_SIZE = 32;
const listeners = new Set<(size: number) => void>();
// Only used while storage rejects writes; otherwise storage is authoritative.
let unsaved: number | undefined;

/** Code font size shared by file editors and diff views. */
export function editorFontSize(): number {
  if (unsaved !== undefined) return unsaved;
  try {
    const size = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isInteger(size) && size >= MIN_SIZE && size <= MAX_SIZE) return size;
  } catch {
    // Zoom remains available when storage is blocked.
  }
  return EDITOR_FONT_SIZE_DEFAULT;
}

export function subscribeEditorFontSize(listener: (size: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Applies one Ctrl+wheel step (scrolling up zooms in) to every editor and diff
 * view. Returns whether the event is a zoom gesture; the caller cancels it even
 * at a limit so the webview never zooms the page instead.
 */
export function zoomEditorFontByWheel(event: WheelEvent): boolean {
  if (event.defaultPrevented || !event.ctrlKey || event.deltaY === 0) return false;
  const previous = editorFontSize();
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, previous - Math.sign(event.deltaY)));
  if (size === previous) return true;
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
    unsaved = undefined;
  } catch {
    // Open editors still synchronize without persistence.
    unsaved = size;
  }
  for (const update of listeners) update(size);
  return true;
}

const fontTheme = (size: number) =>
  Prec.highest(EditorView.theme({ "&": { fontSize: `${size}px` } }));

/** Shared font zoom for file editors, including both read-only and editable diff panes. */
export function editorZoom() {
  const font = new Compartment();
  return [
    font.of(fontTheme(editorFontSize())),
    ViewPlugin.fromClass(
      class {
        private size = editorFontSize();
        private readonly unsubscribe: () => void;

        constructor(private readonly view: EditorView) {
          this.unsubscribe = subscribeEditorFontSize(this.setSize);
          view.dom.addEventListener("wheel", this.onWheel, {
            passive: false,
            capture: true,
          });
        }

        private readonly setSize = (size: number) => {
          if (size === this.size) return;
          this.size = size;
          this.view.dispatch({ effects: font.reconfigure(fontTheme(size)) });
        };

        private readonly onWheel = (event: WheelEvent) => {
          if (zoomEditorFontByWheel(event)) event.preventDefault();
        };

        destroy() {
          this.unsubscribe();
          this.view.dom.removeEventListener("wheel", this.onWheel, true);
        }
      },
    ),
  ];
}
